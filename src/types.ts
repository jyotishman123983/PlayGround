export type AspectRatio = '9:16' | '16:9' | '1:1'
export type StyleId = 'realistic' | 'cinematic' | 'cartoon' | 'anime' | 'fantasy'
export type Quality = 'draft' | 'standard' | 'high'
export type GenerationMode = 'text' | 'image'
export type EngineMode = 'demo' | 'api'

export interface AppSettings {
  mode: EngineMode
  apiBaseUrl: string
  quality: Quality
  defaultAspect: AspectRatio
  defaultStyle: StyleId
  defaultDuration: number
  autoOpenPreview: boolean
}

export interface GenerationConfig {
  mode: GenerationMode
  prompt: string
  aspect: AspectRatio
  style: StyleId
  duration: number
  quality: Quality
  imageFile?: File | null
}

export interface VideoRecord {
  id: string
  title: string
  prompt: string
  inputMode: GenerationMode
  aspect: AspectRatio
  style: StyleId
  duration: number
  quality: Quality
  engine: 'demo' | 'api'
  engineLabel: string
  model?: string
  isAiGenerated: boolean
  mime: string
  width: number
  height: number
  sizeBytes: number
  createdAt: number
  thumbnail?: string
  blobKey?: string
  remoteUrl?: string
}

export type BackendState = 'unconfigured' | 'checking' | 'online' | 'offline'

export interface BackendStatus {
  state: BackendState
  message: string
  engine?: string
  model?: string
  demo?: boolean
  checkedAt?: number
}

export interface DemoRenderResult {
  blob: Blob
  mime: string
  width: number
  height: number
  duration: number
  thumbnail: string
}

export type DemoProgress = {
  progress: number
  renderedSeconds: number
  duration: number
}
