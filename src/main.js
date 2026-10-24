import * as THREE from 'three'
import { World, CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL } from './world.js'
import { buildChunkGeometry } from './mesher.js'
import {
  AIR, BLOCKS, HOTBAR, BEDROCK, GLASS, GRASS, LEAVES, LOG, PLANKS, STONE, BRICK, GLOWSTONE,
  blockName, isLiquid, isPlant
} from './blocks.js'
import { buildAtlas, tileUV, drawBlockIcon, averageBlockColor } from './textures.js'
import { Player } from './player.js'
import { raycast } from './raycast.js'
import { Sky } from './sky.js'
import { GameAudio } from './audio.js'
import { Input } from './input.js'

const SAVE_KEY = 'voxelcraft.save.v2'
const DEFAULT_SEED = 'COAST'
const clamp = (v, min, max) => Math.max(min, Math.min(max, v))

const $ = (selector) => document.querySelector(selector)
const canvas = $('#game')
const startScreen = $('#start')
const pauseScreen = $('#pause')
const loadingScreen = $('#loading')
const hud = $('#hud')
const seedInput = $('#seed-input')
const toastEl = $('#toast')

const params = new URLSearchParams(location.search)
if (params.has('new')) {
  try { localStorage.removeItem(SAVE_KEY) } catch {}
  history.replaceState({}, '', location.pathname)
}

const isMobile = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 720
if (isMobile) document.body.classList.add('touch')
else document.body.classList.remove('touch')

const renderRadius = isMobile ? 4 : 5
const initialRadius = 3

const atlasData = buildAtlas()
const atlasTexture = new THREE.CanvasTexture(atlasData.canvas)
atlasTexture.magFilter = THREE.NearestFilter
atlasTexture.minFilter = THREE.NearestFilter
atlasTexture.generateMipmaps = false
atlasTexture.colorSpace = THREE.SRGBColorSpace

const materials = {
  opaque: new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true }),
  cutout: new THREE.MeshLambertMaterial({ map: atlasTexture, vertexColors: true, alphaTest: 0.45 }),
  glass: new THREE.MeshLambertMaterial({
    map: atlasTexture, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide
  }),
  water: new THREE.MeshPhongMaterial({
    color: 0x3f86e8, vertexColors: true, transparent: true, opacity: 0.82, depthWrite: false,
    side: THREE.DoubleSide, shininess: 80, specular: 0xaad4f5
  })
}

