import test from 'node:test'
import assert from 'node:assert/strict'
import { World, CHUNK_SIZE, WORLD_HEIGHT, SEA_LEVEL, blockKey } from '../src/world.js'
import { AIR, BEDROCK, GRASS, STONE, WATER } from '../src/blocks.js'

test('world generation is deterministic for a seed', () => {
  const a = new World('DETERMINISTIC')
  const b = new World('DETERMINISTIC')
  const chunkA = a.ensureChunk(2, -3)
  const chunkB = b.ensureChunk(2, -3)
  assert.deepEqual(Array.from(chunkA.blocks), Array.from(chunkB.blocks))
  assert.notDeepEqual(chunkA.blocks, new World('OTHER').ensureChunk(2, -3).blocks)
})

test('chunks have bedrock floors and sensible surface heights', () => {
  const world = new World('TERRAIN')
  for (const [cx, cz] of [[0, 0], [1, 0], [0, -1], [-2, 3]]) {
    const chunk = world.ensureChunk(cx, cz)
    assert.ok(chunk.generated)
    assert.equal(chunk.get(0, 0, 0), BEDROCK)
    let solidTop = -1
    for (let y = 1; y < WORLD_HEIGHT; y++) {
      if (chunk.get(5, y, 5) !== AIR) solidTop = y
    }
    assert.ok(solidTop > 0 && solidTop < WORLD_HEIGHT - 4)
  }
})

test('ocean columns are filled with water up to sea level', () => {
  const world = new World('OCEAN')
  let found = false
  for (let x = -160; x <= 160 && !found; x += 8) {
    for (let z = -160; z <= 160 && !found; z += 8) {
      const height = world.heightAt(x, z)
      if (height < SEA_LEVEL - 4) {
        world.ensureChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))
        assert.equal(world.getBlock(x, SEA_LEVEL, z), WATER)
        assert.ok(world.getBlock(x, height + 1, z) === WATER || world.getBlock(x, height, z) !== AIR)
        found = true
      }
    }
  }
  assert.ok(found, 'expected to find an ocean column')
})

test('spawn search lands on a free surface block', () => {
  const world = new World('SPAWN')
  const spawn = world.findSpawn(8, 8)
  assert.ok(spawn.y > SEA_LEVEL)
  const below = world.getBlock(Math.floor(spawn.x), Math.floor(spawn.y) - 1, Math.floor(spawn.z))
  assert.notEqual(below, AIR)
  assert.notEqual(below, WATER)
  assert.equal(world.getBlock(Math.floor(spawn.x), Math.floor(spawn.y), Math.floor(spawn.z)), AIR)
  assert.equal(world.getBlock(Math.floor(spawn.x), Math.floor(spawn.y) + 1, Math.floor(spawn.z)), AIR)
})

test('block edits persist through save, reload and chunk regeneration', () => {
  const world = new World('EDITS')
  const x = 8
  const y = 40
  const z = 8
  world.ensureChunk(0, 0)
  world.setBlock(x, y, z, STONE)
  assert.equal(world.getBlock(x, y, z), STONE)
  assert.equal(world.edits.get(blockKey(x, y, z)), STONE)

  const saved = world.editList()
  const restored = new World('EDITS', saved)
  restored.ensureChunk(0, 0)
  assert.equal(restored.getBlock(x, y, z), STONE)

  restored.unloadChunk(0, 0)
  assert.equal(restored.getBlock(x, y, z), STONE)
})

test('neighbor chunks are marked dirty after a border edit', () => {
  const world = new World('DIRTY')
  world.ensureChunk(0, 0)
  world.ensureChunk(1, 0)
  const neighbor = world.getChunk(1, 0)
  neighbor.dirty = false
  world.setBlock(CHUNK_SIZE - 1, 40, 5, STONE)
  assert.equal(neighbor.dirty, true)
})

test('breaking and replacing blocks updates chunk data', () => {
  const world = new World('BREAK')
  world.ensureChunk(0, 0)
  world.setBlock(3, 50, 3, GRASS)
  assert.equal(world.getBlock(3, 50, 3), GRASS)
  world.setBlock(3, 50, 3, AIR)
  assert.equal(world.getBlock(3, 50, 3), AIR)
})
