export function hashString(value) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function mulberry32(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10)
const lerp = (a, b, t) => a + (b - a) * t

function grad2(hash, x, y) {
  switch (hash & 7) {
    case 0: return x + y
    case 1: return -x + y
    case 2: return x - y
    case 3: return -x - y
    case 4: return x
    case 5: return -x
    case 6: return y
    default: return -y
  }
}

function grad3(hash, x, y, z) {
  switch (hash & 15) {
    case 0: return x + y
    case 1: return -x + y
    case 2: return x - y
    case 3: return -x - y
    case 4: return x + z
    case 5: return -x + z
    case 6: return x - z
    case 7: return -x - z
    case 8: return y + z
    case 9: return -y + z
    case 10: return y - z
    case 11: return -y - z
    case 12: return x + y
    case 13: return -x + y
    case 14: return -y + z
    default: return -y - z
  }
}

export class Noise {
  constructor(seed = 1337) {
    const random = mulberry32(seed)
    const source = new Uint8Array(256)
    for (let i = 0; i < 256; i++) source[i] = i
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      const tmp = source[i]
      source[i] = source[j]
      source[j] = tmp
    }
    this.perm = new Uint8Array(512)
    this.perm12 = new Uint8Array(512)
    for (let i = 0; i < 512; i++) {
      this.perm[i] = source[i & 255]
      this.perm12[i] = this.perm[i] % 12
    }
  }

  noise2(x, y) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const xf = x - xi
    const yf = y - yi
    const X = xi & 255
    const Y = yi & 255
    const u = fade(xf)
    const v = fade(yf)
    const p = this.perm
    const aa = p[p[X] + Y]
    const ab = p[p[X] + Y + 1]
    const ba = p[p[X + 1] + Y]
    const bb = p[p[X + 1] + Y + 1]
    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u)
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u)
    return lerp(x1, x2, v)
  }

  noise3(x, y, z) {
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const zi = Math.floor(z)
    const xf = x - xi
    const yf = y - yi
    const zf = z - zi
    const X = xi & 255
    const Y = yi & 255
    const Z = zi & 255
    const u = fade(xf)
    const v = fade(yf)
    const w = fade(zf)
    const p = this.perm
    const A = p[X] + Y
    const AA = p[A] + Z
    const AB = p[A + 1] + Z
    const B = p[X + 1] + Y
    const BA = p[B] + Z
    const BB = p[B + 1] + Z
    const x1 = lerp(grad3(p[AA], xf, yf, zf), grad3(p[BA], xf - 1, yf, zf), u)
    const x2 = lerp(grad3(p[AB], xf, yf - 1, zf), grad3(p[BB], xf - 1, yf - 1, zf), u)
    const y1 = lerp(x1, x2, v)
    const x3 = lerp(grad3(p[AA + 1], xf, yf, zf - 1), grad3(p[BA + 1], xf - 1, yf, zf - 1), u)
    const x4 = lerp(grad3(p[AB + 1], xf, yf - 1, zf - 1), grad3(p[BB + 1], xf - 1, yf - 1, zf - 1), u)
    const y2 = lerp(x3, x4, v)
    return lerp(y1, y2, w)
  }

  fbm2(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
    let amplitude = 1
    let frequency = 1
    let sum = 0
    let norm = 0
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x * frequency, y * frequency) * amplitude
      norm += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }
    return sum / norm
  }

  fbm3(x, y, z, octaves = 3, lacunarity = 2, gain = 0.5) {
    let amplitude = 1
    let frequency = 1
    let sum = 0
    let norm = 0
    for (let i = 0; i < octaves; i++) {
      sum += this.noise3(x * frequency, y * frequency, z * frequency) * amplitude
      norm += amplitude
      amplitude *= gain
      frequency *= lacunarity
    }
    return sum / norm
  }
}
