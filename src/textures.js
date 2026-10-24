import { ATLAS_COLS, ATLAS_ROWS, ATLAS_SIZE, TILE_SIZE, TILE, BLOCKS } from './blocks.js'
import { mulberry32 } from './noise.js'

const hexToRgb = (hex) => {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

function makeTilePainter(ctx, tile) {
  const tx = (tile % ATLAS_COLS) * TILE_SIZE
  const ty = Math.floor(tile / ATLAS_COLS) * TILE_SIZE
  return {
    rect(x, y, w, h, color) {
      ctx.fillStyle = color
      ctx.fillRect(tx + x, ty + y, w, h)
    },
    px(x, y, color) {
      ctx.fillStyle = color
      ctx.fillRect(tx + x, ty + y, 1, 1)
    },
    clear() {
      ctx.clearRect(tx, ty, TILE_SIZE, TILE_SIZE)
    },
    erase(x, y, w, h) {
      ctx.clearRect(tx + x, ty + y, w, h)
    },
    line(x0, y0, x1, y1, color) {
      const dx = Math.abs(x1 - x0)
      const dy = Math.abs(y1 - y0)
      const sx = x0 < x1 ? 1 : -1
      const sy = y0 < y1 ? 1 : -1
      let err = dx - dy
      ctx.fillStyle = color
      for (;;) {
        ctx.fillRect(tx + x0, ty + y0, 1, 1)
        if (x0 === x1 && y0 === y1) break
        const e2 = 2 * err
        if (e2 > -dy) { err -= dy; x0 += sx }
        if (e2 < dx) { err += dx; y0 += sy }
      }
    }
  }
}

function noiseFill(p, random, base, palette, density = 0.65, min = 0, max = 16) {
  p.rect(0, 0, TILE_SIZE, TILE_SIZE, base)
  for (let y = min; y < max; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (random() < density) p.px(x, y, palette[Math.floor(random() * palette.length)])
    }
  }
}

function grassTop(p, random) {
  p.rect(0, 0, 16, 16, '#5da62f')
  for (let i = 0; i < 46; i++) {
    const x = Math.floor(random() * 15)
    const y = Math.floor(random() * 15)
    const size = random() < 0.6 ? 2 : 1
    p.rect(x, y, size, size, ['#559c2b', '#68b236', '#6fc13e', '#4f9326'][Math.floor(random() * 4)])
  }
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(random() * 16)
    const y = Math.floor(random() * 16)
    p.px(x, y, random() < 0.5 ? '#478a22' : '#7bc84a')
  }
}

function grassSide(p, random) {
  noiseFill(p, random, '#8a5a34', ['#7a4d2b', '#95643b', '#6f4526', '#9c6b41'], 0.9)
  const depths = []
  for (let x = 0; x < 16; x++) depths.push(2 + Math.floor(random() * 3))
  for (let x = 0; x < 16; x++) {
    const depth = depths[x]
    for (let y = 0; y < depth; y++) {
      const shade = y === depth - 1 ? '#4f9326' : random() < 0.5 ? '#5da62f' : '#6cb93a'
      p.px(x, y, shade)
    }
  }
}

function dirt(p, random) {
  p.rect(0, 0, 16, 16, '#8a5a34')
  for (let i = 0; i < 42; i++) {
    const x = Math.floor(random() * 15)
    const y = Math.floor(random() * 15)
    const size = random() < 0.55 ? 2 : 1
    p.rect(x, y, size, size, ['#7f512e', '#95643b', '#6f4526', '#9c6b41'][Math.floor(random() * 4)])
  }
  for (let i = 0; i < 9; i++) p.px(Math.floor(random() * 16), Math.floor(random() * 16), '#5f3a1f')
}

function stone(p, random) {
  noiseFill(p, random, '#8b8b8b', ['#7d7d7d', '#969696', '#868686', '#a0a0a0'], 0.85)
  for (let i = 0; i < 3; i++) {
    const x = Math.floor(random() * 12)
    const y = Math.floor(random() * 13)
    p.line(x, y, x + 2 + Math.floor(random() * 3), y + 1 + Math.floor(random() * 2), '#6f6f6f')
  }
}

function sand(p, random) {
  p.rect(0, 0, 16, 16, '#e3d59a')
  for (let i = 0; i < 38; i++) {
    const x = Math.floor(random() * 15)
    const y = Math.floor(random() * 15)
    const size = random() < 0.5 ? 2 : 1
    p.rect(x, y, size, size, ['#ddcf94', '#eadca4', '#d7c98c', '#efe2ac'][Math.floor(random() * 4)])
  }
  for (let i = 0; i < 6; i++) p.px(Math.floor(random() * 16), Math.floor(random() * 16), '#c9ba7f')
}

