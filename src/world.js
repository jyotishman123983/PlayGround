import { Noise, mulberry32, hashString } from './noise.js'
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, COBBLE, WATER, SNOW, TALL_GRASS,
  FLOWER, BEDROCK, COAL_ORE, SANDSTONE, MOSSY_COBBLE, GRAVEL, ICE, BLOCKS
} from './blocks.js'

export const CHUNK_SIZE = 16
export const WORLD_HEIGHT = 96
export const SEA_LEVEL = 32

export const chunkKey = (cx, cz) => cx + ',' + cz
export const blockKey = (x, y, z) => x + ',' + y + ',' + z

export function localIndex(x, y, z) {
  return x + z * CHUNK_SIZE + y * CHUNK_SIZE * CHUNK_SIZE
}

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx
    this.cz = cz
    this.blocks = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT)
    this.generated = false
    this.dirty = true
    this.meshed = false
  }

  get(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return AIR
    return this.blocks[localIndex(x, y, z)]
  }

  set(x, y, z, id) {
    if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE || y < 0 || y >= WORLD_HEIGHT) return
    this.blocks[localIndex(x, y, z)] = id
  }
}

export class World {
  constructor(seed = 12345, edits = []) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0
    this.noise = new Noise(this.seed)
    this.chunks = new Map()
    this.edits = new Map()
    this.editsByChunk = new Map()
    this.onChunkDirty = null
    for (const edit of edits) this.applyEdit(edit)
  }

  applyEdit(edit) {
    const [x, y, z, id] = edit
    this.edits.set(blockKey(x, y, z), id)
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    const key = chunkKey(cx, cz)
    if (!this.editsByChunk.has(key)) this.editsByChunk.set(key, [])
    this.editsByChunk.get(key).push([x, y, z, id])
    const chunk = this.chunks.get(key)
    if (chunk?.generated) chunk.set(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE, id)
  }

  heightAt(wx, wz) {
    const base = this.noise.fbm2(wx * 0.0045, wz * 0.0045, 4)
    const detail = this.noise.fbm2(wx * 0.014 + 300, wz * 0.014 - 120, 3)
    const mountain = this.noise.noise2(wx * 0.0022 + 800, wz * 0.0022 + 800)
    let height = SEA_LEVEL + 2 + base * 24 + detail * 5
    if (mountain > 0.18) height += (mountain - 0.18) * 58 * (0.65 + 0.35 * detail)
    return Math.max(5, Math.min(WORLD_HEIGHT - 12, Math.round(height)))
  }

  biomeAt(wx, wz, height = this.heightAt(wx, wz)) {
    const temp = this.noise.fbm2(wx * 0.006 + 11, wz * 0.006 - 7, 3)
    const moist = this.noise.fbm2(wx * 0.009 - 31, wz * 0.009 + 17, 3)
    if (height > 61) return 'mountain'
    if (temp > 0.3) return 'desert'
    if (temp < -0.26) return 'snow'
    if (moist > 0.05) return 'forest'
    return 'plains'
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz))
  }

  ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz)
    let chunk = this.chunks.get(key)
    if (!chunk) {
      chunk = new Chunk(cx, cz)
      this.chunks.set(key, chunk)
    }
    if (!chunk.generated) this.generateChunk(chunk)
    return chunk
  }

  generateChunk(chunk) {
    const { cx, cz, blocks } = chunk
    const random = mulberry32((this.seed ^ Math.imul(cx, 374761393) ^ Math.imul(cz, 668265263)) >>> 0)
    const trees = []
    const plants = []

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = cx * CHUNK_SIZE + lx
        const wz = cz * CHUNK_SIZE + lz
        const height = this.heightAt(wx, wz)
        const biome = this.biomeAt(wx, wz, height)
        const beach = height <= SEA_LEVEL + 2 && biome !== 'snow'

        for (let y = 0; y <= Math.max(height, SEA_LEVEL); y++) {
          let id = AIR
          if (y === 0) {
            id = BEDROCK
          } else if (y <= height) {
            const depth = height - y
            if (depth === 0) {
              if (biome === 'desert') id = SAND
              else if (biome === 'snow') id = SNOW
              else if (biome === 'mountain') id = height > 63 ? SNOW : STONE
              else if (beach) id = SAND
              else id = GRASS
            } else if (depth < 4) {
              if (biome === 'desert') id = depth < 3 ? SAND : SANDSTONE
              else if (biome === 'mountain') id = STONE
              else if (beach) id = depth < 2 ? SAND : SANDSTONE
              else id = DIRT
            } else {
              id = STONE
              if (y < height - 6 && this.noise.noise3(wx * 0.13, y * 0.13, wz * 0.13) > 0.63) id = COAL_ORE
            }

            if (y > 2 && y < height && id !== BEDROCK) {
              const cave = this.noise.noise3(wx * 0.055, y * 0.09, wz * 0.055)
              const tunnel = this.noise.noise3(wx * 0.03 + 50, y * 0.05, wz * 0.03 - 20)
              if (cave > 0.47 || Math.abs(tunnel) < 0.035) id = AIR
            }
          } else if (y <= SEA_LEVEL) {
            id = biome === 'snow' ? ICE : WATER
          }
          blocks[localIndex(lx, y, lz)] = id
        }

        if (height > SEA_LEVEL - 2 && height < 59 && !beach) {
          const top = blocks[localIndex(lx, height, lz)]
          const above = blocks[localIndex(lx, height + 1, lz)]
          if ((top === GRASS || top === SNOW) && above === AIR) {
            if (random() < 0.055) plants.push([lx, height + 1, lz, TALL_GRASS])
            else if (random() < 0.014) plants.push([lx, height + 1, lz, FLOWER])
          }
        }

      }
    }

    const centerBiome = this.biomeAt(cx * CHUNK_SIZE + 8, cz * CHUNK_SIZE + 8)
    const attempts = centerBiome === 'forest' ? 9 : centerBiome === 'plains' ? 3 : centerBiome === 'snow' ? 3 : 0
    for (let i = 0; i < attempts; i++) {
      const lx2 = 3 + Math.floor(random() * 10)
      const lz2 = 3 + Math.floor(random() * 10)
      const wx2 = cx * CHUNK_SIZE + lx2
      const wz2 = cz * CHUNK_SIZE + lz2
      const h2 = this.heightAt(wx2, wz2)
      const b2 = this.biomeAt(wx2, wz2, h2)
      if (b2 !== 'forest' && b2 !== 'plains' && b2 !== 'snow') continue
      if (h2 <= SEA_LEVEL + 1 || h2 >= 58) continue
      const topId = blocks[localIndex(lx2, h2, lz2)]
      if (topId !== GRASS && topId !== SNOW) continue
      if (blocks[localIndex(lx2, h2 + 1, lz2)] !== AIR) continue
      if (trees.some((tree) => (tree[0] - lx2) ** 2 + (tree[2] - lz2) ** 2 < 9)) continue
      trees.push([lx2, h2, lz2, 4 + Math.floor(random() * 3), b2])
    }

    for (const [lx, h, lz, trunkHeight, biome] of trees) {
      const top = Math.min(WORLD_HEIGHT - 4, h + trunkHeight)
      for (let y = h + 1; y <= top; y++) blocks[localIndex(lx, y, lz)] = LOG
      const leafBase = top - 2
      for (let y = leafBase; y <= top + 1; y++) {
        const radius = y <= leafBase + 1 ? 2 : 1
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx === 0 && dz === 0 && y <= top) continue
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && (y === top + 1 || random() < 0.45)) continue
            const nx = lx + dx
            const nz = lz + dz
            if (nx < 1 || nx > 14 || nz < 1 || nz > 14) continue
            if (blocks[localIndex(nx, y, nz)] === AIR) blocks[localIndex(nx, y, nz)] = LEAVES
          }
        }
      }
      if (biome === 'snow') blocks[localIndex(lx, top + 2, lz)] = LEAVES
    }

    for (const [lx, y, lz, id] of plants) {
      if (blocks[localIndex(lx, y, lz)] === AIR) blocks[localIndex(lx, y, lz)] = id
    }

    if (cx === 0 && cz === 0) {
      for (let lx = 5; lx < 11; lx++) {
        for (let lz = 5; lz < 11; lz++) {
          const h = this.heightAt(lx, lz)
          for (let y = h + 1; y < WORLD_HEIGHT; y++) blocks[localIndex(lx, y, lz)] = AIR
          blocks[localIndex(lx, h, lz)] = GRASS
        }
      }
      for (let i = 0; i < 5; i++) {
        const lx = 4 + Math.floor(random() * 8)
        const lz = 14 + Math.floor(random() * 2)
        if (lx > 1 && lx < 14) {
          const h = this.heightAt(lx, lz)
          if (h > SEA_LEVEL) {
            blocks[localIndex(lx, h, lz)] = COBBLE
            blocks[localIndex(lx, h + 1, lz)] = random() < 0.4 ? MOSSY_COBBLE : COBBLE
          }
        }
      }
    }

    const edits = this.editsByChunk.get(chunkKey(cx, cz))
    if (edits) {
      for (const [x, y, z, id] of edits) chunk.set(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE, id)
    }

    chunk.generated = true
    chunk.dirty = true
  }

  getBlock(x, y, z) {
    if (y < 0) return BEDROCK
    if (y >= WORLD_HEIGHT) return AIR
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    const chunk = this.chunks.get(chunkKey(cx, cz)) || this.ensureChunk(cx, cz)
    return chunk.get(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE)
  }

  isGenerated(x, y, z) {
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    return this.chunks.get(chunkKey(cx, cz))?.generated ?? false
  }

  setBlock(x, y, z, id, record = true) {
    if (y < 0 || y >= WORLD_HEIGHT) return false
    const cx = Math.floor(x / CHUNK_SIZE)
    const cz = Math.floor(z / CHUNK_SIZE)
    const chunk = this.chunks.get(chunkKey(cx, cz)) || this.ensureChunk(cx, cz)
    chunk.set(x - cx * CHUNK_SIZE, y, z - cz * CHUNK_SIZE, id)
    chunk.dirty = true
    if (this.onChunkDirty) this.onChunkDirty(chunk)
    const lx = x - cx * CHUNK_SIZE
    const lz = z - cz * CHUNK_SIZE
    const neighbors = []
    if (lx === 0) neighbors.push([cx - 1, cz])
    if (lx === CHUNK_SIZE - 1) neighbors.push([cx + 1, cz])
    if (lz === 0) neighbors.push([cx, cz - 1])
    if (lz === CHUNK_SIZE - 1) neighbors.push([cx, cz + 1])
    for (const [nx, nz] of neighbors) {
      const neighbor = this.chunks.get(chunkKey(nx, nz))
      if (neighbor?.generated) {
        neighbor.dirty = true
        if (this.onChunkDirty) this.onChunkDirty(neighbor)
      }
    }
    if (record) {
      const key = blockKey(x, y, z)
      this.edits.set(key, id)
      const ckey = chunkKey(cx, cz)
      if (!this.editsByChunk.has(ckey)) this.editsByChunk.set(ckey, [])
      const list = this.editsByChunk.get(ckey)
      const existing = list.find((edit) => edit[0] === x && edit[1] === y && edit[2] === z)
      if (existing) existing[3] = id
      else list.push([x, y, z, id])
    }
    return true
  }

  unloadChunk(cx, cz) {
    this.chunks.delete(chunkKey(cx, cz))
  }

  editList() {
    const result = []
    for (const [key, id] of this.edits) {
      const [x, y, z] = key.split(',').map(Number)
      result.push([x, y, z, id])
    }
    return result
  }

  clearSpawnArea(x, z, radius = 3) {
    const centerX = Math.floor(x)
    const centerZ = Math.floor(z)
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const wx = centerX + dx
        const wz = centerZ + dz
        let y = WORLD_HEIGHT - 1
        while (y > 0) {
          const id = this.getBlock(wx, y, wz)
          if (id === LEAVES || id === LOG || id === TALL_GRASS || id === FLOWER) {
            this.setBlock(wx, y, wz, AIR)
            y--
            continue
          }
          if (id === AIR) {
            y--
            continue
          }
          break
        }
        for (let k = 1; k <= 4; k++) {
          if (this.getBlock(wx, y + k, wz) !== AIR) this.setBlock(wx, y + k, wz, AIR)
        }
      }
    }
  }

  findSpawn(startX = 8, startZ = 8) {
    const candidates = [[startX, startZ]]
    for (let radius = 1; radius <= 12; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        candidates.push([startX + dx, startZ - radius], [startX + dx, startZ + radius])
      }
      for (let dz = -radius + 1; dz <= radius - 1; dz++) {
        candidates.push([startX - radius, startZ + dz], [startX + radius, startZ + dz])
      }
    }

    let best = null
    let bestScore = Infinity
    const samples = [
      [0, 0], [3, 0], [-3, 0], [0, 3], [0, -3],
      [3, 3], [-3, -3], [3, -3], [-3, 3],
      [6, 0], [-6, 0], [0, 6], [0, -6]
    ]
    for (const [x, z] of candidates) {
      this.ensureChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE))
      let surface = null
      for (let y = WORLD_HEIGHT - 2; y > SEA_LEVEL; y--) {
        const id = this.getBlock(x, y, z)
        if (id !== GRASS && id !== SNOW && id !== STONE) continue
        if (this.getBlock(x, y + 1, z) !== AIR || this.getBlock(x, y + 2, z) !== AIR) continue
        surface = { y, id }
        break
      }
      if (!surface) continue

      let minHeight = Infinity
      let maxHeight = -Infinity
      for (const [dx, dz] of samples) {
        const height = this.heightAt(x + dx, z + dz)
        minHeight = Math.min(minHeight, height)
        maxHeight = Math.max(maxHeight, height)
      }
      let treePenalty = 0
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          for (let dy = 1; dy <= 5; dy++) {
            const id = this.getBlock(x + dx, surface.y + dy, z + dz)
            if (id === LOG || id === LEAVES) treePenalty++
          }
        }
      }
      const distance = Math.max(Math.abs(x - startX), Math.abs(z - startZ))
      let score = (maxHeight - minHeight) * 4 + treePenalty * 0.22 + distance * 0.3
      if (surface.id === SAND) score += 14
      if (surface.id === STONE) score += 3
      if (surface.y <= SEA_LEVEL + 1) score += 10
      if (score < bestScore) {
        bestScore = score
        best = { x: x + 0.5, y: surface.y + 1.001, z: z + 0.5 }
      }
    }
    if (best) return best
    return { x: startX + 0.5, y: 64, z: startZ + 0.5 }
  }

  isBlockSolidAt(x, y, z) {
    return BLOCKS[this.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))]?.solid ?? false
  }
}
