import type { DemoProgress, DemoRenderResult, GenerationConfig } from '../types'
import { baseSize, styleMeta } from './presets'

interface StylePalette {
  bg: string
  blobs: string[]
  accent: string
  accent2: string
  text: string
}

const PALETTES: Record<string, StylePalette> = {
  realistic: { bg: '#0a0d12', blobs: ['#f59e0b', '#0ea5e9', '#f97316', '#1e293b'], accent: '#fbbf24', accent2: '#38bdf8', text: '#fff7ed' },
  cinematic: { bg: '#04070d', blobs: ['#0ea5e9', '#f97316', '#7c3aed', '#0f172a'], accent: '#fb923c', accent2: '#22d3ee', text: '#ecfeff' },
  cartoon: { bg: '#1b0f3a', blobs: ['#a855f7', '#22d3ee', '#f472b6', '#facc15'], accent: '#f0abfc', accent2: '#67e8f9', text: '#ffffff' },
  anime: { bg: '#0b1226', blobs: ['#60a5fa', '#f472b6', '#fde68a', '#312e81'], accent: '#f9a8d4', accent2: '#93c5fd', text: '#ffffff' },
  fantasy: { bg: '#07120f', blobs: ['#34d399', '#8b5cf6', '#facc15', '#0f766e'], accent: '#6ee7b7', accent2: '#c4b5fd', text: '#f0fdf4' }
}

const FONT_STACK = '"Outfit", "Noto Sans Devanagari", system-ui, sans-serif'

let noiseTile: HTMLCanvasElement | null = null

function getNoiseTile(): HTMLCanvasElement {
  if (noiseTile) return noiseTile
  const size = 160
  const c = document.createElement('canvas')
  c.width = size
  c.height = size
  const ctx = c.getContext('2d')
  if (ctx) {
    const img = ctx.createImageData(size, size)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 120 + Math.random() * 135
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 26
    }
    ctx.putImageData(img, 0, 0)
  }
  noiseTile = c
  return c
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16)
  const g = parseInt(clean.substring(2, 4), 16)
  const b = parseInt(clean.substring(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

export async function ensureDemoFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await Promise.all([
      document.fonts.load('800 64px Outfit'),
      document.fonts.load('600 32px Outfit'),
      document.fonts.load('600 32px "Noto Sans Devanagari"'),
      document.fonts.load('500 24px "Noto Sans Devanagari"')
    ])
    await document.fonts.ready
  } catch {
    /* Font loading is best-effort; canvas falls back to system fonts. */
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current)
      current = word
      if (lines.length === maxLines - 1) break
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.slice(0, maxLines)
}

function fitPromptText(ctx: CanvasRenderingContext2D, text: string, width: number, height: number): { lines: string[]; size: number } {
  const maxWidth = width * 0.82
  const maxLines = 4
  let size = Math.max(26, Math.round(width * 0.062))
  for (let i = 0; i < 8; i += 1) {
    ctx.font = `700 ${size}px ${FONT_STACK}`
    const lines = wrapText(ctx, text, maxWidth, maxLines)
    const totalWidth = Math.max(...lines.map((l) => ctx.measureText(l).width), 0)
    const totalHeight = lines.length * size * 1.22
    if ((totalWidth <= maxWidth && lines.length <= maxLines && totalHeight < height * 0.42) || size <= 24) {
      return { lines, size }
    }
    size = Math.round(size * 0.9)
  }
  return { lines: wrapText(ctx, text, maxWidth, maxLines), size }
}

interface DrawArgs {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  time: number
  duration: number
  config: GenerationConfig
  image?: ImageBitmap | null
}

