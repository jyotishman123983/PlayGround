import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, BackendStatus, VideoRecord } from '../types'
import { BottomNav, type PageId } from './BottomNav'
import { HomePage } from './HomePage'
import { MyVideosPage } from './MyVideosPage'
import { SettingsPage } from './SettingsPage'
import { VideoPreviewModal } from './VideoPreviewModal'
import { Logo } from './Logo'
import { Icon } from './Icon'
import { useToast, ToastProvider } from './Toast'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { checkBackend, isValidBaseUrl } from '../lib/api'
import * as db from '../lib/db'
import { downloadBlobUrl, downloadRemote, formatBytes, shareFileOrUrl } from '../lib/share'
import { isDemoRecordingSupported } from '../lib/demoRenderer'

const DEFAULT_SETTINGS: AppSettings = {
  mode: 'demo',
  apiBaseUrl: '',
  quality: 'standard',
  defaultAspect: '9:16',
  defaultStyle: 'cinematic',
  defaultDuration: 4,
  autoOpenPreview: true
}

function AppShell() {
  const { showToast } = useToast()
  const [settings, setSettings] = useLocalStorage<AppSettings>('viralyantra.settings', DEFAULT_SETTINGS)
  const [page, setPage] = useState<PageId>('home')
  const [records, setRecords] = useState<VideoRecord[]>([])
  const [loadingRecords, setLoadingRecords] = useState(true)
  const [backend, setBackend] = useState<BackendStatus>({ state: 'unconfigured', message: 'Add a backend URL in Settings to connect a real engine.' })
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const [persistState, setPersistState] = useState<'unknown' | 'granted' | 'denied'>('unknown')
  const [preview, setPreview] = useState<{ record: VideoRecord; src: string | null; loading: boolean } | null>(null)
  const [docsOpen, setDocsOpen] = useState(false)
  const previewUrlRef = useRef<string | null>(null)
  const checkTokenRef = useRef(0)

  const refreshUsage = useCallback(async () => {
    const estimate = await db.storageEstimate()
    setUsage(estimate)
  }, [])

  useEffect(() => {
    let active = true
    db.listRecords()
      .then((list) => {
        if (active) setRecords(list)
      })
      .catch(() => {
        if (active) showToast('error', 'Could not read local storage', 'History may be unavailable in private browsing.')
      })
      .finally(() => {
        if (active) setLoadingRecords(false)
      })
    void refreshUsage()
    return () => {
      active = false
    }
  }, [refreshUsage, showToast])

  useEffect(() => {
    const previous = previewUrlRef.current
    return () => {
      if (previous) URL.revokeObjectURL(previous)
    }
  }, [])

  const runBackendCheck = useCallback(
    async (url: string) => {
      const token = ++checkTokenRef.current
      setBackend({ state: 'checking', message: 'Contacting backend…' })
      const status = await checkBackend(url)
      if (token === checkTokenRef.current) setBackend(status)
    },
    []
  )

  useEffect(() => {
    if (settings.mode !== 'api') {
      setBackend((prev) => (prev.state === 'checking' ? { state: 'unconfigured', message: 'Add a backend URL in Settings to connect a real engine.' } : prev))
      return
    }
    if (!isValidBaseUrl(settings.apiBaseUrl)) {
      setBackend({ state: 'unconfigured', message: 'Add a backend URL in Settings to connect a real engine.' })
      return
    }
    const timer = window.setTimeout(() => void runBackendCheck(settings.apiBaseUrl), 350)
    return () => clearTimeout(timer)
  }, [settings.mode, settings.apiBaseUrl, runBackendCheck])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [page])

  const updateSettings = useCallback(
    (next: Partial<AppSettings>) => {
      setSettings((prev) => ({ ...prev, ...next }))
    },
    [setSettings]
  )

  const handleSave = useCallback(
    async (record: VideoRecord, blob: Blob | null) => {
      try {
        await db.saveRecord(record, blob)
      } catch {
        showToast('error', 'Could not save locally', 'The clip will stay in this session only.')
      }
      setRecords((prev) => [record, ...prev.filter((r) => r.id !== record.id)])
      void refreshUsage()
    },
    [refreshUsage, showToast]
  )

  const handleOpenPreview = useCallback(
    async (record: VideoRecord) => {
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current)
        previewUrlRef.current = null
      }
      if (record.remoteUrl) {
        setPreview({ record, src: record.remoteUrl, loading: false })
        return
      }
      if (!record.blobKey) {
        setPreview({ record, src: null, loading: false })
        return
      }
      setPreview({ record, src: null, loading: true })
      const blob = await db.getBlob(record.blobKey)
      if (blob) {
        const url = URL.createObjectURL(blob)
        previewUrlRef.current = url
        setPreview({ record, src: url, loading: false })
      } else {
        setPreview({ record, src: null, loading: false })
      }
    },
    []
  )

  const handleClosePreview = useCallback(() => {
    setPreview(null)
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current)
      previewUrlRef.current = null
    }
  }, [])

  const handleDelete = useCallback(
    async (record: VideoRecord) => {
      if (preview?.record.id === record.id) handleClosePreview()
      try {
        await db.deleteRecord(record.id)
      } catch {
        /* ignore */
      }
      setRecords((prev) => prev.filter((r) => r.id !== record.id))
      void refreshUsage()
      showToast('info', 'Clip deleted', record.title)
    },
    [preview, handleClosePreview, refreshUsage, showToast]
  )

  const handleClearAll = useCallback(async () => {
    if (preview) handleClosePreview()
    try {
      await db.clearRecords()
    } catch {
      /* ignore */
    }
    setRecords([])
    void refreshUsage()
    showToast('info', 'All clips cleared', 'Local storage is now empty.')
  }, [preview, handleClosePreview, refreshUsage, showToast])

  const handleDownload = useCallback(
    async (record: VideoRecord) => {
      const filename = `${record.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'viralyantra-clip'}.${record.mime.includes('mp4') ? 'mp4' : 'webm'}`
      if (record.blobKey) {
        const blob = await db.getBlob(record.blobKey)
        if (blob) {
          const url = URL.createObjectURL(blob)
          await downloadBlobUrl(url, filename)
          setTimeout(() => URL.revokeObjectURL(url), 4000)
          showToast('success', 'Download started', filename)
          return
        }
      }
      if (record.remoteUrl) {
        try {
          const res = await fetch(record.remoteUrl)
          if (!res.ok) throw new Error(String(res.status))
          const blob = await res.blob()
          const url = URL.createObjectURL(blob)
          await downloadBlobUrl(url, filename)
          setTimeout(() => URL.revokeObjectURL(url), 4000)
          showToast('success', 'Download started', filename)
        } catch {
          downloadRemote(record.remoteUrl, filename)
          showToast('info', 'Opened in a new tab', 'Right-click or long-press to save if the download did not start.')
        }
        return
      }
      showToast('error', 'File unavailable', 'This clip has no local file to download.')
    },
    [showToast]
  )

  const handleShare = useCallback(
    async (record: VideoRecord) => {
      const filename = `${record.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'viralyantra-clip'}.${record.mime.includes('mp4') ? 'mp4' : 'webm'}`
      try {
        if (record.blobKey) {
          const blob = await db.getBlob(record.blobKey)
          if (blob && typeof File !== 'undefined') {
            const file = new File([blob], filename, { type: record.mime })
            const result = await shareFileOrUrl(file, URL.createObjectURL(blob), record.title, record.prompt || 'Made with ViralYantra AI')
            showToast(result === 'shared' ? 'success' : 'info', result === 'shared' ? 'Shared' : 'Link copied', result === 'shared' ? undefined : 'Sharing files is not supported here, so a link was copied.')
            return
          }
        }
        const url = record.remoteUrl || window.location.href
        const result = await shareFileOrUrl(null, url, record.title, record.prompt || 'Made with ViralYantra AI')
        showToast(result === 'shared' ? 'success' : 'info', result === 'shared' ? 'Shared' : 'Link copied')
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        showToast('error', 'Sharing failed', 'Download the clip and share it manually.')
      }
    },
    [showToast]
  )

  const handlePersist = useCallback(async () => {
    const granted = await db.requestPersistentStorage()
    setPersistState(granted ? 'granted' : 'denied')
    showToast(granted ? 'success' : 'info', granted ? 'Storage protected' : 'Not granted', granted ? 'The browser will try to keep your clips.' : 'The browser may still clear clips under storage pressure.')
  }, [showToast])

  const usageLabel = useMemo(() => (usage && usage.usage > 0 ? `${formatBytes(usage.usage)} used` : null), [usage])
  const recent = useMemo(() => records.slice(0, 3), [records])
  const modeLabel = settings.mode === 'demo' ? 'Demo mode' : backend.state === 'online' ? 'AI connected' : 'Engine offline'

  return (
    <div className="app-shell">
      <div className="ambient" aria-hidden="true">
        <span className="ambient-orb orb-purple" />
        <span className="ambient-orb orb-orange" />
        <span className="ambient-grid" />
      </div>

      <header className="top-bar">
        <button type="button" className="brand-button" onClick={() => setPage('home')} aria-label="ViralYantra AI home">
          <Logo />
        </button>
        <div className="top-bar-right">
          <span className={`mode-pill mode-${settings.mode}${settings.mode === 'api' && backend.state !== 'online' ? ' is-off' : ''}`}>
            <span className="mode-dot" />
            {modeLabel}
          </span>
          <button type="button" className="icon-button" onClick={() => setPage('settings')} aria-label="Open settings">
            <Icon name="settings" size={20} />
          </button>
        </div>
      </header>

      <main className="app-main">
        <div key={page} className="page-transition">
          {page === 'home' && (
            <HomePage
              settings={settings}
              backend={backend}
              recent={recent}
              onOpenSettings={() => setPage('settings')}
              onGoVideos={() => setPage('videos')}
              onSave={handleSave}
              onPreview={handleOpenPreview}
              onDelete={handleDelete}
              onDownload={handleDownload}
              onShare={handleShare}
            />
          )}
          {page === 'videos' && (
            <MyVideosPage
              records={records}
              loading={loadingRecords}
              onOpen={handleOpenPreview}
              onDelete={handleDelete}
              onDownload={handleDownload}
              onShare={handleShare}
              onClearAll={handleClearAll}
              onGoHome={() => setPage('home')}
              usageLabel={usageLabel}
            />
          )}
          {page === 'settings' && (
            <SettingsPage
              settings={settings}
              backend={backend}
              onChange={updateSettings}
              onCheckBackend={() => void runBackendCheck(settings.apiBaseUrl)}
              onClearAll={handleClearAll}
              onPersist={() => void handlePersist()}
              persistState={persistState}
              usageLabel={usageLabel}
              onGoHome={() => setPage('home')}
              onOpenDocs={() => setDocsOpen(true)}
            />
          )}
        </div>
      </main>

      <BottomNav page={page} onChange={setPage} videosCount={records.length} />

      {preview && (
        <VideoPreviewModal
          record={preview.record}
          src={preview.src}
          loading={preview.loading}
          onClose={handleClosePreview}
          onDownload={() => void handleDownload(preview.record)}
          onShare={() => void handleShare(preview.record)}
          onDelete={() => void handleDelete(preview.record)}
        />
      )}

      {docsOpen && <DocsModal onClose={() => setDocsOpen(false)} onOpenEngine={() => { setDocsOpen(false); setPage('settings') }} />}

      {!isDemoRecordingSupported() && settings.mode === 'demo' && <span className="visually-hidden">Canvas recording is not supported in this browser.</span>}
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AppShell />
    </ToastProvider>
  )
}

