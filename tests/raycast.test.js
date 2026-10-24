import test from 'node:test'
import assert from 'node:assert/strict'
import { raycast } from '../src/raycast.js'
import { AIR, BEDROCK, GLASS, STONE, TALL_GRASS, WATER } from '../src/blocks.js'

function voxelWorld(entries) {
  const map = new Map()
  for (const [x, y, z, id] of entries) map.set(`${x},${y},${z}`, id)
  return {
    getBlock(x, y, z) {
      return map.get(`${x},${y},${z}`) ?? AIR
    }
  }
}

test('ray hits a block and reports the face normal and placement cell', () => {
  const world = voxelWorld([[2, 0, 0, STONE]])
  const hit = raycast(world, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 8)
  assert.ok(hit)
  assert.deepEqual([hit.x, hit.y, hit.z], [2, 0, 0])
  assert.deepEqual(hit.normal, [-1, 0, 0])
  assert.deepEqual(hit.place, { x: 1, y: 0, z: 0 })
  assert.ok(hit.distance > 1 && hit.distance < 2)
})

test('ray passes through water and stops on the seabed', () => {
  const world = voxelWorld([
    [2, 0, 0, WATER],
    [5, 0, 0, STONE]
  ])
  const hit = raycast(world, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 10)
  assert.equal(hit.x, 5)
  assert.equal(hit.block, STONE)
})

test('ray can target cutout plants', () => {
  const world = voxelWorld([[3, 0, 0, TALL_GRASS]])
  const hit = raycast(world, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 6)
  assert.equal(hit.block, TALL_GRASS)
})

test('ray respects the maximum reach', () => {
  const world = voxelWorld([[9, 0, 0, STONE]])
  const hit = raycast(world, { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 6)
  assert.equal(hit, null)
})

test('ray misses when pointing at empty space', () => {
  const world = voxelWorld([])
  const hit = raycast(world, { x: 0.5, y: 0.5, z: 0.5 }, { x: 0, y: 1, z: 0 }, 8)
  assert.equal(hit, null)
})

test('vertical placement normal points up', () => {
  const world = voxelWorld([[1, 0, 0, STONE]])
  const hit = raycast(world, { x: 1.5, y: 3.5, z: 0.5 }, { x: 0, y: -1, z: 0 }, 8)
  assert.ok(hit)
  assert.deepEqual(hit.normal, [0, 1, 0])
  assert.deepEqual(hit.place, { x: 1, y: 1, z: 0 })
})

test('ray treats glass as targetable and bedrock as a solid hit', () => {
  const glassHit = raycast(voxelWorld([[2, 0, 0, GLASS]]), { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 6)
  assert.equal(glassHit.block, GLASS)
  const bedrockHit = raycast(voxelWorld([[2, 0, 0, BEDROCK]]), { x: 0.5, y: 0.5, z: 0.5 }, { x: 1, y: 0, z: 0 }, 6)
  assert.equal(bedrockHit.block, BEDROCK)
})