function logSide(p, random) {
  p.rect(0, 0, 16, 16, '#6b4a2a')
  for (let x = 0; x < 16; x++) {
    const shade = ['#5c3f22', '#765230', '#634427', '#7d5833'][x % 4]
    if (x % 3 === 0) p.rect(x, 0, 1, 16, shade)
    else if (random() < 0.35) {
      const y = Math.floor(random() * 16)
      p.px(x, y, shade)
    }
  }
  for (let i = 0; i < 3; i++) {
    const x = 2 + Math.floor(random() * 12)
    const y = 2 + Math.floor(random() * 12)
    p.rect(x, y, 2, 3, '#4b3018')
    p.px(x, y, '#8d6740')
  }
}

function logTop(p, random) {
  p.rect(0, 0, 16, 16, '#9a7446')
  const rings = ['#b08a55', '#84603a', '#a37d4c']
  for (let r = 0; r < 8; r++) {
    const inset = r
    if (inset > 7) break
    const color = rings[r % rings.length]
    for (let x = inset; x < 16 - inset; x++) {
      if (random() < 0.8) { p.px(x, inset, color); p.px(x, 15 - inset, color) }
    }
    for (let y = inset; y < 16 - inset; y++) {
      if (random() < 0.8) { p.px(inset, y, color); p.px(15 - inset, y, color) }
    }
  }
  p.px(7, 7, '#5c3f22')
  p.px(8, 8, '#5c3f22')
}

function leaves(p, random) {
  p.rect(0, 0, 16, 16, '#4c8f2a')
  for (let i = 0; i < 44; i++) {
    const x = Math.floor(random() * 14)
    const y = Math.floor(random() * 14)
    const size = random() < 0.55 ? 3 : 2
    p.rect(x, y, size, size, ['#4a8a28', '#559a31', '#61a93a', '#447f24', '#6cb644'][Math.floor(random() * 5)])
  }
  for (let i = 0; i < 12; i++) {
    const edge = Math.floor(random() * 4)
    const x = edge === 0 ? 0 : edge === 1 ? 15 : Math.floor(random() * 15)
    const y = edge === 2 ? 0 : edge === 3 ? 15 : Math.floor(random() * 15)
    p.erase(x, y, random() < 0.4 ? 2 : 1, random() < 0.4 ? 2 : 1)
  }
  for (let i = 0; i < 10; i++) p.px(Math.floor(random() * 16), Math.floor(random() * 16), '#356a1d')
}

function planks(p, random) {
  p.rect(0, 0, 16, 16, '#b07a42')
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (random() < 0.35) p.px(x, y, ['#a26e39', '#b98449', '#9c6835'][Math.floor(random() * 3)])
    }
  }
  for (let y = 3; y < 16; y += 4) p.rect(0, y, 16, 1, '#8a5a2f')
  p.rect(0, 0, 1, 16, '#8a5a2f')
  p.rect(15, 0, 1, 16, '#c08a52')
  p.rect(5, 1, 1, 2, '#8a5a2f')
  p.rect(11, 9, 1, 2, '#8a5a2f')
  p.rect(7, 5, 2, 1, '#8a5a2f')
}

function cobble(p, random, mossy = false) {
  p.rect(0, 0, 16, 16, '#5f5f5f')
  const stones = [
    [1, 1, 6, 5], [8, 1, 7, 4], [1, 7, 5, 4], [7, 6, 5, 5], [13, 6, 2, 6],
    [1, 12, 7, 3], [9, 12, 6, 3], [6, 6, 2, 2]
  ]
  for (const [x, y, w, h] of stones) {
    const tone = ['#7d7d7d', '#8e8e8e', '#747474', '#989898'][Math.floor(random() * 4)]
    p.rect(x, y, w, h, tone)
    p.rect(x, y, w, 1, '#a2a2a2')
    p.rect(x, y + h - 1, w, 1, '#686868')
    if (mossy && random() < 0.7) {
      const mx = x + Math.floor(random() * Math.max(1, w - 2))
      const my = y + Math.floor(random() * Math.max(1, h - 2))
      p.rect(mx, my, 2, 1, '#5f8a3a')
      p.px(mx, my + 1, '#4a7029')
    }
  }
  for (let i = 0; i < 10; i++) p.px(Math.floor(random() * 16), Math.floor(random() * 16), 'rgba(0,0,0,0.18)')
}