function drawBackground({ ctx, width, height, time, config }: DrawArgs) {
  const palette = PALETTES[config.style] ?? PALETTES.cinematic
  const t = time
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, width, height)

  const blobs = palette.blobs
  for (let i = 0; i < blobs.length; i += 1) {
    const phase = t * (0.16 + i * 0.045) + i * 1.9
    const cx = width * (0.5 + 0.42 * Math.sin(phase * 1.1 + i))
    const cy = height * (0.45 + 0.36 * Math.cos(phase * 0.9 + i * 1.3))
    const radius = Math.max(width, height) * (0.34 + 0.12 * Math.sin(phase * 0.7 + i))
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, withAlpha(blobs[i], 0.55))
    grad.addColorStop(0.55, withAlpha(blobs[i], 0.16))
    grad.addColorStop(1, withAlpha(blobs[i], 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  if (config.style === 'cinematic') {
    const bar = height * 0.075
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, bar)
    ctx.fillRect(0, height - bar, width, bar)
  }
}

function drawDecor({ ctx, width, height, time, config }: DrawArgs) {
  const palette = PALETTES[config.style] ?? PALETTES.cinematic
  const t = time

  if (config.style === 'realistic') {
    for (let i = 0; i < 22; i += 1) {
      const seed = i * 12.9898
      const x = ((Math.sin(seed) * 43758.5453) % 1 + 1) % 1
      const y = ((Math.sin(seed * 1.7) * 24634.6345) % 1 + 1) % 1
      const r = width * (0.012 + 0.02 * Math.abs(Math.sin(seed * 2.3)))
      const drift = Math.sin(t * 0.5 + i) * width * 0.02
      const grad = ctx.createRadialGradient(x * width + drift, y * height, 0, x * width + drift, y * height, r)
      grad.addColorStop(0, withAlpha(i % 2 ? '#fde68a' : '#7dd3fc', 0.38))
      grad.addColorStop(1, withAlpha('#000000', 0))
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x * width + drift, y * height, r, 0, Math.PI * 2)
      ctx.fill()
    }
  } else if (config.style === 'cinematic') {
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    for (let i = 0; i < 3; i += 1) {
      const y = height * (0.3 + i * 0.18) + Math.sin(t * 0.6 + i) * height * 0.03
      const grad = ctx.createLinearGradient(0, y - 12, width, y + 12)
      grad.addColorStop(0, withAlpha(palette.accent2, 0))
      grad.addColorStop(0.5, withAlpha(palette.accent, 0.28))
      grad.addColorStop(1, withAlpha(palette.accent2, 0))
      ctx.fillStyle = grad
      ctx.fillRect(0, y - 14, width, 28)
    }
    ctx.restore()
  } else if (config.style === 'cartoon') {
    for (let i = 0; i < 7; i += 1) {
      const phase = t * 0.7 + i * 1.4
      const x = width * (0.15 + 0.7 * ((Math.sin(phase * 0.6) + 1) / 2))
      const y = height * (0.18 + 0.62 * ((Math.cos(phase * 0.5 + i) + 1) / 2))
      const r = width * (0.05 + 0.03 * (i % 3))
      const color = palette.blobs[i % palette.blobs.length]
      const grad = ctx.createLinearGradient(x - r, y - r, x + r, y + r)
      grad.addColorStop(0, withAlpha('#ffffff', 0.35))
      grad.addColorStop(0.45, withAlpha(color, 0.9))
      grad.addColorStop(1, withAlpha(color, 0.55))
      ctx.fillStyle = grad
      roundedRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.55)
      ctx.fill()
    }
  } else if (config.style === 'anime') {
    ctx.save()
    ctx.translate(width / 2, height * 0.5)
    ctx.strokeStyle = withAlpha('#ffffff', 0.14)
    ctx.lineWidth = Math.max(2, width * 0.003)
    const lines = 42
    for (let i = 0; i < lines; i += 1) {
      const angle = (i / lines) * Math.PI * 2 + t * 0.12
      const inner = Math.max(width, height) * (0.22 + 0.05 * Math.sin(t * 2 + i))
      const outer = Math.max(width, height) * 0.75
      ctx.beginPath()
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner)
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer)
      ctx.stroke()
    }
    ctx.restore()
    for (let i = 0; i < 16; i += 1) {
      const phase = t * 1.4 + i
      const x = width * (((Math.sin(i * 3.7) * 0.5) + 0.5))
      const y = ((height * 0.15 + ((i * 97) % (height * 0.7))) + Math.sin(phase) * 18)
      const s = width * (0.006 + 0.006 * ((i % 3)))
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(phase * 1.5))
      ctx.fillStyle = withAlpha(i % 2 ? palette.accent : '#ffffff', tw)
      ctx.beginPath()
      ctx.moveTo(x, y - s * 2)
      ctx.lineTo(x + s, y)
      ctx.lineTo(x, y + s * 2)
      ctx.lineTo(x - s, y)
      ctx.closePath()
      ctx.fill()
    }
  } else if (config.style === 'fantasy') {
    for (let i = 0; i < 46; i += 1) {
      const seed = i * 4.177
      const x = (((Math.sin(seed) * 9991.7) % 1) + 1) % 1
      const y = (((Math.cos(seed * 1.3) * 7771.3) % 1) + 1) % 1
      const phase = (t * 0.12 + i * 0.037) % 1
      const py = (y - phase + 1) % 1
      const size = width * (0.003 + 0.007 * (((i * 7) % 5) / 5))
      const alpha = 0.25 + 0.55 * Math.abs(Math.sin(t * 1.1 + i))
      ctx.fillStyle = withAlpha(i % 3 === 0 ? palette.accent2 : palette.accent, alpha * (1 - phase * 0.4))
      ctx.beginPath()
      ctx.arc(x * width, py * height, size, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = withAlpha(palette.accent2, 0.08)
    ctx.beginPath()
    ctx.ellipse(width * 0.5, height * 0.75, width * 0.7, height * 0.18, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawImageLayer({ ctx, width, height, time, duration, image }: DrawArgs) {
  if (!image) return
  const zoom = 1.06 + 0.12 * (time / Math.max(duration, 0.001))
  const panX = Math.sin(time * 0.35) * width * 0.02
  const panY = Math.cos(time * 0.3) * height * 0.02
  const scale = Math.max(width / image.width, height / image.height) * zoom
  const dw = image.width * scale
  const dh = image.height * scale
  ctx.drawImage(image, (width - dw) / 2 + panX, (height - dh) / 2 + panY, dw, dh)
}

function drawGrade({ ctx, width, height, time, config }: DrawArgs) {
  const palette = PALETTES[config.style] ?? PALETTES.cinematic
  ctx.save()
  ctx.globalCompositeOperation = 'soft-light'
  const grad = ctx.createLinearGradient(0, 0, width, height)
  grad.addColorStop(0, withAlpha(palette.accent, 0.34))
  grad.addColorStop(1, withAlpha(palette.accent2, 0.34))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, width, height)
  ctx.restore()

  const vignette = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.28, width / 2, height / 2, Math.max(width, height) * 0.72)
  vignette.addColorStop(0, 'rgba(0,0,0,0)')
  vignette.addColorStop(1, `rgba(0,0,0,${0.42 + 0.06 * Math.sin(time * 0.8)})`)
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, width, height)
}

function drawText({ ctx, width, height, time, duration, config }: DrawArgs) {
  const palette = PALETTES[config.style] ?? PALETTES.cinematic
  const style = styleMeta(config.style)
  const scale = width / 720
  const pad = Math.max(18, Math.round(28 * scale))
  const anim = Math.min(1, time * 3)

  ctx.save()
  ctx.globalAlpha = anim

  const markSize = Math.max(34, Math.round(54 * scale))
  const markX = pad
  const markY = Math.round(height * 0.085)
  const markGrad = ctx.createLinearGradient(markX, markY, markX + markSize, markY + markSize)
  markGrad.addColorStop(0, '#8b5cf6')
  markGrad.addColorStop(1, '#fb923c')
  ctx.fillStyle = markGrad
  roundedRect(ctx, markX, markY, markSize, markSize, markSize * 0.3)
  ctx.fill()
  ctx.fillStyle = '#150b2e'
  ctx.beginPath()
  const cx = markX + markSize * 0.52
  const cy = markY + markSize * 0.5
  const pr = markSize * 0.18
  ctx.moveTo(cx - pr * 0.7, cy - pr)
  ctx.lineTo(cx + pr * 1.1, cy)
  ctx.lineTo(cx - pr * 0.7, cy + pr)
  ctx.closePath()
  ctx.fill()

  ctx.textBaseline = 'middle'
  ctx.fillStyle = '#ffffff'
  ctx.font = `800 ${Math.round(30 * scale)}px ${FONT_STACK}`
  ctx.fillText('ViralYantra', markX + markSize + 12 * scale, markY + markSize * 0.5)

  const badgeText = 'DEMO'
  ctx.font = `700 ${Math.round(18 * scale)}px ${FONT_STACK}`
  const badgeW = ctx.measureText(badgeText).width + 24 * scale
  const badgeH = 34 * scale
  const badgeX = width - pad - badgeW
  const badgeY = markY + (markSize - badgeH) / 2
  ctx.fillStyle = withAlpha('#fb923c', 0.9)
  roundedRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2)
  ctx.fill()
  ctx.fillStyle = '#1a0b02'
  ctx.textAlign = 'center'
  ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 1)
  ctx.textAlign = 'left'

  const prompt = config.prompt.trim() || (config.mode === 'image' ? 'Image → video' : 'Your prompt appears here')
  const { lines, size } = fitPromptText(ctx, prompt, width, height)
  const lineHeight = size * 1.2
  const blockHeight = lines.length * lineHeight
  const startY = height * 0.48 - blockHeight / 2 + lineHeight * 0.5
  const slide = (1 - Math.min(1, Math.max(0, (time - 0.25) * 2))) * height * 0.03

  ctx.textAlign = 'center'
  ctx.font = `600 ${Math.round(size * 0.42)}px ${FONT_STACK}`
  ctx.fillStyle = palette.accent
  ctx.fillText(`${style.emoji}  ${style.label.toUpperCase()}`, width / 2, startY - lineHeight * 0.95 + slide)

  ctx.font = `700 ${size}px ${FONT_STACK}`
  ctx.shadowColor = 'rgba(0,0,0,0.55)'
  ctx.shadowBlur = 26
  lines.forEach((line, i) => {
    ctx.fillStyle = palette.text
    ctx.fillText(line, width / 2, startY + i * lineHeight + slide)
  })
  ctx.shadowBlur = 0
  ctx.textAlign = 'left'

  const metaY = height - pad - 30 * scale
  const metaLeft = `${config.aspect}  ·  ${Math.round(duration)}s  ·  ${config.quality.toUpperCase()}`
  ctx.font = `600 ${Math.round(20 * scale)}px ${FONT_STACK}`
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  ctx.fillText(metaLeft, pad, metaY)

  const warn = 'LOCAL DEMO · NOT AI GENERATED'
  ctx.font = `700 ${Math.round(17 * scale)}px ${FONT_STACK}`
  const warnW = ctx.measureText(warn).width + 26 * scale
  const warnH = 32 * scale
  ctx.fillStyle = 'rgba(0,0,0,0.45)'
  roundedRect(ctx, width - pad - warnW, metaY - warnH / 2, warnW, warnH, warnH / 2)
  ctx.fill()
  ctx.strokeStyle = withAlpha('#fda4af', 0.7)
  ctx.lineWidth = Math.max(1, 1.5 * scale)
  ctx.stroke()
  ctx.fillStyle = '#fecdd3'
  ctx.textAlign = 'center'
  ctx.fillText(warn, width - pad - warnW / 2, metaY + 1)
  ctx.textAlign = 'left'

  ctx.restore()
}

