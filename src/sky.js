import * as THREE from 'three'

const vertexShader = `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`

const fragmentShader = `
  uniform vec3 topColor;
  uniform vec3 horizonColor;
  uniform vec3 groundColor;
  uniform vec3 sunColor;
  uniform vec3 sunDirection;
  varying vec3 vDirection;

  void main() {
    vec3 dir = normalize(vDirection);
    float h = dir.y;
    vec3 sky = mix(horizonColor, topColor, smoothstep(0.0, 0.62, h));
    sky = mix(groundColor, sky, smoothstep(-0.22, 0.015, h));
    float sunAmount = max(dot(dir, normalize(sunDirection)), 0.0);
    sky += sunColor * pow(sunAmount, 180.0) * 1.4;
    sky += sunColor * pow(sunAmount, 8.0) * 0.14;
    gl_FragColor = vec4(sky, 1.0);
  }
`

const nightTop = new THREE.Color('#040713')
const nightHorizon = new THREE.Color('#101a33')
const nightGround = new THREE.Color('#05070d')
const dayTop = new THREE.Color('#3276c8')
const dayHorizon = new THREE.Color('#b8ddff')
const dayGround = new THREE.Color('#93b6cf')
const duskTop = new THREE.Color('#3a4478')
const duskHorizon = new THREE.Color('#ff9a5e')
const duskGround = new THREE.Color('#6b5b63')
const sunDay = new THREE.Color('#fff5dc')
const sunDusk = new THREE.Color('#ffae63')
const moonColor = new THREE.Color('#a9c1ff')

function clamp01(value) {
  return Math.max(0, Math.min(1, value))
}

function smoothstep(edge0, edge1, value) {
  const t = clamp01((value - edge0) / (edge1 - edge0))
  return t * t * (3 - 2 * t)
}

function makeGlowTexture(inner, outer) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64)
  gradient.addColorStop(0, inner)
  gradient.addColorStop(0.25, outer)
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 128, 128)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