function glass(p) {
  p.clear()
  p.rect(0, 0, 16, 16, 'rgba(198,232,255,0.16)')
  for (let i = 0; i < 16; i++) {
    p.px(i, 0, 'rgba(220,244,255,0.85)')
    p.px(i, 15, 'rgba(150,196,224,0.65)')
    p.px(0, i, 'rgba(220,244,255,0.75)')
    p.px(15, i, 'rgba(150,196,224,0.55)')
  }
  p.line(2, 11, 10, 3, 'rgba(255,255,255,0.55)')
  p.line(3, 12, 11, 4, 'rgba(255,255,255,0.22)')
  p.line(9, 12, 12, 9, 'rgba(255,255,255,0.4)')
}

function water(p, random) {
  p.rect(0, 0, 16, 16, '#3478d8')
  for (let i = 0; i < 20; i++) {
    const x = Math.floor(random() * 15)
    const y = Math.floor(random() * 16)
    const length = 2 + Math.floor(random() * 4)
    p.rect(x, y, Math.min(length, 16 - x), 1, random() < 0.5 ? '#367edc' : '#3273d0')
  }
  for (let i = 0; i < 5; i++) {
    const x = Math.floor(random() * 14)
    const y = Math.floor(random() * 16)
    p.rect(x, y, 2, 1, 'rgba(126,184,238,0.25)')
  }
}

function snow(p, random) {
  noiseFill(p, random, '#f4f9ff', ['#e8f1fc', '#ffffff', '#dfeaf8', '#f9fcff'], 0.8)
  for (let i = 0; i < 5; i++) p.px(Math.floor(random() * 16), Math.floor(random() * 16), '#d3e2f4')
}

function snowSide(p, random) {
  noiseFill(p, random, '#8a5a34', ['#7a4d2b', '#95643b', '#6f4526'], 0.8)
  const depths = []
  for (let x = 0; x < 16; x++) depths.push(3 + Math.floor(random() * 3))
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < depths[x]; y++) {
      p.px(x, y, y === depths[x] - 1 ? '#d5e6f8' : random() < 0.5 ? '#f4f9ff' : '#e8f1fc')
    }
  }
}

function glowstone(p, random) {
  noiseFill(p, random, '#d99a2b', ['#f2b134', '#ffd76a', '#c98a1c', '#ffe298'], 1)
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(random() * 15)
    const y = Math.floor(random() * 15)
    p.rect(x, y, 2, 2, '#ffe9a8')
    p.px(x, y, '#fff7d6')
  }
  for (let i = 0; i < 8; i++) p.px(Math.floor(random() * 16), Math.floor(random() * 16), '#a86c12')
}

function brick(p, random) {
  p.rect(0, 0, 16, 16, '#d9c9b8')
  for (let row = 0; row < 4; row++) {
    const y = row * 4
    const offset = row % 2 === 0 ? 0 : 4
    for (let x = -8; x < 16; x += 8) {
      const bx = x + offset
      p.rect(bx, y, 7, 3, ['#a8402f', '#b24a37', '#9c3a2a'][Math.floor(random() * 3)])
      p.px(bx + 1, y + 1, 'rgba(255,255,255,0.16)')
      p.px(bx + 5, y + 2, 'rgba(0,0,0,0.16)')
    }
  }
  for (let i = 0; i < 18; i++) p.px(Math.floor(random() * 16), Math.floor(random() * 16), 'rgba(0,0,0,0.08)')
}

function obsidian(p, random) {
  noiseFill(p, random, '#241a38', ['#2c1f45', '#1a1229', '#3a2a55', '#201632'], 0.9)
  for (let i = 0; i < 4; i++) {
    const x = Math.floor(random() * 12)
    const y = Math.floor(random() * 12)
    p.rect(x, y, 2, 1, '#6b4fa0')
    p.px(x + 1, y + 1, '#8b6fc0')
  }
}

function tallGrass(p, random) {
  p.clear()
  for (let i = 0; i < 16; i++) {
    if (random() < 0.3) continue
    const x = Math.floor(random() * 16)
    const h = 4 + Math.floor(random() * 11)
    const lean = random() < 0.5 ? 0 : random() < 0.5 ? -1 : 1
    for (let j = 0; j < h; j++) {
      const shade = j > h - 3 ? '#7bc84a' : j > 2 ? '#5fae38' : '#4a8a24'
      p.px(Math.max(0, Math.min(15, x + Math.round((lean * j) / h))), 15 - j, shade)
    }
  }
}