materials.water.onBeforeCompile = (shader) => {
  shader.uniforms.uTime = { value: 0 }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform float uTime;')
    .replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      if (normal.y > 0.5) {
        vec4 waterWorld = modelMatrix * vec4(position, 1.0);
        transformed.y += sin(waterWorld.x * 0.32 + uTime * 1.7) * 0.035;
        transformed.y += cos(waterWorld.z * 0.38 + uTime * 1.2) * 0.03;
      }
    `)
  materials.water.userData.shader = shader
}

class Particles {
  constructor(scene) {
    this.max = 220
    this.particles = []
    this.geometry = new THREE.BoxGeometry(0.13, 0.13, 0.13)
    this.material = new THREE.MeshLambertMaterial()
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, this.max)
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.mesh.frustumCulled = false
    this.mesh.count = 0
    this.dummy = new THREE.Object3D()
    this.color = new THREE.Color()
    scene.add(this.mesh)
  }

  spawn(x, y, z, rgb, count = 12, force = 2.6) {
    const r = rgb[0] / 255
    const g = rgb[1] / 255
    const b = rgb[2] / 255
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= this.max) this.particles.shift()
      const life = 0.45 + Math.random() * 0.45
      this.particles.push({
        x: x + (Math.random() - 0.5) * 0.6,
        y: y + (Math.random() - 0.5) * 0.6,
        z: z + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * force,
        vy: 1.1 + Math.random() * force,
        vz: (Math.random() - 0.5) * force,
        life,
        maxLife: life,
        size: 0.5 + Math.random() * 0.8,
        r: r * (0.8 + Math.random() * 0.35),
        g: g * (0.8 + Math.random() * 0.35),
        b: b * (0.8 + Math.random() * 0.35)
      })
    }
  }

  clear() {
    this.particles.length = 0
    this.mesh.count = 0
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]
      p.life -= dt
      if (p.life <= 0) {
        this.particles.splice(i, 1)
        continue
      }
      p.vy -= 16 * dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.z += p.vz * dt
    }
    const count = this.particles.length
    for (let i = 0; i < count; i++) {
      const p = this.particles[i]
      const fade = clamp(p.life / p.maxLife, 0, 1)
      this.dummy.position.set(p.x, p.y, p.z)
      this.dummy.scale.setScalar(p.size * (0.35 + fade * 0.65))
      this.dummy.rotation.set(p.x * 2, p.y * 2 + p.life * 5, p.z * 2)
      this.dummy.updateMatrix()
      this.mesh.setMatrixAt(i, this.dummy.matrix)
      this.color.setRGB(p.r, p.g, p.b)
      this.mesh.setColorAt(i, this.color)
    }
    this.mesh.count = count
    this.mesh.instanceMatrix.needsUpdate = true
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true
  }
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2))
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.12

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.08, 900)
camera.rotation.order = 'YXZ'
scene.add(camera)

const sky = new Sky(scene, camera, renderRadius * 16)
const audio = new GameAudio()
const particles = new Particles(scene)
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)),
  new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
)
highlight.visible = false
highlight.renderOrder = 5
scene.add(highlight)

const handGroup = new THREE.Group()
const handPose = { x: 0.55, y: -0.46, z: -1.08, scale: 0.18 }
handGroup.position.set(handPose.x, handPose.y, handPose.z)
handGroup.scale.setScalar(handPose.scale)
handGroup.rotation.set(0.12, -0.55, 0.1)
camera.add(handGroup)
const handMaterial = new THREE.MeshLambertMaterial({ map: atlasTexture, emissive: 0x1a1a1a, emissiveIntensity: 0.35 })
let handMesh = null

let world = null
let player = null
let spawnPoint = { x: 8.5, y: 64, z: 8.5 }
let state = 'loading'
let savedGame = null
let seedText = ''
let selected = 0
let yaw = 0.72
let pitch = -0.08
let currentTarget = null
let previewAngle = 0
let lastCenter = { cx: 0, cz: 0 }
let saveTimer = 0
let swing = 0
let bobPhase = 0
let toastTimer = 0
let fpsSmoothed = 60
let hudTimer = 0
let tempDir = new THREE.Vector3()
let newWorldConfirm = 0
let pausedByLockLoss = false

const input = new Input({
  element: canvas,
  joystick: $('#joystick'),
  joystickKnob: $('#joystick-knob'),
  isTouch: isMobile,
  onLook: (dx, dy) => {
    yaw -= dx
    pitch = clamp(pitch - dy, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02)
  },
  onBreak: () => mineBlock(),
  onPlace: () => placeBlock(),
  onToggleFly: () => toggleFly(),
  onSelect: (index, relative) => {
    selected = relative ? (selected + index + HOTBAR.length) % HOTBAR.length : index
    updateHotbar()
    audio.ui()
  },
  onPause: () => {
    if (state === 'playing') setPaused(true)
    else if (state === 'paused') setPaused(false)
  },
  onInteract: () => audio.init()
})

function makeBlockGeometry(blockId) {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const block = BLOCKS[blockId]
  const uv = geometry.attributes.uv
  for (let face = 0; face < 6; face++) {
    const [u0, v0, u1, v1] = tileUV(block.tiles[face])
    for (let corner = 0; corner < 4; corner++) {
      const index = face * 4 + corner
      const u = uv.getX(index)
      const v = uv.getY(index)
      uv.setXY(index, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v)
    }
  }
  uv.needsUpdate = true
  return geometry
}

function setHandBlock() {
  if (handMesh) {
    handGroup.remove(handMesh)
    handMesh.geometry.dispose()
  }
  handMesh = new THREE.Mesh(makeBlockGeometry(HOTBAR[selected]), handMaterial)
  handMesh.frustumCulled = false
  const outline = new THREE.LineSegments(
    new THREE.EdgesGeometry(handMesh.geometry),
    new THREE.LineBasicMaterial({ color: 0x0b1118, transparent: true, opacity: 0.5 })
  )
  outline.scale.setScalar(1.002)
  handMesh.add(outline)
  handGroup.add(handMesh)
}


const chunkObjects = new Map()

function disposeChunkMeshes(key) {
  const entry = chunkObjects.get(key)
  if (!entry) return
  for (const mesh of entry.meshes) {
    scene.remove(mesh)
    mesh.geometry.dispose()
  }
  chunkObjects.delete(key)
}

function disposeAllChunks() {
  for (const key of [...chunkObjects.keys()]) disposeChunkMeshes(key)
}

function geometryFromTarget(target) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(target.positions, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(target.normals, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(target.uvs, 2))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(target.colors, 3))
  geometry.setIndex(target.indices)
  geometry.computeBoundingSphere()
  return geometry
}

function buildChunkMesh(chunk) {
  const key = chunk.cx + ',' + chunk.cz
  disposeChunkMeshes(key)
  const data = buildChunkGeometry(chunk, world)
  const meshes = []
  const meshList = [
    ['opaque', data.opaque],
    ['cutout', data.cutout],
    ['glass', data.glass],
    ['water', data.water]
  ]
  for (const [material, target] of meshList) {
    if (!target.indices.length) continue
    const mesh = new THREE.Mesh(geometryFromTarget(target), materials[material])
    mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE)
    if (material === 'water') mesh.renderOrder = 2
    if (material === 'glass') mesh.renderOrder = 1
    scene.add(mesh)
    meshes.push(mesh)
  }
  chunkObjects.set(key, { meshes, chunk })
  chunk.dirty = false
  chunk.meshed = true
}

function neighborsGenerated(cx, cz) {
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const chunk = world.getChunk(cx + dx, cz + dz)
    if (!chunk?.generated) return false
  }
  return true
}

function updateTerrain(centerX, centerZ, budget = 7, radius = renderRadius) {
  if (!world) return
  const start = performance.now()
  const ccx = Math.floor(centerX / CHUNK_SIZE)
  const ccz = Math.floor(centerZ / CHUNK_SIZE)
  if (ccx !== lastCenter.cx || ccz !== lastCenter.cz) {
    lastCenter = { cx: ccx, cz: ccz }
    for (const [key, chunk] of [...world.chunks]) {
      if (Math.max(Math.abs(chunk.cx - ccx), Math.abs(chunk.cz - ccz)) > radius + 2) {
        disposeChunkMeshes(key)
        world.unloadChunk(chunk.cx, chunk.cz)
      }
    }
  }

  let exhausted = false
  for (let r = 0; r <= radius + 1 && !exhausted; r++) {
    for (let dz = -r; dz <= r && !exhausted; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue
        const cx = ccx + dx
        const cz = ccz + dz
        if (!world.getChunk(cx, cz)) {
          world.ensureChunk(cx, cz)
          if (performance.now() - start > budget) {
            exhausted = true
            break
          }
        }
      }
    }
  }

  for (const chunk of world.chunks.values()) {
    if (!chunk.dirty) continue
    const distance = Math.max(Math.abs(chunk.cx - ccx), Math.abs(chunk.cz - ccz))
    if (distance > radius) continue
    if (!neighborsGenerated(chunk.cx, chunk.cz)) continue
    buildChunkMesh(chunk)
    if (performance.now() - start > budget) break
  }
}

function ensureInitialTerrain(position) {
  const ccx = Math.floor(position.x / CHUNK_SIZE)
  const ccz = Math.floor(position.z / CHUNK_SIZE)
  for (let dz = -initialRadius - 1; dz <= initialRadius + 1; dz++) {
    for (let dx = -initialRadius - 1; dx <= initialRadius + 1; dx++) {
      world.ensureChunk(ccx + dx, ccz + dz)
    }
  }
  for (let dz = -initialRadius; dz <= initialRadius; dz++) {
    for (let dx = -initialRadius; dx <= initialRadius; dx++) {
      buildChunkMesh(world.ensureChunk(ccx + dx, ccz + dz))
    }
  }
  lastCenter = { cx: ccx, cz: ccz }
}

function readSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return null
    if (!Array.isArray(data.edits)) data.edits = []
    data.edits = data.edits.filter((edit) => Array.isArray(edit) && edit.length === 4 && edit.every((v) => Number.isFinite(v))).slice(0, 60000)
    if (!data.seedText && Number.isFinite(data.seed)) data.seedText = String(data.seed)
    if (!data.seedText) data.seedText = 'DEFAULT'
    return data
  } catch {
    return null
  }
}

function saveGame() {
  if (!world || !player) return
  try {
    const data = {
      v: 2,
      seedText,
      seed: world.seed,
      edits: world.editList(),
      player: {
        x: player.position.x,
        y: player.position.y,
        z: player.position.z,
        yaw,
        pitch,
        flying: player.flying
      },
      time: sky.timeOfDay,
      selected
    }
    localStorage.setItem(SAVE_KEY, JSON.stringify(data))
  } catch {}
}

function scheduleSave() {
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(saveGame, 700)
}

function destroyWorld() {
  disposeAllChunks()
  particles.clear()
  currentTarget = null
  highlight.visible = false
  world = null
  player = null
}

function chooseViewYaw(targetWorld, spawn) {
  let bestYaw = 0.72
  let bestScore = -Infinity
  const eyeY = spawn.y + 1.62
  const seaVisible = (x, z, distance) => {
    const steps = Math.max(2, Math.ceil(distance / 2))
    for (let step = 1; step < steps; step++) {
      const t = step / steps
      const px = spawn.x + (x - spawn.x) * t
      const pz = spawn.z + (z - spawn.z) * t
      const rayY = eyeY + (SEA_LEVEL - eyeY) * t
      if (targetWorld.heightAt(Math.floor(px), Math.floor(pz)) > rayY + 0.2) return false
    }
    return true
  }
  for (let i = 0; i < 32; i++) {
    const candidateYaw = (i / 32) * Math.PI * 2
    let score = 0
    let land = 0
    let water = 0
    let trees = 0
    for (let distance = 2; distance <= 20; distance += 2) {
      const x = Math.floor(spawn.x - Math.sin(candidateYaw) * distance)
      const z = Math.floor(spawn.z - Math.cos(candidateYaw) * distance)
      const height = targetWorld.heightAt(x, z)
      if (height <= 32) {
        if (seaVisible(x, z, distance)) {
          water++
          score += 0.7
        } else {
          score -= 0.2
        }
      } else {
        land++
        score += 0.5
        if (height >= spawn.y - 2 && height <= spawn.y + 3) score += 0.3
        const above = targetWorld.getBlock(x, height + 1, z)
        const canopy = targetWorld.getBlock(x, height + 3, z)
        if (above === LOG || above === LEAVES || canopy === LEAVES) {
          trees++
          score += 0.2
        }
      }
      if (height > spawn.y + 2) score -= 0.25
      const blocker = targetWorld.getBlock(x, Math.floor(eyeY), z)
      if (blocker !== AIR) score -= 1.6
    }
    if (land > 0 && water > 0) score += 1.2
    if (water === 0) score -= 1.8
    score += trees * 0.15
    score -= Math.abs(land - water) * 0.11
    if (score > bestScore) {
      bestScore = score
      bestYaw = candidateYaw
    }
  }
  return bestYaw
}

function layoutHand() {
  const portrait = camera.aspect < 0.85
  if (portrait) {
    handPose.x = 0.32
    handPose.y = -0.4
    handPose.z = -1.45
    handPose.scale = 0.12
  } else {
    handPose.x = 0.55
    handPose.y = -0.46
    handPose.z = -1.08
    handPose.scale = 0.18
  }
  handGroup.position.set(handPose.x, handPose.y, handPose.z)
  handGroup.scale.setScalar(handPose.scale)
}

function createWorld(nextSeed, edits = [], saved = null) {
  destroyWorld()
  seedText = nextSeed
  world = new World(seedText, edits)
  world.onChunkDirty = (chunk) => { chunk.dirty = true }
  spawnPoint = world.findSpawn(8, 8)
  const savedPlayer = saved?.player
  if (!savedPlayer) world.clearSpawnArea(spawnPoint.x, spawnPoint.z, 4)
  const startPosition = savedPlayer && [savedPlayer.x, savedPlayer.y, savedPlayer.z].every(Number.isFinite)
    ? { x: savedPlayer.x, y: savedPlayer.y, z: savedPlayer.z }
    : spawnPoint
  player = new Player(world, startPosition)
  player.flying = Boolean(savedPlayer?.flying)
  yaw = Number.isFinite(savedPlayer?.yaw) ? savedPlayer.yaw : chooseViewYaw(world, spawnPoint)
  pitch = Number.isFinite(savedPlayer?.pitch) ? savedPlayer.pitch : -0.08
  selected = Number.isInteger(saved?.selected) ? clamp(saved.selected, 0, HOTBAR.length - 1) : 0
  if (Number.isFinite(saved?.time)) sky.setTimeOfDay(saved.time)
  previewAngle = 0
  ensureInitialTerrain(player.position)
  updateHotbar()
  updateFlyButton()
  lastCenter = {
    cx: Math.floor(player.position.x / CHUNK_SIZE),
    cz: Math.floor(player.position.z / CHUNK_SIZE)
  }
}

function updateHotbar() {
  const slots = document.querySelectorAll('#hotbar .slot')
  slots.forEach((slot, index) => slot.classList.toggle('selected', index === selected))
  setHandBlock()
}

function updateFlyButton() {
  $('#fly-btn')?.classList.toggle('active', Boolean(player?.flying))
}

function buildHotbar() {
  const hotbar = $('#hotbar')
  hotbar.innerHTML = ''
  HOTBAR.forEach((id, index) => {
    const slot = document.createElement('button')
    slot.type = 'button'
    slot.className = 'slot'
    slot.setAttribute('aria-label', `${blockName(id)} (${index + 1})`)
    slot.dataset.block = String(id)
    const icon = document.createElement('canvas')
    icon.width = 64
    icon.height = 64
    drawBlockIcon(icon, id, atlasData)
    const number = document.createElement('span')
    number.textContent = String(index + 1)
    slot.append(icon, number)
    slot.addEventListener('click', (event) => {
      event.stopPropagation()
      if (state !== 'playing') return
      selected = index
      updateHotbar()
      audio.init()
      audio.ui()
    })
    hotbar.append(slot)
  })
  updateHotbar()
  const titleBlocks = $('#title-blocks')
  if (titleBlocks) {
    titleBlocks.innerHTML = ''
    for (const id of [GRASS, PLANKS, GLOWSTONE, LOG, BRICK, LEAVES]) {
      const icon = document.createElement('canvas')
      icon.width = 80
      icon.height = 80
      drawBlockIcon(icon, id, atlasData)
      titleBlocks.append(icon)
    }
  }
}

function intersectsPlayer(x, y, z) {
  const p = player.position
  const half = player.width + 0.02
  return (
    x + 1 > p.x - half && x < p.x + half &&
    z + 1 > p.z - half && z < p.z + half &&
    y + 1 > p.y + 0.02 && y < p.y + player.height - 0.02
  )
}

function mineBlock() {
  if (state !== 'playing' || !currentTarget) return
  const { x, y, z, block } = currentTarget
  if (block === BEDROCK) {
    showToast('Bedrock cannot be broken')
    return
  }
  if (block === AIR) return
  world.setBlock(x, y, z, AIR)
  const color = averageBlockColor(block, atlasData.tileColors)
  particles.spawn(x + 0.5, y + 0.5, z + 0.5, color, 13, 2.9)
  audio.breakBlock(BLOCKS[block]?.name ?? 'stone')
  swing = 1
  scheduleSave()
  currentTarget = null
  highlight.visible = false
}

function placeBlock() {
  if (state !== 'playing' || !currentTarget) return
  const spot = currentTarget.place
  if (spot.y < 0 || spot.y >= WORLD_HEIGHT) return
  const existing = world.getBlock(spot.x, spot.y, spot.z)
  if (existing !== AIR && !isLiquid(existing) && !isPlant(existing)) return
  if (intersectsPlayer(spot.x, spot.y, spot.z)) {
    showToast('Too close to build there')
    return
  }
  const id = HOTBAR[selected]
  world.setBlock(spot.x, spot.y, spot.z, id)
  const color = averageBlockColor(id, atlasData.tileColors)
  particles.spawn(spot.x + 0.5, spot.y + 0.5, spot.z + 0.5, color, 6, 1.4)
  audio.placeBlock()
  swing = 1
  scheduleSave()
}

function toggleFly() {
  if (!player || state !== 'playing') return
  player.flying = !player.flying
  player.velocity.y = 0
  updateFlyButton()
  showToast(player.flying ? 'Flying enabled — Space up, Shift down' : 'Flying disabled')
  audio.ui()
}

function reviveCurrentTarget() {
  if (!player || state !== 'playing') {
    currentTarget = null
    highlight.visible = false
    return
  }
  camera.getWorldDirection(tempDir)
  currentTarget = raycast(world, camera.position, tempDir, 6.5)
  if (currentTarget) {
    highlight.position.set(currentTarget.x + 0.5, currentTarget.y + 0.5, currentTarget.z + 0.5)
    highlight.visible = true
    const name = blockName(currentTarget.block)
    $('#target-name').textContent = currentTarget.block === BEDROCK ? `${name} · unbreakable` : name
    $('#target-name').classList.add('show')
    $('#crosshair').classList.add('hit')
  } else {
    highlight.visible = false
    $('#target-name').classList.remove('show')
    $('#crosshair').classList.remove('hit')
  }
}

function updateCamera(dt) {
  if (!player) return
  if (state === 'playing' || state === 'paused') {
    const speed = player.getSpeed()
    if (player.onGround && speed > 0.6) bobPhase += dt * (6 + speed * 1.15)
    const bob = player.onGround ? Math.min(1, speed / 5) : 0
    const bobX = Math.cos(bobPhase) * 0.022 * bob
    const bobY = Math.abs(Math.sin(bobPhase)) * 0.045 * bob
    camera.position.set(player.position.x + bobX, player.position.y + player.eyeHeight + bobY, player.position.z)
    camera.rotation.set(pitch, yaw, 0)
    const fovTarget = speed > 6 && !player.flying ? 77 : 72
    camera.fov += (fovTarget - camera.fov) * Math.min(1, dt * 5)
    camera.updateProjectionMatrix()
  } else {
    const center = player ? player.position : spawnPoint
    previewAngle += dt * 0.09
    const cx = center.x + Math.cos(previewAngle) * 20
    const cz = center.z + Math.sin(previewAngle) * 20
    const ground = world ? world.heightAt(Math.floor(cx), Math.floor(cz)) : 40
    const cy = Math.max(center.y + 9, ground + 8)
    camera.position.set(cx, cy, cz)
    camera.lookAt(center.x, center.y + 2.5, center.z)
    camera.fov += (72 - camera.fov) * Math.min(1, dt * 4)
    camera.updateProjectionMatrix()
  }
  if (handGroup) {
    handGroup.visible = state === 'playing'
    if (state === 'playing') {
      swing = Math.max(0, swing - dt * 4.6)
      const speed = player.getSpeed()
      const bob = player.onGround ? Math.min(1, speed / 5) : 0
      const bx = Math.sin(bobPhase) * 0.014 * bob
      const by = Math.abs(Math.cos(bobPhase)) * 0.018 * bob
      handGroup.position.set(handPose.x + bx, handPose.y + by - Math.sin(swing * Math.PI) * 0.1, handPose.z)
      handGroup.rotation.set(0.12 - Math.sin(swing * Math.PI) * 0.5, -0.55, 0.1 + Math.sin(swing * Math.PI) * 0.25)
    }
  }
}

function updateHud(dt) {
  hudTimer -= dt
  if (hudTimer > 0) return
  hudTimer = 0.18
  if (!player) return
  const clock = (sky.timeOfDay * 24 + 6) % 24
  const hours = Math.floor(clock)
  const minutes = Math.floor((clock - hours) * 60)
  $('#clock').textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  $('#coords').textContent = `${Math.floor(player.position.x)}, ${Math.floor(player.position.y)}, ${Math.floor(player.position.z)}`
  $('#fps').textContent = String(Math.round(fpsSmoothed))
  if (state === 'paused') {
    $('#pause-time').textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }
}

function showToast(message, duration = 1900) {
  toastEl.textContent = message
  toastEl.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), duration)
}

function updatePauseStats() {
  if (!world || !player) return
  $('#pause-seed').textContent = seedText
  $('#pause-edits').textContent = String(world.edits.size)
  $('#pause-pos').textContent = `${Math.floor(player.position.x)}, ${Math.floor(player.position.y)}, ${Math.floor(player.position.z)}`
}

function setPaused(paused) {
  if (!player) return
  if (paused && state === 'playing') {
    state = 'paused'
    input.setActive(false)
    highlight.visible = false
    $('#target-name').classList.remove('show')
    pauseScreen.classList.remove('hidden')
    updatePauseStats()
    saveGame()
    if (!isMobile && document.pointerLockElement) {
      try { document.exitPointerLock() } catch {}
    }
  } else if (!paused && state === 'paused') {
    state = 'playing'
    pauseScreen.classList.add('hidden')
    input.setActive(true)
    if (!isMobile) requestPointerLock()
    showToast('Back to the world')
  }
}

function requestPointerLock() {
  try {
    const result = canvas.requestPointerLock?.()
    if (result?.catch) result.catch(() => {})
  } catch {}
}

function startPlaying() {
  if (!world || !player) return
  audio.init()
  state = 'playing'
  startScreen.classList.add('hidden')
  loadingScreen.classList.add('hidden')
  hud.classList.remove('hidden')
  input.setActive(true)
  swing = 0
  showToast(isMobile ? 'Tap a block to mine · Build button to place' : 'Left click to mine · Right click to build', 3200)
  if (!isMobile) {
    requestPointerLock()
  }
}

function regenerateWorld(nextSeed) {
  const seed = (nextSeed || Math.random().toString(36).slice(2, 8)).toUpperCase()
  seedInput.value = seed
  try { localStorage.removeItem(SAVE_KEY) } catch {}
  startScreen.classList.add('hidden')
  loadingScreen.classList.remove('hidden')
  setTimeout(() => {
    createWorld(seed, [])
    sky.setTimeOfDay(0.235)
    lastCenter = { cx: Math.floor(player.position.x / CHUNK_SIZE), cz: Math.floor(player.position.z / CHUNK_SIZE) }
    updateCamera(0)
    startScreen.classList.remove('hidden')
    loadingScreen.classList.add('hidden')
    state = 'menu'
    showToast(`New world · seed ${seed}`)
  }, 40)
}

function bindUi() {
  $('#play-btn').addEventListener('click', () => startPlaying())
  $('#resume-btn').addEventListener('click', () => setPaused(false))
  $('#pause-btn').addEventListener('click', () => {
    if (state === 'playing') setPaused(true)
  })
  $('#sound-btn').addEventListener('click', toggleSound)
  $('#pause-sound-btn').addEventListener('click', toggleSound)
  $('#fly-btn').addEventListener('click', toggleFly)
  $('#new-world-btn').addEventListener('click', () => {
    audio.init()
    audio.ui()
    regenerateWorld(seedInput.value.trim())
  })
  $('#pause-new-btn').addEventListener('click', () => {
    const button = $('#pause-new-btn')
    if (performance.now() - newWorldConfirm < 2600) {
      try { localStorage.removeItem(SAVE_KEY) } catch {}
      location.replace(location.pathname)
      return
    }
    newWorldConfirm = performance.now()
    button.textContent = 'Tap again to confirm'
    button.style.borderColor = 'rgba(255,140,120,0.6)'
    setTimeout(() => {
      if (performance.now() - newWorldConfirm >= 2500) {
        button.textContent = 'New world'
        button.style.borderColor = ''
      }
    }, 2700)
  })
  document.addEventListener('pointerlockchange', () => {
    if (state === 'playing' && !isMobile && !document.pointerLockElement) {
      if (pausedByLockLoss) return
      pausedByLockLoss = true
      setPaused(true)
      pausedByLockLoss = false
    }
  })
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    layoutHand()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      input.reset()
      if (state === 'playing') saveGame()
    }
  })
  window.addEventListener('beforeunload', () => {
    if (world && player) saveGame()
  })
  setInterval(() => {
    if (state === 'playing') saveGame()
  }, 8000)
}

function toggleSound() {
  audio.init()
  const muted = audio.toggleMute()
  document.body.classList.toggle('muted', muted)
  const label = `Sound: ${muted ? 'Off' : 'On'}`
  $('#pause-sound-btn').textContent = label
  if (!muted) audio.ui()
  showToast(muted ? 'Sound off' : 'Sound on', 1100)
}

const clock = new THREE.Clock()
let frameCount = 0

function animate() {
  requestAnimationFrame(animate)
  const dt = Math.min(0.05, clock.getDelta())
  const fps = dt > 0 ? 1 / dt : 60
  fpsSmoothed += (fps - fpsSmoothed) * 0.06

  if (state === 'loading') {
    sky.update(0, camera.position)
    renderer.render(scene, camera)
    return
  }

  if (state === 'playing') {
    const inputState = input.getState()
    const events = player.update(dt, {
      forward: inputState.forward,
      strafe: inputState.strafe,
      jump: inputState.jump,
      sprint: inputState.sprint,
      descend: inputState.descend,
      yaw
    })
    if (events.jumped) audio.jump()
    if (events.landed) audio.land()
    if (events.stepped) {
      audio.step(player.isBlockAtFeet(GRASS))
      const below = world.getBlock(Math.floor(player.position.x), Math.floor(player.position.y - 0.2), Math.floor(player.position.z))
      if (below && Math.random() < 0.6) {
        particles.spawn(player.position.x, player.position.y + 0.05, player.position.z, averageBlockColor(below, atlasData.tileColors), 1, 0.8)
      }
    }
    if (events.splashed) audio.splash()
    if (player.position.y < -4) {
      player.respawn(spawnPoint)
      showToast('Returned to spawn')
    }
    updateTerrain(player.position.x, player.position.z, 6.5)
    updateCamera(dt)
    reviveCurrentTarget()
    sky.update(dt, camera.position)
    particles.update(dt)
    if (frameCount % 45 === 0 && fpsSmoothed < 33 && renderer.getPixelRatio() > 1) {
      renderer.setPixelRatio(1)
    }
  } else if (state === 'paused') {
    updateCamera(0)
    sky.update(0, camera.position)
    particles.update(0)
    updateHud(dt)
  } else {
    updateCamera(dt)
    sky.update(dt, camera.position)
    particles.update(dt)
    if (world && renderer.getPixelRatio() < Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2)) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2))
    }
  }

  updateHud(dt)
  const waterShader = materials.water.userData.shader
  if (waterShader) waterShader.uniforms.uTime.value = performance.now() * 0.001
  renderer.render(scene, camera)
  frameCount++
}

function boot() {
  savedGame = readSave()
  const seed = savedGame?.seedText || DEFAULT_SEED
  seedInput.value = seed
  audio.setMuted(false)
  createWorld(seed, savedGame?.edits || [], savedGame)
  buildHotbar()
  bindUi()
  renderer.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  layoutHand()
  $('#pause-seed').textContent = seedText
  $('#pause-edits').textContent = String(world?.edits.size ?? 0)
  updateCamera(0)
  state = 'menu'
  loadingScreen.classList.add('hidden')
  startScreen.classList.remove('hidden')
  if (savedGame) showToast('Saved world restored', 2200)
  setTimeout(() => { if (state === 'menu') startScreen.classList.remove('hidden') }, 0)
  animate()
}

if (typeof window !== 'undefined') {
  window.__voxelcraft = {
    version: 1,
    get state() { return state },
    get player() { return player },
    get world() { return world },
    get target() { return currentTarget },
    get selected() { return selected },
    get spawn() { return spawnPoint },
    get scene() { return scene },
    get camera() { return camera },
    get hand() { return handGroup },
    get atlas() { return atlasData },
    get seedText() { return seedText },
    get yaw() { return yaw },
    get pitch() { return pitch },
    start: startPlaying,
    newWorld: regenerateWorld,
    pause: () => setPaused(true),
    resume: () => setPaused(false),
    mine: mineBlock,
    place: placeBlock,
    save: saveGame,
    refreshTarget: reviveCurrentTarget,
    look: (nextYaw, nextPitch) => {
      yaw = nextYaw
      pitch = nextPitch
      camera.rotation.set(pitch, yaw, 0)
    },
    teleport: (x, y, z) => {
      if (!player) return
      player.position.x = x
      player.position.y = y
      player.position.z = z
      player.velocity.x = 0
      player.velocity.y = 0
      player.velocity.z = 0
    },
    setBlock: (x, y, z, id) => { if (world) world.setBlock(x, y, z, id) },
    getBlock: (x, y, z) => (world ? world.getBlock(x, y, z) : null),
    select: (index) => {
      selected = clamp(index, 0, HOTBAR.length - 1)
      updateHotbar()
    },
    raycastAt: (nx, ny) => {
      const raycaster = new THREE.Raycaster()
      raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera)
      return raycaster.intersectObjects(scene.children, true).slice(0, 4).map((hit) => ({
        point: hit.point.toArray(),
        distance: hit.distance,
        material: Array.isArray(hit.object.material) ? 'array' : hit.object.material.type,
        normal: hit.face ? hit.face.normal.toArray() : null
      }))
    }
  }
}

requestAnimationFrame(() => {
  requestAnimationFrame(() => boot())
})