export class Sky {
  constructor(scene, camera, renderDistance = 80) {
    this.scene = scene
    this.camera = camera
    this.renderDistance = renderDistance
    this.timeOfDay = 0.235
    this.dayLength = 720
    this.sunDirection = new THREE.Vector3(0, 1, 0)
    this.tmpColor = new THREE.Color()
    this.tmpColor2 = new THREE.Color()

    this.groundColor = new THREE.Color()
    this.cloudDummy = new THREE.Object3D()

    this.uniforms = {
      topColor: { value: dayTop.clone() },
      horizonColor: { value: dayHorizon.clone() },
      groundColor: { value: dayGround.clone() },
      sunColor: { value: sunDay.clone() },
      sunDirection: { value: this.sunDirection }
    }
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(640, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        depthWrite: false,
        fog: false
      })
    )
    this.dome.frustumCulled = false
    this.dome.renderOrder = -10
    scene.add(this.dome)

    this.lightGroup = new THREE.Group()
    scene.add(this.lightGroup)

    const glow = makeGlowTexture('rgba(255,252,235,1)', 'rgba(255,214,150,0.52)')
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glow, color: 0xffffff, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending
    }))
    this.sunSprite.scale.setScalar(110)
    this.sunSprite.renderOrder = -8
    this.lightGroup.add(this.sunSprite)

    const moonGlow = makeGlowTexture('rgba(235,244,255,1)', 'rgba(160,190,255,0.35)')
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: moonGlow, color: 0xdfe9ff, transparent: true, depthWrite: false, fog: false,
      blending: THREE.AdditiveBlending
    }))
    this.moonSprite.scale.setScalar(70)
    this.moonSprite.renderOrder = -8
    this.lightGroup.add(this.moonSprite)

    const starCount = 900
    const starPositions = new Float32Array(starCount * 3)
    for (let i = 0; i < starCount; i++) {
      const u = Math.random() * 2 - 1
      const theta = Math.random() * Math.PI * 2
      const r = Math.sqrt(1 - u * u)
      const radius = 600
      starPositions[i * 3] = Math.cos(theta) * r * radius
      starPositions[i * 3 + 1] = Math.abs(u) * radius
      starPositions[i * 3 + 2] = Math.sin(theta) * r * radius
    }
    const starGeometry = new THREE.BufferGeometry()
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
    this.starMaterial = new THREE.PointsMaterial({
      color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false
    })
    this.stars = new THREE.Points(starGeometry, this.starMaterial)
    this.stars.frustumCulled = false
    this.stars.renderOrder = -9
    this.lightGroup.add(this.stars)

    this.hemisphere = new THREE.HemisphereLight(0xbfe3ff, 0x3a4a2a, 0.8)
    scene.add(this.hemisphere)
    this.sunLight = new THREE.DirectionalLight(0xfff2d2, 1.5)
    scene.add(this.sunLight)
    scene.add(this.sunLight.target)
    this.ambient = new THREE.AmbientLight(0xffffff, 0.16)
    scene.add(this.ambient)

    this.clouds = this.createClouds()
    scene.add(this.clouds)

    scene.fog = new THREE.Fog(dayHorizon.clone(), renderDistance * 0.55, renderDistance * 0.98)
    scene.background = new THREE.Color(dayHorizon)
    this.update(0, camera.position)
  }

  createClouds() {
    const count = 72
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.82, depthWrite: false, fog: false
    })
    const mesh = new THREE.InstancedMesh(geometry, material, count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false
    mesh.renderOrder = -7
    this.cloudData = []
    const dummy = new THREE.Object3D()
    for (let i = 0; i < count; i++) {
      const data = {
        x: (Math.random() - 0.5) * 820,
        y: 102 + Math.random() * 24,
        z: (Math.random() - 0.5) * 820,
        sx: 6 + Math.random() * 16,
        sy: 1.6 + Math.random() * 2,
        sz: 6 + Math.random() * 15,
        drift: 0.6 + Math.random() * 0.7
      }
      this.cloudData.push(data)
      dummy.position.set(data.x, data.y, data.z)
      dummy.scale.set(data.sx, data.sy, data.sz)
      dummy.updateMatrix()
      mesh.setMatrixAt(i, dummy.matrix)
    }
    mesh.instanceMatrix.needsUpdate = true
    this.cloudMaterial = material
    this.cloudMesh = mesh
    return mesh
  }

  setTimeOfDay(value) {
    this.timeOfDay = ((value % 1) + 1) % 1
  }

  get isNight() {
    return Math.sin(this.timeOfDay * Math.PI * 2) < -0.08
  }

  update(dt, cameraPosition) {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1
    const angle = this.timeOfDay * Math.PI * 2
    const sunY = Math.sin(angle)
    const sunX = Math.cos(angle)
    this.sunDirection.set(sunX, sunY, Math.cos(angle * 0.5) * 0.32).normalize()

    const daylight = smoothstep(-0.12, 0.28, sunY)
    const twilight = smoothstep(-0.22, 0.05, sunY) * (1 - smoothstep(0.1, 0.45, sunY))

    const top = this.tmpColor.copy(nightTop).lerp(dayTop, daylight).lerp(duskTop, twilight * 0.55)
    const horizon = this.tmpColor2.copy(nightHorizon).lerp(dayHorizon, daylight).lerp(duskHorizon, twilight * 0.85)
    const ground = this.groundColor.copy(nightGround).lerp(dayGround, daylight).lerp(duskGround, twilight * 0.5)

    this.uniforms.topColor.value.copy(top)
    this.uniforms.horizonColor.value.copy(horizon)
    this.uniforms.groundColor.value.copy(ground)
    this.uniforms.sunColor.value.copy(sunDay).lerp(sunDusk, twilight)

    this.hemisphere.intensity = 0.16 + daylight * 0.82
    this.hemisphere.color.copy(nightHorizon).lerp(dayHorizon, daylight)
    this.hemisphere.groundColor.setRGB(0.16 + daylight * 0.18, 0.2 + daylight * 0.18, 0.12 + daylight * 0.1)
    this.sunLight.intensity = 0.1 + daylight * 1.55
    this.sunLight.color.copy(sunDay).lerp(sunDusk, twilight)
    this.ambient.intensity = 0.1 + daylight * 0.16

    this.sunLight.position.copy(cameraPosition).addScaledVector(this.sunDirection, 140)
    this.sunLight.target.position.copy(cameraPosition)
    this.sunLight.target.updateMatrixWorld()

    const sunPos = this.sunDirection.clone().multiplyScalar(430).add(cameraPosition)
    this.sunSprite.position.copy(sunPos)
    this.moonSprite.position.copy(this.sunDirection).multiplyScalar(-430).add(cameraPosition)
    this.sunSprite.material.opacity = smoothstep(-0.08, 0.08, sunY)
    this.moonSprite.material.opacity = smoothstep(-0.02, 0.15, -sunY) * 0.9
    this.starMaterial.opacity = (1 - daylight) * 0.95

    this.dome.position.copy(cameraPosition)
    this.lightGroup.position.copy(cameraPosition)
    this.stars.rotation.y += dt * 0.004

    const fog = this.scene.fog
    fog.color.copy(horizon)
    if (this.scene.background?.isColor) this.scene.background.copy(horizon)

    const cloudTint = 0.18 + daylight * 0.82
    this.cloudMaterial.color.setRGB(cloudTint, cloudTint * 0.99, 1.0 * Math.min(1, 0.35 + daylight * 0.65))

    const dummy = this.cloudDummy
    for (let i = 0; i < this.cloudData.length; i++) {
      const data = this.cloudData[i]
      data.x += data.drift * dt
      if (data.x > 380) data.x -= 760
      dummy.position.set(data.x, data.y, data.z)
      dummy.scale.set(data.sx, data.sy, data.sz)
      dummy.updateMatrix()
      this.cloudMesh.setMatrixAt(i, dummy.matrix)
    }
    this.cloudMesh.instanceMatrix.needsUpdate = true
    this.cloudMesh.position.set(cameraPosition.x, 0, cameraPosition.z)
  }
}
