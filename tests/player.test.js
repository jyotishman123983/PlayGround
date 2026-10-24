import test from 'node:test'
import assert from 'node:assert/strict'
import { Player } from '../src/player.js'
import { AIR, STONE, WATER } from '../src/blocks.js'

function flatWorld({ waterLevel = -1, wallX = Infinity } = {}) {
  return {
    getBlock(x, y, z) {
      if (x >= wallX) return STONE
      if (y <= 0) return STONE
      if (y <= waterLevel) return WATER
      return AIR
    }
  }
}

test('gravity lands the player on the block surface', () => {
  const world = flatWorld()
  const player = new Player(world, { x: 0.5, y: 5, z: 0.5 })
  for (let i = 0; i < 240; i++) player.update(1 / 60, {})
  assert.ok(Math.abs(player.position.y - 1) < 0.01, `expected y=1, got ${player.position.y}`)
  assert.equal(player.onGround, true)
  assert.equal(player.velocity.y, 0)
})

test('the player cannot walk through a wall', () => {
  const world = flatWorld({ wallX: 2 })
  const player = new Player(world, { x: 0.5, y: 1, z: 0.5 })
  const input = { forward: 1, strafe: 0, yaw: -Math.PI / 2, sprint: true }
  for (let i = 0; i < 180; i++) player.update(1 / 60, input)
  assert.ok(player.position.x < 2 - player.width + 0.001, `penetrated wall at x=${player.position.x}`)
  assert.ok(player.position.x > 1.2)
})

test('jump leaves the ground and returns', () => {
  const player = new Player(flatWorld(), { x: 0.5, y: 1, z: 0.5 })
  player.update(1 / 60, {})
  assert.equal(player.onGround, true)
  let peak = player.position.y
  player.update(1 / 60, { jump: true })
  for (let i = 0; i < 180; i++) {
    player.update(1 / 60, { jump: true })
    peak = Math.max(peak, player.position.y)
    if (i > 30 && player.onGround) break
  }
  assert.ok(peak > 2, `expected a jump above y=2, got ${peak}`)
  assert.equal(player.onGround, true)
})

test('flying rises without gravity', () => {
  const player = new Player(flatWorld(), { x: 0.5, y: 20, z: 0.5 })
  player.flying = true
  for (let i = 0; i < 60; i++) player.update(1 / 60, { jump: true })
  assert.ok(player.position.y > 20)
  player.update(1 / 60, {})
  const before = player.position.y
  for (let i = 0; i < 120; i++) player.update(1 / 60, {})
  assert.ok(Math.abs(player.position.y - before) < 2.2)
})

test('water slows falling and enables swimming', () => {
  const world = flatWorld({ waterLevel: 3 })
  const player = new Player(world, { x: 0.5, y: 5, z: 0.5 })
  for (let i = 0; i < 120; i++) player.update(1 / 60, {})
  assert.equal(player.inWater, true)
  assert.ok(player.position.y > 0.8, 'player should not sink through the floor')
  const before = player.position.y
  for (let i = 0; i < 60; i++) player.update(1 / 60, { jump: true })
  assert.ok(player.position.y > before - 0.1)
})

test('respawn restores a safe position', () => {
  const player = new Player(flatWorld(), { x: 0.5, y: 5, z: 0.5 })
  player.position.y = -6
  player.respawn({ x: 0.5, y: 3, z: 0.5 })
  assert.equal(player.position.y, 3)
  assert.equal(player.velocity.y, 0)
})