function drawGrain(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const tile = getNoiseTile()
  ctx.save()
  ctx.globalAlpha = 0.5
  const pattern = ctx.createPattern(tile, 'repeat')
  if (pattern) {
    ctx.fillStyle = pattern
    ctx.fillRect(0, 0, width, height)
  }
  ctx.restore()
}

export function drawDemoFrame(ctx: CanvasRenderingContext2D, args: DrawArgs) {
  drawBackground(args)
  if (args.image) {
    drawImageLayer(args)
    drawGrade(args)
  }
  drawDecor(args)
  if (!args.image) {
    drawGrain(ctx, args.width, args.height)
  }
  drawText(args)
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=h264',
    'video/mp4'
  ]
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

export function isDemoRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype && pickMimeType() !== ''
}

export function mimeExtension(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  return 'webm'
}

export interface RenderDemoOptions {
  signal?: AbortSignal
  onCanvas?: (canvas: HTMLCanvasElement | null) => void
  onProgress?: (progress: DemoProgress) => void
}

export async function renderDemoVideo(config: GenerationConfig, options: RenderDemoOptions = {}): Promise<DemoRenderResult> {
  const { signal } = options
  const mime = pickMimeType()
  if (!mime || !isDemoRecordingSupported()) {
    throw new Error('This browser cannot record canvas video (MediaRecorder unavailable). Use the bundled sample preview instead.')
  }

  await ensureDemoFonts()

  const { width, height } = baseSize(config.aspect, config.quality)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context is unavailable on this device.')

  let image: ImageBitmap | null = null
  if (config.imageFile) {
    try {
      image = await createImageBitmap(config.imageFile)
    } catch {
      image = null
    }
  }

  const duration = config.duration
  const frameArgs: DrawArgs = { ctx, width, height, time: 0, duration, config, image }

  const poster = document.createElement('canvas')
  poster.width = width
  poster.height = height
  const posterCtx = poster.getContext('2d')
  if (posterCtx) {
    drawDemoFrame(posterCtx, { ...frameArgs, ctx: posterCtx, time: Math.min(duration * 0.35, 2) })
  }
  const thumbnail = poster.toDataURL('image/jpeg', 0.72)

  drawDemoFrame(ctx, frameArgs)
  options.onCanvas?.(canvas)

  const fps = 30
  const stream = canvas.captureStream(fps)
  const bitrate = Math.min(8_000_000, Math.max(1_500_000, Math.round(width * height * fps * 0.11)))
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate })
  const chunks: BlobPart[] = []
  let raf = 0

  const cleanup = () => {
    if (raf) cancelAnimationFrame(raf)
    stream.getTracks().forEach((track) => track.stop())
    if (image) image.close()
    options.onCanvas?.(null)
  }

  return await new Promise<DemoRenderResult>((resolve, reject) => {
    let settled = false

    const abort = () => {
      if (settled) return
      settled = true
      try {
        if (recorder.state !== 'inactive') recorder.stop()
      } catch {
        /* ignore */
      }
      cleanup()
      reject(new DOMException('Generation cancelled', 'AbortError'))
    }

    if (signal) {
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data)
    }

    recorder.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      reject(new Error('The browser reported a recording error while rendering the demo clip.'))
    }

    recorder.onstop = () => {
      if (settled) return
      settled = true
      cleanup()
      const blob = new Blob(chunks, { type: mime })
      if (blob.size === 0) {
        reject(new Error('The demo renderer produced an empty clip. Try a lower quality setting.'))
        return
      }
      resolve({ blob, mime, width, height, duration, thumbnail })
    }

    const startTime = performance.now()
    const tick = (now: number) => {
      if (settled) return
      const elapsed = (now - startTime) / 1000
      const time = Math.min(elapsed, duration)
      drawDemoFrame(ctx, { ...frameArgs, time })
      options.onProgress?.({ progress: Math.min(1, time / duration), renderedSeconds: time, duration })
      if (elapsed >= duration) {
        try {
          if (recorder.state === 'recording') recorder.stop()
        } catch {
          /* ignore */
        }
        return
      }
      raf = requestAnimationFrame(tick)
    }

    recorder.start(250)
    raf = requestAnimationFrame(tick)
  })
}

export function sampleVideoFor(aspect: GenerationConfig['aspect']): string {
  if (aspect === '16:9') return '/demo/demo-landscape.mp4'
  if (aspect === '1:1') return '/demo/demo-square.mp4'
  return '/demo/demo-portrait.mp4'
}

export function samplePosterFor(aspect: GenerationConfig['aspect']): string {
  if (aspect === '16:9') return '/demo/poster-landscape.jpg'
  if (aspect === '1:1') return '/demo/poster-square.jpg'
  return '/demo/poster-portrait.jpg'
}