function flower(p, random) {
  p.clear()
  const cx = 7 + Math.floor(random() * 3)
  for (let y = 6; y < 16; y++) p.px(cx, y, y % 3 === 0 ? '#4a8a24' : '#5fae38')
  p.px(cx - 1, 12, '#5fae38')
  p.px(cx + 1, 13, '#5fae38')
  const petal = ['#e05555', '#f0c93c', '#f07ab0', '#f5f5f5'][Math.floor(random() * 4)]
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    p.px(cx + dx, 5 + dy, petal)
  }
  p.px(cx, 5, '#ffe9a8')
  p.px(cx, 6, '#ffd76a')
}

function bedrock(p, random) {
  noiseFill(p, random, '#3a3a3a', ['#2a2a2a', '#4a4a4a', '#242424', '#555555'], 1)
  for (let i = 0; i < 5; i++) p.rect(Math.floor(random() * 13), Math.floor(random() * 13), 2 + Math.floor(random() * 3), 2, '#1b1b1b')
}

function coalOre(p, random) {
  noiseFill(p, random, '#8b8b8b', ['#7d7d7d', '#969696', '#868686'], 0.8)
  for (let i = 0; i < 6; i++) {
    const x = 1 + Math.floor(random() * 12)
    const y = 1 + Math.floor(random() * 12)
    p.rect(x, y, 2, 2, '#2b2b2b')
    p.px(x + 1, y, '#151515')
    p.px(x, y + 1, '#3c3c3c')
  }
}

function ice(p, random) {
  p.rect(0, 0, 16, 16, '#a8d8f0')
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (random() < 0.4) p.px(x, y, ['#bce4f8', '#9ccce8', '#cdeeff'][Math.floor(random() * 3)])
    }
  }
  p.line(2, 13, 8, 7, 'rgba(255,255,255,0.7)')
  p.line(8, 7, 13, 4, 'rgba(255,255,255,0.45)')
  p.line(4, 2, 11, 9, 'rgba(255,255,255,0.25)')
}

function sandstone(p, random) {
  noiseFill(p, random, '#d8c48a', ['#ceb87a', '#e3d29a', '#c6ae6b'], 0.6)
  p.rect(0, 4, 16, 1, '#bda461')
  p.rect(0, 11, 16, 1, '#c9b171')
  for (let i = 0; i < 5; i++) p.px(Math.floor(random() * 16), Math.floor(random() * 16), '#b59a5c')
}

function gravel(p, random) {
  p.rect(0, 0, 16, 16, '#7a7168')
  for (let i = 0; i < 26; i++) {
    const x = Math.floor(random() * 15)
    const y = Math.floor(random() * 15)
    const size = random() < 0.5 ? 2 : 1
    p.rect(x, y, size, size, ['#8d8378', '#6b625a', '#9b9186', '#5d554e'][Math.floor(random() * 4)])
  }
}

const painters = {
  [TILE.GRASS_TOP]: grassTop,
  [TILE.GRASS_SIDE]: grassSide,
  [TILE.DIRT]: dirt,
  [TILE.STONE]: stone,
  [TILE.SAND]: sand,
  [TILE.LOG_SIDE]: logSide,
  [TILE.LOG_TOP]: logTop,
  [TILE.LEAVES]: leaves,
  [TILE.PLANKS]: planks,
  [TILE.COBBLE]: (p, r) => cobble(p, r, false),
  [TILE.GLASS]: glass,
  [TILE.WATER]: water,
  [TILE.SNOW]: snow,
  [TILE.SNOW_SIDE]: snowSide,
  [TILE.GLOWSTONE]: glowstone,
  [TILE.BRICK]: brick,
  [TILE.OBSIDIAN]: obsidian,
  [TILE.TALL_GRASS]: tallGrass,
  [TILE.FLOWER]: flower,
  [TILE.BEDROCK]: bedrock,
  [TILE.COAL_ORE]: coalOre,
  [TILE.ICE]: ice,
  [TILE.SANDSTONE]: sandstone,
  [TILE.MOSSY_COBBLE]: (p, r) => cobble(p, r, true),
  [TILE.GRAVEL]: gravel
}

export function buildAtlas() {
  const canvas = document.createElement('canvas')
  canvas.width = ATLAS_SIZE
  canvas.height = ATLAS_SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE)

  const count = ATLAS_COLS * ATLAS_ROWS
  for (let tile = 0; tile < count; tile++) {
    const painter = painters[tile]
    if (!painter) continue
    const random = mulberry32(0x9e3779b9 + tile * 7919)
    painter(makeTilePainter(ctx, tile), random)
  }

  const tileColors = []
  const image = ctx.getImageData(0, 0, ATLAS_SIZE, ATLAS_SIZE).data
  for (let tile = 0; tile < count; tile++) {
    const tx = (tile % ATLAS_COLS) * TILE_SIZE
    const ty = Math.floor(tile / ATLAS_COLS) * TILE_SIZE
    let r = 0
    let g = 0
    let b = 0
    let weight = 0
    for (let y = 0; y < TILE_SIZE; y++) {
      for (let x = 0; x < TILE_SIZE; x++) {
        const i = ((ty + y) * ATLAS_SIZE + tx + x) * 4
        const alpha = image[i + 3] / 255
        if (alpha < 0.35) continue
        r += image[i] * alpha
        g += image[i + 1] * alpha
        b += image[i + 2] * alpha
        weight += alpha
      }
    }
    if (weight === 0) tileColors[tile] = [180, 180, 180]
    else tileColors[tile] = [r / weight, g / weight, b / weight]
  }
  return { canvas, tileColors }
}

