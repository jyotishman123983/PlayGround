import type { AspectRatio, Quality, StyleId } from '../types'

export interface AspectOption {
  id: AspectRatio
  label: string
  hint: string
  w: number
  h: number
}

export const ASPECTS: AspectOption[] = [
  { id: '9:16', label: 'Portrait', hint: 'Reels · Shorts · TikTok', w: 9, h: 16 },
  { id: '16:9', label: 'Landscape', hint: 'YouTube · Web', w: 16, h: 9 },
  { id: '1:1', label: 'Square', hint: 'Feed posts', w: 1, h: 1 }
]

export interface StyleOption {
  id: StyleId
  label: string
  blurb: string
  emoji: string
  colors: [string, string, string]
}

export const STYLES: StyleOption[] = [
  { id: 'realistic', label: 'Realistic', blurb: 'Natural light, true-to-life detail', emoji: '📷', colors: ['#f59e0b', '#0ea5e9', '#111827'] },
  { id: 'cinematic', label: 'Cinematic', blurb: 'Anamorphic glow, deep contrast', emoji: '🎬', colors: ['#0ea5e9', '#f97316', '#020617'] },
  { id: 'cartoon', label: '3D Cartoon', blurb: 'Glossy 3D shapes, vibrant colour', emoji: '🧊', colors: ['#a855f7', '#22d3ee', '#f472b6'] },
  { id: 'anime', label: 'Anime', blurb: 'Cel shading, speed lines, sparkle', emoji: '🌸', colors: ['#60a5fa', '#f472b6', '#fde68a'] },
  { id: 'fantasy', label: 'Fantasy', blurb: 'Ethereal fog, magical dust', emoji: '🐉', colors: ['#34d399', '#8b5cf6', '#facc15'] }
]

export interface QualityOption {
  id: Quality
  label: string
  hint: string
}

export const QUALITIES: QualityOption[] = [
  { id: 'draft', label: 'Draft', hint: 'Faster render, lighter file' },
  { id: 'standard', label: 'Standard', hint: 'Balanced 720p-style output' },
  { id: 'high', label: 'High', hint: 'Sharper 1080p-style output' }
]

export const DURATIONS = [4, 6, 8]

export const SAMPLE_PROMPTS = [
  'A neon-lit Mumbai street after rain, cinematic slow motion',
  'सूरज डूबते समय पहाड़ों पर बनता सुनहरा नज़ारा',
  'Talking golden retriever wearing sunglasses, 3D cartoon',
  'Anime girl running through cherry blossom storm, heroic angle',
  'Floating islands with waterfalls at sunrise, fantasy epic'
]

export function aspectMeta(id: AspectRatio): AspectOption {
  return ASPECTS.find((a) => a.id === id) ?? ASPECTS[0]
}

export function styleMeta(id: StyleId): StyleOption {
  return STYLES.find((s) => s.id === id) ?? STYLES[0]
}

export function qualityMeta(id: Quality): QualityOption {
  return QUALITIES.find((q) => q.id === id) ?? QUALITIES[1]
}

const SIZES: Record<AspectRatio, Record<Quality, [number, number]>> = {
  '9:16': { draft: [480, 854], standard: [720, 1280], high: [1080, 1920] },
  '16:9': { draft: [854, 480], standard: [1280, 720], high: [1920, 1080] },
  '1:1': { draft: [640, 640], standard: [960, 960], high: [1440, 1440] }
}

export function baseSize(aspect: AspectRatio, quality: Quality): { width: number; height: number } {
  const [width, height] = SIZES[aspect]?.[quality] ?? SIZES['9:16'].standard
  return { width, height }
}
