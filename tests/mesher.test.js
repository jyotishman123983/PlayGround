import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChunkGeometry, geometryStats } from '../src/mesher.js'
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from '../src/world.js'
import { AIR, GLASS, LEAVES, STONE, TALL_GRASS, WATER } from '../src/blocks.js'

function emptyChunk(cx = 0, cz = 0) {
  return {
    cx,
    cz,
    generated: true,
    blocks: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT)
  }
}

function fakeWorld(chunk) {
  const empty = emptyChunk(chunk.cx + 10, chunk.cz + 10)
  return {
    getChunk(cx, cz) {
      if (cx === chunk.cx && cz === chunk.cz) return chunk
      return empty
    }
  }
}

function statsFor(blockId, at = [8, 40, 8]) {
  const chunk = emptyChunk()
  chunk.blocks[localIndex(...at)] = blockId
  const data = buildChunkGeometry(chunk, fakeWorld(chunk))
  return {
    data,
    opaque: geometryStats(data.opaque),
    cutout: geometryStats(data.cutout),
    glass: geometryStats(data.glass),
    water: geometryStats(data.water)
  }
}

test('a lone solid block produces six visible faces', () => {
  const result = statsFor(STONE)
  assert.equal(result.opaque.faces, 6)
  assert.equal(result.opaque.vertices, 24)
  assert.equal(result.opaque.indices, 36)
})

test('adjacent blocks cull their shared faces', () => {
  const chunk = emptyChunk()
  chunk.blocks[localIndex(8, 40, 8)] = STONE
  chunk.blocks[localIndex(9, 40, 8)] = STONE
  const data = buildChunkGeometry(chunk, fakeWorld(chunk))
  assert.equal(geometryStats(data.opaque).faces, 10)
})

test('translucent blocks are separated from opaque geometry', () => {
  const glass = statsFor(GLASS)
  assert.equal(glass.opaque.faces, 0)
  assert.equal(glass.glass.faces, 6)
  const water = statsFor(WATER)
  assert.equal(water.water.faces, 6)
  assert.equal(water.opaque.faces, 0)
})

test('leaves and plants use the cutout pass', () => {
  const leaves = statsFor(LEAVES)
  assert.equal(leaves.cutout.faces, 6)
  const grass = statsFor(TALL_GRASS)
  assert.equal(grass.cutout.faces, 4)
  assert.equal(grass.opaque.faces, 0)
})

test('vertices carry uv, normal, color and valid indices', () => {
  const chunk = emptyChunk()
  chunk.blocks[localIndex(8, 40, 8)] = STONE
  const data = buildChunkGeometry(chunk, fakeWorld(chunk)).opaque
  assert.equal(data.positions.length / 3, data.uvs.length / 2)
  assert.equal(data.uvs.length / 2, data.positions.length / 3)
  assert.equal(data.normals.length, data.positions.length)
  assert.equal(data.colors.length, data.positions.length)
  for (const index of data.indices) {
    assert.ok(index >= 0 && index < data.positions.length / 3)
  }
  for (const color of data.colors) {
    assert.ok(color >= 0.4 && color <= 1.05)
  }
})

test('air-only chunks generate empty geometry', () => {
  const chunk = emptyChunk()
  const data = buildChunkGeometry(chunk, fakeWorld(chunk))
  for (const target of Object.values(data)) {
    assert.equal(target.positions.length, 0)
    assert.equal(target.indices.length, 0)
  }
})

test('ungenerated chunks generate no geometry', () => {
  const chunk = emptyChunk()
  chunk.generated = false
  const data = buildChunkGeometry(chunk, fakeWorld(chunk))
  assert.equal(data.opaque.positions.length, 0)
})

test('block ids outside the chunk border are ignored safely', () => {
  const chunk = emptyChunk()
  chunk.blocks[localIndex(0, 40, 0)] = STONE
  const data = buildChunkGeometry(chunk, fakeWorld(chunk))
  const stats = geometryStats(data.opaque)
  assert.ok(stats.faces >= 3 && stats.faces <= 6)
  assert.equal(data.opaque.positions.length % 3, 0)
})