export function tileUV(tile) {
  const col = tile % ATLAS_COLS
  const row = Math.floor(tile / ATLAS_COLS)
  const inset = 0.5 / ATLAS_SIZE
  const u0 = (col * TILE_SIZE) / ATLAS_SIZE + inset
  const u1 = ((col + 1) * TILE_SIZE) / ATLAS_SIZE - inset
  const v1 = 1 - (row * TILE_SIZE) / ATLAS_SIZE - inset
  const v0 = 1 - ((row + 1) * TILE_SIZE) / ATLAS_SIZE + inset
  return [u0, v0, u1, v1]
}

export function drawBlockIcon(canvas, blockId, atlasData) {
  const ctx = canvas.getContext('2d')
  const size = canvas.width
  ctx.clearRect(0, 0, size, size)
  ctx.imageSmoothingEnabled = false
  const block = BLOCKS[blockId]
  if (!block || !atlasData) return
  const atlasCanvas = atlasData.canvas
  const tileColors = atlasData.tileColors
  const scale = size / 32
  const faces = [
    { tile: block.tiles[2], origin: [16, 2], u: [12, 7], v: [-12, 7], shade: 'rgba(255,255,255,0.1)', base: tileColors[block.tiles[2]] },
    { tile: block.tiles[0], origin: [4, 9], u: [12, 7], v: [0, 13], shade: 'rgba(0,0,0,0.24)', base: tileColors[block.tiles[0]] },
    { tile: block.tiles[4], origin: [16, 16], u: [12, -7], v: [0, 13], shade: 'rgba(0,0,0,0.04)', base: tileColors[block.tiles[4]] }
  ]

  const p = (x, y) => [x * scale, y * scale]
  for (const face of faces) {
    const origin = p(face.origin[0], face.origin[1])
    const u = [face.u[0] * scale, face.u[1] * scale]
    const v = [face.v[0] * scale, face.v[1] * scale]
    const corners = [
      origin,
      [origin[0] + u[0], origin[1] + u[1]],
      [origin[0] + u[0] + v[0], origin[1] + u[1] + v[1]],
      [origin[0] + v[0], origin[1] + v[1]]
    ]
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(corners[0][0], corners[0][1])
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i][0], corners[i][1])
    ctx.closePath()
    ctx.clip()
    if (face.base) {
      ctx.fillStyle = `rgb(${face.base.map((value) => Math.round(value)).join(',')})`
      ctx.fill()
    }
    const col = face.tile % ATLAS_COLS
    const row = Math.floor(face.tile / ATLAS_COLS)
    ctx.setTransform(u[0] / TILE_SIZE, u[1] / TILE_SIZE, v[0] / TILE_SIZE, v[1] / TILE_SIZE, origin[0], origin[1])
    ctx.drawImage(atlasCanvas, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.fillStyle = face.shade
    ctx.fill()
    ctx.restore()
  }

  ctx.strokeStyle = 'rgba(0,0,0,0.32)'
  ctx.lineWidth = Math.max(1, scale * 0.8)
  const points = [
    [16, 2], [28, 9], [28, 22], [16, 29], [4, 22], [4, 9]
  ].map(([x, y]) => p(x, y))
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
  ctx.moveTo(points[0][0], points[0][1])
  ctx.lineTo(points[3][0], points[3][1])
  ctx.moveTo(points[5][0], points[5][1])
  ctx.lineTo(points[0][0], points[0][1])
  ctx.lineTo(points[1][0], points[1][1])
  ctx.stroke()
  ctx.strokeStyle = 'rgba(255,255,255,0.12)'
  ctx.stroke()
}

export function blockIconCanvas(blockId, atlasData, size = 64) {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  drawBlockIcon(canvas, blockId, atlasData)
  return canvas
}

export function averageBlockColor(blockId, tileColors) {
  const block = BLOCKS[blockId]
  if (!block) return [160, 160, 160]
  return tileColors[block.tiles[0]] || [160, 160, 160]
}
