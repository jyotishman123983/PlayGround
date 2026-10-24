import { AIR, isLiquid, isPlant, isSolid } from './blocks.js'

export function defaultHitTest(id) {
  if (id === AIR) return false
  if (isLiquid(id)) return false
  return isSolid(id) || isPlant(id)
}

export function raycast(world, origin, direction, maxDistance = 6, hitTest = defaultHitTest) {
  let x = Math.floor(origin.x)
  let y = Math.floor(origin.y)
  let z = Math.floor(origin.z)
  const dx = direction.x
  const dy = direction.y
  const dz = direction.z
  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx)
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy)
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz)
  let tMaxX = stepX === 0 ? Infinity : stepX > 0 ? (x + 1 - origin.x) * tDeltaX : (origin.x - x) * tDeltaX
  let tMaxY = stepY === 0 ? Infinity : stepY > 0 ? (y + 1 - origin.y) * tDeltaY : (origin.y - y) * tDeltaY
  let tMaxZ = stepZ === 0 ? Infinity : stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : (origin.z - z) * tDeltaZ
  let normal = [0, 1, 0]
  let distance = 0

  for (let i = 0; i < 256; i++) {
    const id = world.getBlock(x, y, z)
    if (hitTest(id)) {
      return {
        x, y, z,
        block: id,
        normal,
        distance,
        place: { x: x + normal[0], y: y + normal[1], z: z + normal[2] }
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX
      distance = tMaxX
      tMaxX += tDeltaX
      normal = [-stepX, 0, 0]
    } else if (tMaxY < tMaxZ) {
      y += stepY
      distance = tMaxY
      tMaxY += tDeltaY
      normal = [0, -stepY, 0]
    } else {
      z += stepZ
      distance = tMaxZ
      tMaxZ += tDeltaZ
      normal = [0, 0, -stepZ]
    }
    if (distance > maxDistance) break
  }
  return null
}
