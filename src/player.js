import { BLOCKS, isLiquid, isSolid, WATER } from './blocks.js'
import { WORLD_HEIGHT } from './world.js'

const EPS = 1e-4

export class Player {
  constructor(world, spawn = { x: 0.5, y: 64, z: 0.5 }) {
    this.world = world
    this.position = { x: spawn.x, y: spawn.y, z: spawn.z }
    this.velocity = { x: 0, y: 0, z: 0 }
    this.width = 0.32
    this.height = 1.8
    this.eyeHeight = 1.62
    this.onGround = false
    this.inWater = false
    this.flying = false
    this.walkDistance = 0
    this.stepTimer = 0
    this.jumpHeld = false
    this.events = { jumped: false, landed: false, stepped: false, splashed: false }
    this.ensureFree()
  }

  get eye() {
    return { x: this.position.x, y: this.position.y + this.eyeHeight, z: this.position.z }
  }

  blockAt(x, y, z) {
    return this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))
  }

  collides(px, py, pz) {
    const half = this.width
    const minX = px - half
    const maxX = px + half
    const minY = py
    const maxY = py + this.height
    const minZ = pz - half
    const maxZ = pz + half
    const x0 = Math.floor(minX)
    const x1 = Math.floor(maxX - EPS)
    const y0 = Math.floor(minY)
    const y1 = Math.floor(maxY - EPS)
    const z0 = Math.floor(minZ)
    const z1 = Math.floor(maxZ - EPS)
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (isSolid(this.world.getBlock(x, y, z))) return true
        }
      }
    }
    return false
  }

  ensureFree() {
    for (let i = 0; i < 12 && this.collides(this.position.x, this.position.y, this.position.z); i++) {
      this.position.y += 1
    }
    if (this.position.y < 0) {
      this.position.y = 1
      this.velocity.y = 0
    }
  }

  respawn(spawn) {
    this.position = { ...spawn }
    this.velocity = { x: 0, y: 0, z: 0 }
    this.ensureFree()
  }

  update(dt, input) {
    const steps = Math.min(5, Math.max(1, Math.ceil(dt / (1 / 60))))
    const sub = dt / steps
    for (let i = 0; i < steps; i++) this.step(sub, input)
    return this.events
  }

  step(dt, input) {
    this.events.jumped = false
    this.events.landed = false
    this.events.stepped = false
    const pos = this.position
    const vel = this.velocity
    const yaw = input.yaw || 0
    const forwardX = -Math.sin(yaw)
    const forwardZ = -Math.cos(yaw)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)
    const forwardInput = input.forward || 0
    const strafeInput = input.strafe || 0
    let wishX = forwardX * forwardInput + rightX * strafeInput
    let wishZ = forwardZ * forwardInput + rightZ * strafeInput
    const wishLength = Math.hypot(wishX, wishZ)
    if (wishLength > 1) {
      wishX /= wishLength
      wishZ /= wishLength
    }

    const feetBlock = this.blockAt(pos.x, pos.y + 0.15, pos.z)
    const headBlock = this.blockAt(pos.x, pos.y + this.eyeHeight, pos.z)
    const wasInWater = this.inWater
    this.inWater = isLiquid(feetBlock) || isLiquid(headBlock)
    if (this.inWater && !wasInWater) this.events.splashed = true
    if (!this.inWater) this.events.splashed = false

    let speed = input.sprint ? 6.6 : 4.6
    if (this.inWater) speed = 3.0
    if (this.flying) speed = input.sprint ? 19 : 11

    const accel = this.flying ? 12 : this.onGround ? 16 : this.inWater ? 7 : 5
    const blend = 1 - Math.exp(-accel * dt)
    vel.x += (wishX * speed - vel.x) * blend
    vel.z += (wishZ * speed - vel.z) * blend
    if (Math.abs(vel.x) < 0.001) vel.x = 0
    if (Math.abs(vel.z) < 0.001) vel.z = 0

    const jumpPressed = Boolean(input.jump) && !this.jumpHeld
    this.jumpHeld = Boolean(input.jump)

    if (this.flying) {
      let targetY = 0
      if (input.jump) targetY = speed
      else if (input.descend) targetY = -speed
      vel.y += (targetY - vel.y) * (1 - Math.exp(-10 * dt))
    } else if (this.inWater) {
      vel.y -= 7.5 * dt
      if (input.jump) vel.y += 17 * dt
      vel.y = Math.max(-2.6, Math.min(3.4, vel.y))
    } else {
      vel.y -= 29 * dt
      if (jumpPressed && this.onGround) {
        vel.y = 8.7
        this.onGround = false
        this.events.jumped = true
      }
      if (vel.y < -42) vel.y = -42
    }

    this.onGround = false
    this.moveAxis('x', vel.x * dt)
    this.moveAxis('z', vel.z * dt)
    this.moveAxis('y', vel.y * dt)

    if (pos.y < -8) {
      this.position.y = WORLD_HEIGHT
      vel.y = 0
    }
    if (pos.y > WORLD_HEIGHT + 24) {
      pos.y = WORLD_HEIGHT + 24
      vel.y = Math.min(vel.y, 0)
    }

    if (this.onGround) {
      const horizontal = Math.hypot(vel.x, vel.z)
      this.walkDistance += horizontal * dt
      if (horizontal > 0.8) {
        this.stepTimer -= dt
        if (this.stepTimer <= 0) {
          this.stepTimer = input.sprint ? 0.32 : 0.45
          this.events.stepped = true
        }
      } else {
        this.stepTimer = 0
      }
    }
  }

  moveAxis(axis, delta) {
    if (delta === 0) return
    const pos = this.position
    const old = pos[axis]
    pos[axis] += delta
    if (!this.collides(pos.x, pos.y, pos.z)) return
    pos[axis] = old
    if (axis === 'y') {
      if (delta < 0) {
        this.onGround = true
        if (this.velocity.y < -8) this.events.landed = true
      }
      this.velocity.y = 0
    } else {
      this.velocity[axis] = 0
    }
  }

  isBlockAtFeet(id) {
    return this.blockAt(this.position.x, this.position.y + 0.2, this.position.z) === id
  }

  getSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z)
  }
}

export function isWaterBlock(id) {
  return BLOCKS[id]?.liquid === true
}

export { WATER }
