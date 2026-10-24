import test from 'node:test'
import assert from 'node:assert/strict'
import { Noise, hashString, mulberry32 } from '../src/noise.js'
import { ATLAS_SIZE, TILE_SIZE, TILE } from '../src/blocks.js'
import { tileUV } from '../src/textures.js'

test('hashString is stable and unsigned', () => {
  assert.equal(hashString('voxel'), hashString('voxel'))
  assert.notEqual(hashString('voxel'), hashString('voxe1'))
  assert.ok(hashString('voxel') >= 0)
})

test('mulberry32 is deterministic', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  for (let i = 0; i < 20; i++) assert.equal(a(), b())
  const values = Array.from({ length: 100 }, a)
  assert.ok(values.every((value) => value >= 0 && value < 1))
})

test('noise is deterministic, continuous-ish and bounded', () => {
  const a = new Noise(1234)
  const b = new Noise(1234)
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < 500; i++) {
    const x = i * 0.137
    const y = i * 0.071
    const value = a.fbm2(x, y, 4)
    assert.equal(value, b.fbm2(x, y, 4))
    min = Math.min(min, value)
    max = Math.max(max, value)
  }
  assert.ok(min > -1.2 && max < 1.2)
  assert.ok(max - min > 0.2)
})

test('3d noise differs from 2d noise and is bounded', () => {
  const noise = new Noise(7)
  for (let i = 0; i < 100; i++) {
    const value = noise.noise3(i * 0.31, i * 0.17, i * 0.09)
    assert.ok(value > -1.2 && value < 1.2)
  }
})

test('tile UVs stay inside the atlas and do not overlap', () => {
  const seen = new Set()
  for (const tile of [TILE.GRASS_TOP, TILE.STONE, TILE.WATER, TILE.FLOWER]) {
    const [u0, v0, u1, v1] = tileUV(tile)
    assert.ok(u0 >= 0 && u1 <= 1)
    assert.ok(v0 >= 0 && v1 <= 1)
    assert.ok(u0 < u1 && v0 < v1)
    const key = `${Math.floor(u0 * ATLAS_SIZE / TILE_SIZE)},${Math.floor((1 - v1) * ATLAS_SIZE / TILE_SIZE)}`
    assert.ok(!seen.has(key))
    seen.add(key)
  }
})
