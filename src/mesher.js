import {
  AIR, BEDROCK, BLOCKS, WATER, isTransparent, faceVisible, occludesAO
} from './blocks.js'
import { CHUNK_SIZE, WORLD_HEIGHT, localIndex } from './world.js'
import { tileUV } from './textures.js'

const AO_LEVELS = [0.5, 0.68, 0.84, 1]
const UV_QUAD = [[0, 0], [0, 1], [1, 1], [1, 0]]
const UV_TOP = [[0, 0], [1, 0], [1, 1], [0, 1]]

const FACES = [
  {
    axis: 0, sign: 1, shade: 0.84,
    corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    uv: UV_QUAD
  },
  {
    axis: 0, sign: -1, shade: 0.84,
    corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
    uv: UV_QUAD
  },
  {
    axis: 1, sign: 1, shade: 1.0,
    corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    uv: UV_TOP
  },
  {
    axis: 1, sign: -1, shade: 0.52,
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    uv: UV_TOP
  },
  {
    axis: 2, sign: 1, shade: 0.72,
    corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]],
    uv: UV_QUAD
  },
  {
    axis: 2, sign: -1, shade: 0.72,
    corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    uv: UV_QUAD
  }
]

function newTarget() {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [] }
}

function addFace(target, x, y, z, face, tile, brightness, topLift = 0) {
  const [u0, v0, u1, v1] = tileUV(tile)
  const base = target.positions.length / 3
  for (let i = 0; i < 4; i++) {
    const corner = face.corners[i]
    const vy = corner[1] === 1 ? 1 - topLift : 0
    target.positions.push(x + corner[0], y + vy, z + corner[2])
    target.normals.push(face.axis === 0 ? face.sign : 0, face.axis === 1 ? face.sign : 0, face.axis === 2 ? face.sign : 0)
    const uv = face.uv[i]
    target.uvs.push(u0 + (u1 - u0) * uv[0], v0 + (v1 - v0) * uv[1])
    const light = brightness[i] ?? brightness
    target.colors.push(light, light, light)
  }
  target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
}

function addPlant(target, x, y, z, tile, randomTilt) {
  const [u0, v0, u1, v1] = tileUV(tile)
  const height = 0.95
  const inset = 0.1
  const ax = x + inset + randomTilt * 0.02
  const az = z + inset
  const bx = x + 1 - inset
  const bz = z + 1 - inset - randomTilt * 0.02
  const quads = [
    [ax, az, bx, bz],
    [bx, az, ax, bz]
  ]
  for (const [x0, z0, x1, z1] of quads) {
    for (const flip of [false, true]) {
      const base = target.positions.length / 3
      const order = flip ? [1, 0, 3, 2] : [0, 1, 2, 3]
      const points = [
        [x0, y, z0], [x0, y + height, z0], [x1, y + height, z1], [x1, y, z1]
      ]
      const uvs = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]]
      for (const index of order) {
        const point = points[index]
        target.positions.push(point[0], point[1], point[2])
        target.normals.push(0, 1, 0)
        target.uvs.push(uvs[index][0], uvs[index][1])
        const light = flip ? 0.76 : 0.92
        target.colors.push(light, light, light)
      }
      target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
}

export function buildChunkGeometry(chunk, world) {
  const result = {
    opaque: newTarget(),
    cutout: newTarget(),
    glass: newTarget(),
    water: newTarget()
  }
  if (!chunk.generated) return result
  const cx = chunk.cx
  const cz = chunk.cz
  const baseX = cx * CHUNK_SIZE
  const baseZ = cz * CHUNK_SIZE
  const neighborChunks = new Map()
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const key = dx + ',' + dz
      let c = dx === 0 && dz === 0 ? chunk : world.getChunk(cx + dx, cz + dz)
      if (!c) c = { blocks: new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT) }
      neighborChunks.set(key, c)
    }
  }

  const getBlock = (wx, wy, wz) => {
    if (wy < 0) return BEDROCK
    if (wy >= WORLD_HEIGHT) return AIR
    const lx = wx - baseX
    const lz = wz - baseZ
    const dx = Math.floor(lx / CHUNK_SIZE)
    const dz = Math.floor(lz / CHUNK_SIZE)
    const target = neighborChunks.get(dx + ',' + dz)
    if (!target) return AIR
    const tx = lx - dx * CHUNK_SIZE
    const tz = lz - dz * CHUNK_SIZE
    return target.blocks[localIndex(tx, wy, tz)]
  }

  const occludes = (wx, wy, wz) => occludesAO(getBlock(wx, wy, wz))

  for (let y = 0; y < WORLD_HEIGHT; y++) {
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const id = chunk.blocks[localIndex(x, y, z)]
        if (id === AIR) continue
        const block = BLOCKS[id]
        const wx = baseX + x
        const wz = baseZ + z
        if (block.plant) {
          addPlant(result.cutout, x, y, z, block.tiles[0], (x * 13 + z * 7) % 5)
          continue
        }
        const target = block.transparent
          ? id === WATER ? result.water : result.glass
          : block.cutout ? result.cutout : result.opaque
        const isWaterTop = id === WATER && getBlock(wx, y + 1, wz) !== WATER
        const topLift = isWaterTop ? 0.12 : 0
        for (let f = 0; f < 6; f++) {
          const face = FACES[f]
          const nx = wx + (face.axis === 0 ? face.sign : 0)
          const ny = y + (face.axis === 1 ? face.sign : 0)
          const nz = wz + (face.axis === 2 ? face.sign : 0)
          const neighbor = getBlock(nx, ny, nz)
          if (!faceVisible(id, neighbor)) continue
          if (block.transparent && isTransparent(neighbor) && neighbor !== id) continue
          const brightness = [0, 0, 0, 0]
          for (let i = 0; i < 4; i++) {
            const corner = face.corners[i]
            const ox = corner[0] === 1 ? 1 : -1
            const oy = corner[1] === 1 ? 1 : -1
            const oz = corner[2] === 1 ? 1 : -1
            let s1
            let s2
            let c
            if (face.axis === 0) {
              s1 = occludes(nx, y + oy, wz)
              s2 = occludes(nx, y, wz + oz)
              c = occludes(nx, y + oy, wz + oz)
            } else if (face.axis === 1) {
              s1 = occludes(wx + ox, ny, wz)
              s2 = occludes(wx, ny, wz + oz)
              c = occludes(wx + ox, ny, wz + oz)
            } else {
              s1 = occludes(wx + ox, y, nz)
              s2 = occludes(wx, y + oy, nz)
              c = occludes(wx + ox, y + oy, nz)
            }
            let ao = 3
            if (s1 && s2) ao = 0
            else ao = 3 - ((s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0))
            brightness[i] = AO_LEVELS[ao] * face.shade
          }
          addFace(target, x, y, z, face, block.tiles[f], brightness, topLift)
        }
      }
    }
  }
  return result
}

export function geometryStats(target) {
  return {
    vertices: target.positions.length / 3,
    indices: target.indices.length,
    faces: target.indices.length / 6
  }
}
