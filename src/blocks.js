export const TILE = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  SAND: 4,
  LOG_SIDE: 5,
  LOG_TOP: 6,
  LEAVES: 7,
  PLANKS: 8,
  COBBLE: 9,
  GLASS: 10,
  WATER: 11,
  SNOW: 12,
  SNOW_SIDE: 13,
  GLOWSTONE: 14,
  BRICK: 15,
  OBSIDIAN: 16,
  TALL_GRASS: 17,
  FLOWER: 18,
  BEDROCK: 19,
  COAL_ORE: 20,
  ICE: 21,
  SANDSTONE: 22,
  MOSSY_COBBLE: 23,
  GRAVEL: 24
}

export const ATLAS_COLS = 8
export const ATLAS_ROWS = 8
export const ATLAS_SIZE = 128
export const TILE_SIZE = 16

const all = (tile) => [tile, tile, tile, tile, tile, tile]
const column = (side, top, bottom = top) => [side, side, top, bottom, side, side]

function define(id, name, label, tiles, options = {}) {
  return {
    id,
    name,
    label,
    tiles,
    solid: options.solid ?? true,
    opaque: options.opaque ?? true,
    liquid: options.liquid ?? false,
    plant: options.plant ?? false,
    cutout: options.cutout ?? false,
    transparent: options.transparent ?? false,
    hardness: options.hardness ?? 1,
    color: options.color ?? '#888888',
    mapColor: options.mapColor ?? options.color ?? '#888888'
  }
}

export const BLOCKS = [
  define(0, 'air', 'Air', all(0), { solid: false, opaque: false, color: '#ffffff' }),
  define(1, 'grass', 'Grass', column(TILE.GRASS_SIDE, TILE.GRASS_TOP, TILE.DIRT), {
    color: '#6bb33a', mapColor: '#6bb33a'
  }),
  define(2, 'dirt', 'Dirt', all(TILE.DIRT), { color: '#8a5a34', mapColor: '#8a5a34' }),
  define(3, 'stone', 'Stone', all(TILE.STONE), { color: '#8a8a8a', mapColor: '#8a8a8a' }),
  define(4, 'sand', 'Sand', all(TILE.SAND), { color: '#e3d59a', mapColor: '#e3d59a' }),
  define(5, 'log', 'Log', column(TILE.LOG_SIDE, TILE.LOG_TOP), {
    color: '#6b4a2a', mapColor: '#6b4a2a'
  }),
  define(6, 'leaves', 'Leaves', all(TILE.LEAVES), {
    opaque: false, cutout: true, color: '#4e942c', mapColor: '#4e942c'
  }),
  define(7, 'planks', 'Planks', all(TILE.PLANKS), { color: '#b07a42', mapColor: '#b07a42' }),
  define(8, 'cobble', 'Cobblestone', all(TILE.COBBLE), { color: '#7d7d7d', mapColor: '#7d7d7d' }),
  define(9, 'glass', 'Glass', all(TILE.GLASS), {
    opaque: false, transparent: true, color: '#bfe8ff', mapColor: '#bfe8ff'
  }),
  define(10, 'water', 'Water', all(TILE.WATER), {
    solid: false, opaque: false, liquid: true, transparent: true, color: '#3f86e8', mapColor: '#3f86e8'
  }),
  define(11, 'snow', 'Snow', column(TILE.SNOW_SIDE, TILE.SNOW, TILE.DIRT), {
    color: '#f4f9ff', mapColor: '#f4f9ff'
  }),
  define(12, 'glowstone', 'Glowstone', all(TILE.GLOWSTONE), {
    color: '#f2b134', mapColor: '#f2b134'
  }),
  define(13, 'brick', 'Bricks', all(TILE.BRICK), { color: '#a8402f', mapColor: '#a8402f' }),
  define(14, 'obsidian', 'Obsidian', all(TILE.OBSIDIAN), {
    color: '#2c1f45', mapColor: '#2c1f45'
  }),
  define(15, 'tall_grass', 'Tall Grass', all(TILE.TALL_GRASS), {
    solid: false, opaque: false, plant: true, cutout: true, color: '#5fae38', mapColor: '#5fae38'
  }),
  define(16, 'flower', 'Flower', all(TILE.FLOWER), {
    solid: false, opaque: false, plant: true, cutout: true, color: '#e05555', mapColor: '#e05555'
  }),
  define(17, 'bedrock', 'Bedrock', all(TILE.BEDROCK), { color: '#3a3a3a', mapColor: '#3a3a3a' }),
  define(18, 'coal_ore', 'Coal Ore', all(TILE.COAL_ORE), {
    color: '#666666', mapColor: '#666666'
  }),
  define(19, 'ice', 'Ice', all(TILE.ICE), {
    opaque: false, transparent: true, color: '#a8d8f0', mapColor: '#a8d8f0'
  }),
  define(20, 'sandstone', 'Sandstone', all(TILE.SANDSTONE), {
    color: '#d8c48a', mapColor: '#d8c48a'
  }),
  define(21, 'mossy_cobble', 'Mossy Cobblestone', all(TILE.MOSSY_COBBLE), {
    color: '#6c8455', mapColor: '#6c8455'
  }),
  define(22, 'gravel', 'Gravel', all(TILE.GRAVEL), { color: '#8d8378', mapColor: '#8d8378' })
]

export const AIR = 0
export const GRASS = 1
export const DIRT = 2
export const STONE = 3
export const SAND = 4
export const LOG = 5
export const LEAVES = 6
export const PLANKS = 7
export const COBBLE = 8
export const GLASS = 9
export const WATER = 10
export const SNOW = 11
export const GLOWSTONE = 12
export const BRICK = 13
export const OBSIDIAN = 14
export const TALL_GRASS = 15
export const FLOWER = 16
export const BEDROCK = 17
export const COAL_ORE = 18
export const ICE = 19
export const SANDSTONE = 20
export const MOSSY_COBBLE = 21
export const GRAVEL = 22

export const HOTBAR = [
  GRASS,
  STONE,
  COBBLE,
  PLANKS,
  LOG,
  SAND,
  GLASS,
  GLOWSTONE,
  LEAVES
]

export function isSolid(id) {
  return BLOCKS[id]?.solid ?? false
}

export function isOpaque(id) {
  return BLOCKS[id]?.opaque ?? false
}

export function isLiquid(id) {
  return BLOCKS[id]?.liquid ?? false
}

export function isPlant(id) {
  return BLOCKS[id]?.plant ?? false
}

export function isCutout(id) {
  return BLOCKS[id]?.cutout ?? false
}

export function isTransparent(id) {
  return BLOCKS[id]?.transparent ?? false
}

export function blockName(id) {
  return BLOCKS[id]?.label ?? 'Air'
}

export function faceVisible(block, neighbor) {
  if (neighbor === AIR) return true
  if (block === neighbor) return false
  const other = BLOCKS[neighbor]
  if (!other) return true
  if (other.plant) return true
  if (!other.opaque) return true
  return false
}

export function occludesAO(id) {
  return BLOCKS[id]?.opaque ?? false
}
