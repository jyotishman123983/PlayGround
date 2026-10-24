import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, BackendStatus, GenerationConfig, GenerationMode, VideoRecord } from '../types'
import { AspectSelector, DurationChips, QualityPicker, StylePicker } from './Selectors'
import { Icon } from './Icon'
import { VideoCard } from './VideoCard'
import { useToast } from './Toast'
import { SAMPLE_PROMPTS, baseSize, qualityMeta } from '../lib/presets'
import { isDemoRecordingSupported, renderDemoVideo, samplePosterFor, sampleVideoFor } from '../lib/demoRenderer'
import { createGeneration, fileToDataUrl, pollGeneration } from '../lib/api'
import { downloadRemote, formatBytes, shareFileOrUrl } from '../lib/share'

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PROMPT = 600

type Status = 'idle' | 'rendering' | 'submitting' | 'polling'

interface HomePageProps {
  settings: AppSettings
  backend: BackendStatus
  recent: VideoRecord[]
  onOpenSettings: () => void
  onGoVideos: () => void
  onSave: (record: VideoRecord, blob: Blob | null) => Promise<void>
  onPreview: (record: VideoRecord) => void
  onDelete: (record: VideoRecord) => void
  onDownload: (record: VideoRecord) => void
  onShare: (record: VideoRecord) => void
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `vy-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function HomePage({ settings, backend, recent, onOpenSettings, onGoVideos, onSave, onPreview, onDelete, onDownload, onShare }: HomePageProps) {
  const { showToast } = useToast()
  const [tab, setTab] = useState<GenerationMode>('text')
  const [prompt, setPrompt] = useState('')
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [aspect, setAspect] = useState(settings.defaultAspect)
  const [style, setStyle] = useState(settings.defaultStyle)
  const [duration, setDuration] = useState(settings.defaultDuration)
  const [quality, setQuality] = useState(settings.quality)
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [renderedSeconds, setRenderedSeconds] = useState(0)
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [liveCanvas, setLiveCanvas] = useState<HTMLCanvasElement | null>(null)
  const [sampleOpen, setSampleOpen] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setAspect(settings.defaultAspect)
    setStyle(settings.defaultStyle)
    setDuration(settings.defaultDuration)
    setQuality(settings.quality)
  }, [settings.defaultAspect, settings.defaultStyle, settings.defaultDuration, settings.quality])

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(null)
      return
    }
    const url = URL.createObjectURL(imageFile)
    setImagePreview(url)
    return () => URL.revokeObjectURL(url)
  }, [imageFile])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    stage.innerHTML = ''
    if (liveCanvas) {
      liveCanvas.style.width = '100%'
      liveCanvas.style.height = '100%'
      liveCanvas.style.objectFit = 'contain'
      stage.appendChild(liveCanvas)
    }
  }, [liveCanvas])

  const busy = status !== 'idle'
  const outputSize = useMemo(() => baseSize(aspect, quality), [aspect, quality])
  const demoSupported = useMemo(() => isDemoRecordingSupported(), [])

  const resetForm = () => {
    setPrompt('')
    setImageFile(null)
    setError(null)
  }

  const handleImagePick = (file: File | null) => {
    setError(null)
    if (!file) {
      setImageFile(null)
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file (JPG, PNG, WEBP, or HEIC).')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`That image is ${formatBytes(file.size)}. Please pick one under ${formatBytes(MAX_IMAGE_BYTES)}.`)
      return
    }
    setImageFile(file)
  }

  const buildConfig = (): GenerationConfig | null => {
    const trimmed = prompt.trim()
    if (tab === 'text' && !trimmed) {
      setError('Add a prompt so the video has something to show. Hindi and English both work.')
      return null
    }
    if (tab === 'image' && !imageFile) {
      setError('Choose an image from your device first, or switch to Text-to-Video.')
      return null
    }
    return { mode: tab, prompt: trimmed, aspect, style, duration, quality, imageFile }
  }

  const finalizeRecord = useCallback(
    async (record: VideoRecord, blob: Blob | null) => {
      await onSave(record, blob)
      resetForm()
      if (settings.autoOpenPreview) onPreview(record)
      return record
    },
    [onSave, onPreview, settings.autoOpenPreview]
  )

  const generateDemo = async (config: GenerationConfig) => {
    if (!demoSupported) {
      setError('Your browser cannot record canvas video. Open the app in Chrome, Edge, or another Chromium browser, or watch the bundled sample instead.')
      setStatus('idle')
      return
    }
    setStatus('rendering')
    setProgress(0)
    setRenderedSeconds(0)
    setStatusMessage(`Rendering ${config.duration}s clip locally — frames are drawn on this device.`)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await renderDemoVideo(config, {
        signal: controller.signal,
        onCanvas: setLiveCanvas,
        onProgress: (update) => {
          setProgress(update.progress)
          setRenderedSeconds(update.renderedSeconds)
        }
      })
      const record: VideoRecord = {
        id: uid(),
        title: config.mode === 'image' ? 'Image → video demo' : (config.prompt.slice(0, 64) || 'Untitled demo'),
        prompt: config.prompt,
        inputMode: config.mode,
        aspect: config.aspect,
        style: config.style,
        duration: config.duration,
        quality: config.quality,
        engine: 'demo',
        engineLabel: 'Browser demo renderer',
        isAiGenerated: false,
        mime: result.mime,
        width: result.width,
        height: result.height,
        sizeBytes: result.blob.size,
        createdAt: Date.now(),
        thumbnail: result.thumbnail,
        blobKey: undefined
      }
      record.blobKey = record.id
      await finalizeRecord(record, result.blob)
      showToast('success', 'Demo clip ready', 'Rendered locally. This is not AI output.')
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        showToast('info', 'Generation cancelled', 'No clip was created.')
      } else {
        const message = err instanceof Error ? err.message : 'The demo renderer failed.'
        setError(message)
        showToast('error', 'Demo render failed', message)
      }
    } finally {
      abortRef.current = null
      setLiveCanvas(null)
      setStatus('idle')
      setProgress(0)
    }
  }

  const generateWithBackend = async (config: GenerationConfig) => {
    if (backend.state !== 'online') {
      const message =
        backend.state === 'unconfigured'
          ? 'No real engine is connected. Add a FastAPI backend URL in Settings, or switch back to demo mode.'
          : 'The backend is not reachable right now. Check the URL in Settings and try again.'
      setError(message)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    try {
      setStatus('submitting')
      setStatusMessage('Uploading request to the backend…')
      setProgress(0)
      const imageDataUrl = config.mode === 'image' && config.imageFile ? await fileToDataUrl(config.imageFile) : null
      const job = await createGeneration(settings.apiBaseUrl, config, imageDataUrl, controller.signal)
      setStatus('polling')
      setStatusMessage('Engine is processing. Progress below comes from the backend only.')
      const final = await pollGeneration(settings.apiBaseUrl, job.id, {
        signal: controller.signal,
        onUpdate: (update) => {
          if (typeof update.progress === 'number') setProgress(update.progress)
          if (update.message) setStatusMessage(update.message)
        }
      })
      const record: VideoRecord = {
        id: job.id,
        title: config.mode === 'image' ? 'Image → video' : (config.prompt.slice(0, 64) || 'Untitled generation'),
        prompt: config.prompt,
        inputMode: config.mode,
        aspect: config.aspect,
        style: config.style,
        duration: config.duration,
        quality: config.quality,
        engine: 'api',
        engineLabel: final.engine || backend.engine || 'Open-source engine',
        model: final.model || backend.model,
        isAiGenerated: !final.isDemo,
        mime: 'video/mp4',
        width: baseSize(config.aspect, config.quality).width,
        height: baseSize(config.aspect, config.quality).height,
        sizeBytes: 0,
        createdAt: Date.now(),
        thumbnail: final.thumbnailUrl,
        remoteUrl: final.videoUrl
      }
      await finalizeRecord(record, null)
      if (final.isDemo) {
        showToast('info', 'Backend returned a demo clip', 'The server engine reports this as a sample, not AI output.')
      } else {
        showToast('success', 'AI video ready', `Generated with ${record.engineLabel}.`)
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        showToast('info', 'Generation cancelled', 'The job was stopped.')
      } else {
        const message = err instanceof Error ? err.message : 'The backend request failed.'
        setError(message)
        showToast('error', 'Generation failed', message)
      }
    } finally {
      abortRef.current = null
      setStatus('idle')
      setProgress(0)
      setStatusMessage('')
    }
  }

  const handleGenerate = async () => {
    setError(null)
    const config = buildConfig()
    if (!config) return
    if (settings.mode === 'demo') {
      await generateDemo(config)
    } else {
      await generateWithBackend(config)
    }
  }

  const handleCancel = () => {
    abortRef.current?.abort()
  }

  const shareSample = async () => {
    const url = new URL(sampleVideoFor(aspect), window.location.origin).toString()
    try {
      const result = await shareFileOrUrl(null, url, 'ViralYantra demo sample', 'Procedural sample clip — not AI generated.')
      showToast(result === 'shared' ? 'success' : 'info', result === 'shared' ? 'Shared' : 'Link copied', result === 'shared' ? undefined : 'Sample link copied to clipboard.')
    } catch {
      showToast('info', 'Share unavailable', 'Use the download button to save the sample.')
    }
  }

  const sampleRecord: VideoRecord = useMemo(
    () => ({
      id: 'bundled-sample',
      title: 'Bundled demo sample',
      prompt: 'Procedural sample clip rendered with free, open tooling. Not AI generated.',
      inputMode: 'text',
      aspect,
      style,
      duration: 6,
      quality: 'standard',
      engine: 'demo',
      engineLabel: 'Bundled sample (static)',
      isAiGenerated: false,
      mime: 'video/mp4',
      width: outputSize.width,
      height: outputSize.height,
      sizeBytes: 0,
      createdAt: Date.now()
    }),
    [aspect, style, outputSize.width, outputSize.height]
  )

  const statusLabel = () => {
    if (status === 'rendering') return `Rendering locally · ${renderedSeconds.toFixed(1)}s / ${duration}s`
    if (status === 'submitting') return statusMessage || 'Submitting…'
    if (status === 'polling') return statusMessage || 'Engine processing…'
    return ''
  }

  const isRealMode = settings.mode === 'api'

  return (
    <div className="screen">
      <section className="hero">
        <span className="hero-eyebrow">
          <Icon name="sparkles" size={14} />
          Pocket video studio
        </span>
        <h1>
          Turn a spark into a
          <span className="hero-gradient"> scroll-stopper.</span>
        </h1>
        <p className="hero-sub">
          Write a prompt in <strong>हिंदी</strong> or English, pick a style, and preview a clip on your phone. No paid API keys required.
        </p>
      </section>

      <section className={`engine-banner ${isRealMode ? (backend.state === 'online' ? 'is-live' : 'is-warn') : 'is-demo'}`}>
        <span className="engine-banner-icon">
          <Icon name={isRealMode ? (backend.state === 'online' ? 'cpu' : 'wifiOff') : 'wand'} size={20} />
        </span>
        <div className="engine-banner-body">
          <strong>{isRealMode ? (backend.state === 'online' ? 'Real engine connected' : 'Real engine not connected') : 'Demo mode is on'}</strong>
          <span>
            {isRealMode
              ? backend.state === 'online'
                ? backend.message
                : 'Add or fix your backend URL in Settings. Nothing is faked — generation stays blocked until an engine answers.'
              : 'Clips are rendered on this device by the procedural demo engine. No AI model is running.'}
          </span>
        </div>
        <button type="button" className="engine-banner-action" onClick={() => setSampleOpen(true)}>
          <Icon name="play" size={15} filled />
          Sample
        </button>
      </section>

      <form
        className="composer card"
        onSubmit={(event) => {
          event.preventDefault()
          void handleGenerate()
        }}
      >
        <div className="mode-tabs" role="tablist" aria-label="Input mode">
          <button type="button" role="tab" aria-selected={tab === 'text'} className={tab === 'text' ? 'is-active' : ''} onClick={() => setTab('text')} disabled={busy}>
            <Icon name="text" size={17} />
            Text to Video
          </button>
          <button type="button" role="tab" aria-selected={tab === 'image'} className={tab === 'image' ? 'is-active' : ''} onClick={() => setTab('image')} disabled={busy}>
            <Icon name="image" size={17} />
            Image to Video
          </button>
        </div>

        {tab === 'text' ? (
          <div className="field">
            <div className="field-label-row">
              <label htmlFor="prompt">Describe your video</label>
              <span className={`counter${prompt.length > MAX_PROMPT ? ' is-over' : ''}`}>
                {prompt.length}/{MAX_PROMPT}
              </span>
            </div>
            <textarea
              id="prompt"
              className="prompt-input"
              value={prompt}
              maxLength={MAX_PROMPT + 40}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="e.g. A royal Bengal tiger walking through misty forest at sunrise, cinematic… / सूरज डूबते समय पहाड़ों पर सुनहरा नज़ारा"
              disabled={busy}
              rows={5}
            />
            <div className="suggestion-row">
              <span className="suggestion-label">Try:</span>
              {SAMPLE_PROMPTS.slice(0, 4).map((sample) => (
                <button key={sample} type="button" className="suggestion-chip" onClick={() => setPrompt(sample)} disabled={busy}>
                  {sample.length > 34 ? `${sample.slice(0, 34)}…` : sample}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="image-input">Choose an image from this device</label>
            <input
              ref={fileInputRef}
              id="image-input"
              type="file"
              accept="image/*"
              className="visually-hidden"
              onChange={(event) => handleImagePick(event.target.files?.[0] ?? null)}
              disabled={busy}
            />
            {imagePreview ? (
              <div className="image-preview">
                <img src={imagePreview} alt="Selected source" />
                <div className="image-preview-info">
                  <strong>{imageFile?.name}</strong>
                  <span>{imageFile ? formatBytes(imageFile.size) : ''}</span>
                </div>
                <button type="button" className="icon-button" onClick={() => setImageFile(null)} disabled={busy} aria-label="Remove image">
                  <Icon name="close" size={18} />
                </button>
              </div>
            ) : (
              <button type="button" className="upload-zone" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                <Icon name="upload" size={26} />
                <strong>Tap to select an image</strong>
                <span>JPG, PNG, WEBP or HEIC · up to {formatBytes(MAX_IMAGE_BYTES)}</span>
              </button>
            )}
            <textarea
              className="prompt-input prompt-input-small"
              value={prompt}
              maxLength={MAX_PROMPT}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Optional: describe the motion (e.g. slow camera push in)"
              disabled={busy}
              rows={2}
            />
          </div>
        )}

        <div className="field">
          <span className="field-label">Aspect ratio</span>
          <AspectSelector value={aspect} onChange={setAspect} />
        </div>

        <div className="field two-col">
          <div>
            <span className="field-label">Duration</span>
            <DurationChips value={duration} onChange={setDuration} />
            <p className="field-note">{isRealMode ? 'Depends on the connected model.' : `Demo records a real ${duration}s clip in real time.`}</p>
          </div>
          <div>
            <span className="field-label">Quality</span>
            <QualityPicker value={quality} onChange={setQuality} compact />
            <p className="field-note">
              {outputSize.width}×{outputSize.height} · {qualityMeta(quality).label}
            </p>
          </div>
        </div>

        <div className="field">
          <span className="field-label">Style preset</span>
          <StylePicker value={style} onChange={setStyle} />
        </div>

        {error && (
          <div className="inline-error" role="alert">
            <Icon name="alert" size={18} />
            <div>
              <span>{error}</span>
              {!demoSupported && settings.mode === 'demo' && (
                <button type="button" className="inline-link" onClick={() => setSampleOpen(true)}>
                  Watch bundled sample
                </button>
              )}
            </div>
          </div>
        )}

        {busy && (
          <div className="render-panel">
            <div className={`render-stage ratio-${aspect.replace(':', '-')}`} ref={stageRef}>
              {status === 'rendering' ? (
                <div className="render-live-badge">
                  <span className="live-dot" />
                  LIVE DEMO RENDER
                </div>
              ) : (
                <div className="render-stage-placeholder">
                  <span className="spinner" />
                </div>
              )}
            </div>
            <div className="render-body">
              <div className="render-progress-head">
                <strong>{statusLabel()}</strong>
                {status === 'rendering' && <span>{Math.round(progress * 100)}%</span>}
              </div>
              <div className={`progress-track${status === 'rendering' ? '' : ' is-indeterminate'}`}>
                <span style={status === 'rendering' ? { width: `${Math.max(progress * 100, 2)}%` } : undefined} />
              </div>
              <button type="button" className="ghost-button" onClick={handleCancel}>
                <Icon name="stop" size={15} />
                Cancel
              </button>
            </div>
          </div>
        )}

        <button type="submit" className="generate-button" disabled={busy}>
          {busy ? (
            <>
              <span className="spinner spinner-light" />
              {status === 'rendering' ? 'Rendering demo…' : 'Generating…'}
            </>
          ) : (
            <>
              <Icon name="wand" size={20} />
              {settings.mode === 'demo' ? 'Generate demo video' : 'Generate with AI engine'}
              <Icon name="chevron" size={18} />
            </>
          )}
        </button>

        <p className="composer-footnote">
          <Icon name={settings.mode === 'demo' ? 'wand' : 'shield'} size={14} />
          {settings.mode === 'demo'
            ? 'Local procedural render · no AI model · no data leaves your device'
            : 'Sends the request to your configured backend. No cloud API keys are bundled.'}
        </p>
      </form>

      <section className="recent-section">
        <div className="section-head">
          <h2>Recent creations</h2>
          {recent.length > 0 && (
            <button type="button" className="link-button" onClick={onGoVideos}>
              View all <Icon name="chevron" size={15} />
            </button>
          )}
        </div>
        {recent.length === 0 ? (
          <div className="empty-inline">
            <span className="empty-inline-icon">
              <Icon name="film" size={22} />
            </span>
            <div>
              <strong>No clips yet</strong>
              <span>Your generated clips appear here and stay on your device.</span>
            </div>
          </div>
        ) : (
          <div className="video-list">
            {recent.map((record) => (
              <VideoCard
                key={record.id}
                record={record}
                compact
                onOpen={() => onPreview(record)}
                onDownload={() => onDownload(record)}
                onShare={() => onShare(record)}
                onDelete={() => onDelete(record)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="how-card card">
        <h2>
          <Icon name="shield" size={18} /> How this prototype stays honest
        </h2>
        <ul>
          <li>
            <strong>Demo mode</strong> draws and records a real clip in your browser. It is clearly watermarked and never called AI.
          </li>
          <li>
            <strong>API mode</strong> is disabled until a backend confirms a loaded engine. Progress is shown only when the server reports it.
          </li>
          <li>
            <strong>No fake results.</strong> If nothing real can run, the app tells you and offers the bundled sample instead.
          </li>
        </ul>
        <button type="button" className="ghost-button" onClick={onOpenSettings}>
          <Icon name="settings" size={16} />
          Configure a real engine
        </button>
      </section>

      {sampleOpen && (
        <SampleModal
          record={sampleRecord}
          src={sampleVideoFor(aspect)}
          poster={samplePosterFor(aspect)}
          onClose={() => setSampleOpen(false)}
          onDownload={() => downloadRemote(sampleVideoFor(aspect), 'viralyantra-demo-sample.mp4')}
          onShare={() => void shareSample()}
        />
      )}
    </div>
  )
}

interface SampleModalProps {
  record: VideoRecord
  src: string
  poster: string
  onClose: () => void
  onDownload: () => void
  onShare: () => void
}

function SampleModal({ record, src, poster, onClose, onDownload, onShare }: SampleModalProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Demo sample" onClick={onClose}>
      <div className="preview-modal" onClick={(event) => event.stopPropagation()}>
        <div className="preview-header">
          <div className="preview-heading">
            <span className="source-badge is-demo">
              <Icon name="wand" size={13} />
              Demo sample · not AI
            </span>
            <h2>What demo mode looks like</h2>
            <p className="preview-sub">Bundled offline clip · 6s · {record.aspect}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close sample">
            <Icon name="close" size={20} />
          </button>
        </div>
        <div className={`preview-stage ratio-${record.aspect.replace(':', '-')}`}>
          <video src={src} poster={poster} playsInline controls autoPlay loop />
        </div>
        <p className="preview-disclaimer">
          <Icon name="info" size={15} />
          This bundled sample ships with the app so you can test the interface offline. It is a procedural animation, not an AI generation.
        </p>
        <div className="preview-actions">
          <button type="button" className="action-button" onClick={onDownload}>
            <Icon name="download" size={19} />
            Download sample
          </button>
          <button type="button" className="action-button" onClick={onShare}>
            <Icon name="share" size={19} />
            Share link
          </button>
        </div>
      </div>
    </div>
  )
}
