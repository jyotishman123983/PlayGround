import type { BackendStatus, GenerationConfig } from '../types'

/**
 * Frontend contract for the optional ViralYantra FastAPI backend.
 *
 * The UI deliberately keeps the demo engine and the real engine separate:
 *  - Demo mode runs fully in the browser and is always labelled as a local,
 *    procedural render (never "AI generated").
 *  - API mode only becomes usable after /api/health confirms a real engine is
 *    loaded. Progress values are only rendered when the backend actually
 *    reports them. The frontend never invents progress or results.
 *
 * Endpoints (see backend/README.md for a working reference server):
 *   GET  {base}/api/health
 *        -> { status: "ok", engine: string, model?: string, demo: boolean, capabilities?: { image_to_video: boolean, aspect_ratios: string[], max_duration: number } }
 *   POST {base}/api/generations
 *        body: { prompt, negative_prompt?, input_mode: "text"|"image", image?: dataURL,
 *                aspect_ratio: "9:16"|"16:9"|"1:1", duration: number, style: string, quality: string }
 *        -> 202 { id: string, status: "queued" }
 *   GET  {base}/api/generations/{id}
 *        -> { id, status: "queued"|"running"|"completed"|"failed",
 *             progress?: number (0..1, real only), message?, video_url?, thumbnail_url?, engine?, model?, is_demo: boolean }
 *   GET  {base}/api/generations/{id}/video  (optional direct stream)
 */

export function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, '')
}

export function isValidBaseUrl(input: string): boolean {
  if (!input.trim()) return false
  try {
    const url = new URL(input.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const externalSignal = init.signal
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort()
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function checkBackend(baseUrl: string, signal?: AbortSignal): Promise<BackendStatus> {
  const base = normalizeBaseUrl(baseUrl)
  if (!isValidBaseUrl(base)) {
    return { state: 'unconfigured', message: 'Add a backend URL in Settings to connect a real engine.' }
  }
  try {
    const res = await fetchWithTimeout(`${base}/api/health`, { method: 'GET', headers: { Accept: 'application/json' }, signal }, 8000)
    if (!res.ok) {
      return { state: 'offline', message: `Backend responded with HTTP ${res.status}.`, checkedAt: Date.now() }
    }
    const data = (await res.json()) as {
      status?: string
      engine?: string
      model?: string
      demo?: boolean
      message?: string
    }
    if (data.status && data.status !== 'ok') {
      return { state: 'offline', message: data.message || `Backend reports status "${data.status}".`, checkedAt: Date.now() }
    }
    if (!data.engine) {
      return { state: 'offline', message: 'Backend is reachable but has no video engine loaded.', checkedAt: Date.now() }
    }
    return {
      state: 'online',
      engine: data.engine,
      model: data.model,
      demo: Boolean(data.demo),
      message: data.demo
        ? `Connected to ${data.engine}. This engine reports itself as a demo/sample provider.`
        : `Connected to ${data.engine}${data.model ? ` (${data.model})` : ''}.`,
      checkedAt: Date.now()
    }
  } catch (error) {
    const aborted = error instanceof DOMException && error.name === 'AbortError'
    return {
      state: 'offline',
      message: aborted ? 'Connection check timed out.' : 'Could not reach the backend. Check the URL, network, and CORS settings.',
      checkedAt: Date.now()
    }
  }
}

export interface GenerationJobUpdate {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress?: number
  message?: string
  videoUrl?: string
  thumbnailUrl?: string
  engine?: string
  model?: string
  isDemo: boolean
}

function resolveUrl(base: string, path?: string): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}

function mapJob(base: string, raw: Record<string, unknown>): GenerationJobUpdate {
  const status = String(raw.status ?? 'running') as GenerationJobUpdate['status']
  const progressValue = typeof raw.progress === 'number' ? Math.max(0, Math.min(1, raw.progress)) : undefined
  return {
    id: String(raw.id ?? ''),
    status: (['queued', 'running', 'completed', 'failed'].includes(status) ? status : 'running') as GenerationJobUpdate['status'],
    progress: progressValue,
    message: typeof raw.message === 'string' ? raw.message : undefined,
    videoUrl: resolveUrl(base, typeof raw.video_url === 'string' ? raw.video_url : undefined),
    thumbnailUrl: resolveUrl(base, typeof raw.thumbnail_url === 'string' ? raw.thumbnail_url : undefined),
    engine: typeof raw.engine === 'string' ? raw.engine : undefined,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    isDemo: Boolean(raw.is_demo)
  }
}

export async function createGeneration(
  baseUrl: string,
  config: GenerationConfig,
  imageDataUrl: string | null,
  signal?: AbortSignal
): Promise<GenerationJobUpdate> {
  const base = normalizeBaseUrl(baseUrl)
  const body = {
    prompt: config.prompt.trim(),
    input_mode: config.mode,
    image: config.mode === 'image' ? imageDataUrl ?? undefined : undefined,
    aspect_ratio: config.aspect,
    duration: config.duration,
    style: config.style,
    quality: config.quality
  }
  const res = await fetch(`${base}/api/generations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) {
    let detail = `Backend rejected the request (HTTP ${res.status}).`
    try {
      const data = (await res.json()) as { detail?: string; message?: string }
      detail = data.detail || data.message || detail
    } catch {
      /* keep default message */
    }
    throw new Error(detail)
  }
  const raw = (await res.json()) as Record<string, unknown>
  return mapJob(base, { status: 'queued', ...raw })
}

export interface PollOptions {
  signal?: AbortSignal
  onUpdate?: (update: GenerationJobUpdate) => void
  intervalMs?: number
  timeoutMs?: number
}

export async function pollGeneration(baseUrl: string, id: string, options: PollOptions = {}): Promise<GenerationJobUpdate> {
  const base = normalizeBaseUrl(baseUrl)
  const interval = options.intervalMs ?? 1500
  const deadline = Date.now() + (options.timeoutMs ?? 15 * 60 * 1000)

  while (Date.now() < deadline) {
    if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const res = await fetch(`${base}/api/generations/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
      signal: options.signal
    })
    if (!res.ok) throw new Error(`Lost contact with backend while generating (HTTP ${res.status}).`)
    const update = mapJob(base, (await res.json()) as Record<string, unknown>)
    options.onUpdate?.(update)
    if (update.status === 'completed') return update
    if (update.status === 'failed') throw new Error(update.message || 'The backend reported a failed generation.')
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw new Error('Generation timed out. The backend did not finish in time.')
}

export async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the selected image.'))
    reader.readAsDataURL(file)
  })
}