function DocsModal({ onClose, onOpenEngine }: { onClose: () => void; onOpenEngine: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Setup guide" onClick={onClose}>
      <div className="preview-modal docs-modal" onClick={(event) => event.stopPropagation()}>
        <div className="preview-header">
          <div className="preview-heading">
            <span className="source-badge is-ai">
              <Icon name="external" size={13} />
              Guide
            </span>
            <h2>Connect a real video model</h2>
            <p className="preview-sub">Full instructions live in README.md and backend/README.md.</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close guide">
            <Icon name="close" size={20} />
          </button>
        </div>
        <ol className="docs-steps">
          <li>
            <strong>Run the reference backend.</strong> <code>cd backend &amp;&amp; pip install -r requirements.txt &amp;&amp; uvicorn app.main:app --host 0.0.0.0 --port 8000</code>. With no model configured it reports “unavailable” and refuses to fake output.
          </li>
          <li>
            <strong>Install an open-source model.</strong> Follow <code>backend/README.md</code> to enable a pretrained text-to-video checkpoint (for example ModelScope text-to-video or an LTX-Video / Wan class model) through the engine adapter.
          </li>
          <li>
            <strong>Point the app at it.</strong> Open Settings → Real engine → paste your server URL (on a phone, use your computer’s LAN IP) → Test. The header badge turns into “AI connected”.
          </li>
          <li>
            <strong>Generate honestly.</strong> Progress bars only move on real backend progress. If the server says the provider is a sample, the clip stays marked “not AI”.
          </li>
          <li>
            <strong>Package for Android.</strong> Use the PWA install prompt, or wrap the built <code>dist/</code> with Capacitor/Bubblewrap as described in the README.
          </li>
        </ol>
        <div className="preview-actions">
          <button type="button" className="action-button" onClick={onOpenEngine}>
            <Icon name="cpu" size={19} />
            Open engine settings
          </button>
          <button type="button" className="ghost-button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
