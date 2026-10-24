import type { AppSettings, AspectRatio, BackendStatus, EngineMode, Quality, StyleId } from '../types'
import { Icon } from './Icon'
import { AspectSelector, DurationChips, QualityPicker, StylePicker } from './Selectors'
import { isValidBaseUrl } from '../lib/api'
import { APP_VERSION } from '../version'

interface SettingsPageProps {
  settings: AppSettings
  backend: BackendStatus
  onChange: (next: Partial<AppSettings>) => void
  onCheckBackend: () => void
  onClearAll: () => void
  onPersist: () => void
  persistState: 'unknown' | 'granted' | 'denied'
  usageLabel: string | null
  onGoHome: () => void
  onOpenDocs: () => void
}

const MODES: { id: EngineMode; label: string; blurb: string; icon: 'wand' | 'cpu' }[] = [
  { id: 'demo', label: 'Demo mode', blurb: 'Renders a watermarked procedural clip in your browser. Never labelled as AI.', icon: 'wand' },
  { id: 'api', label: 'Real engine', blurb: 'Uses your FastAPI backend and an open-source model. Requires a running server.', icon: 'cpu' }
]

export function SettingsPage({ settings, backend, onChange, onCheckBackend, onClearAll, onPersist, persistState, usageLabel, onGoHome, onOpenDocs }: SettingsPageProps) {
  const urlValid = isValidBaseUrl(settings.apiBaseUrl)

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Engine, output defaults, storage, and app info.</p>
        </div>
      </header>

      <section className="card settings-group">
        <h2 className="group-title">
          <Icon name="cpu" size={18} /> Generation engine
        </h2>
        <div className="mode-cards">
          {MODES.map((mode) => {
            const active = settings.mode === mode.id
            return (
              <button key={mode.id} type="button" className={`mode-card${active ? ' is-active' : ''}`} onClick={() => onChange({ mode: mode.id })}>
                <span className="mode-card-icon">
                  <Icon name={mode.icon} size={20} />
                </span>
                <span className="mode-card-text">
                  <strong>{mode.label}</strong>
                  <span>{mode.blurb}</span>
                </span>
                <span className={`radio-dot${active ? ' is-on' : ''}`} />
              </button>
            )
          })}
        </div>

        {settings.mode === 'demo' && (
          <p className="group-note is-demo">
            <Icon name="info" size={15} /> Demo mode produces a genuine local render, but it is <strong>not</strong> an AI model. Switch to Real engine once your backend is running.
          </p>
        )}

        {settings.mode === 'api' && (
          <div className="backend-config">
            <label htmlFor="api-url">Backend base URL</label>
            <div className="url-row">
              <input
                id="api-url"
                type="url"
                inputMode="url"
                value={settings.apiBaseUrl}
                onChange={(event) => onChange({ apiBaseUrl: event.target.value })}
                placeholder="http://192.168.1.20:8000"
                autoComplete="off"
                spellCheck={false}
              />
              <button type="button" className="test-button" onClick={onCheckBackend} disabled={!urlValid || backend.state === 'checking'}>
                {backend.state === 'checking' ? <span className="spinner" /> : <Icon name="refresh" size={16} />}
                Test
              </button>
            </div>
            {!urlValid && settings.apiBaseUrl.trim() !== '' && <span className="field-error">Enter a full URL starting with http:// or https://</span>}

            <div className={`backend-status is-${backend.state}`}>
              <span className="backend-status-icon">
                <Icon name={backend.state === 'online' ? 'check' : backend.state === 'checking' ? 'refresh' : backend.state === 'offline' ? 'wifiOff' : 'info'} size={16} />
              </span>
              <div>
                <strong>
                  {backend.state === 'online' ? 'Connected' : backend.state === 'checking' ? 'Checking…' : backend.state === 'offline' ? 'Not reachable' : 'Not configured'}
                </strong>
                <span>{backend.message}</span>
                {backend.state === 'online' && backend.demo && (
                  <span className="backend-demo-flag">This engine identifies itself as a demo/sample provider, so its output stays labelled “not AI”.</span>
                )}
              </div>
            </div>

            <p className="group-note">
              <Icon name="lock" size={15} /> Point this at the FastAPI server from <code>backend/</code>. No cloud API keys are stored in the app — the server holds whatever the model needs.
            </p>
          </div>
        )}
      </section>

      <section className="card settings-group">
        <h2 className="group-title">
          <Icon name="film" size={18} /> Output defaults
        </h2>
        <div className="setting-row-block">
          <span className="field-label">Default quality</span>
          <QualityPicker value={settings.quality} onChange={(value: Quality) => onChange({ quality: value })} />
        </div>
        <div className="setting-row-block">
          <span className="field-label">Default aspect ratio</span>
          <AspectSelector value={settings.defaultAspect} onChange={(value: AspectRatio) => onChange({ defaultAspect: value })} />
        </div>
        <div className="setting-row-block">
          <span className="field-label">Default duration</span>
          <DurationChips value={settings.defaultDuration} onChange={(value: number) => onChange({ defaultDuration: value })} />
        </div>
        <div className="setting-row-block">
          <span className="field-label">Default style</span>
          <StylePicker value={settings.defaultStyle} onChange={(value: StyleId) => onChange({ defaultStyle: value })} />
        </div>
        <label className="toggle-row">
          <span>
            <strong>Open preview automatically</strong>
            <span>Play a clip as soon as it finishes.</span>
          </span>
          <input type="checkbox" checked={settings.autoOpenPreview} onChange={(event) => onChange({ autoOpenPreview: event.target.checked })} />
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-knob" />
          </span>
        </label>
      </section>

      <section className="card settings-group">
        <h2 className="group-title">
          <Icon name="videos" size={18} /> Data & storage
        </h2>
        <div className="storage-row">
          <span>
            <strong>Local clips</strong>
            <span>Saved in your browser via IndexedDB{usageLabel ? ` · ${usageLabel}` : ''}.</span>
          </span>
        </div>
        <div className="settings-actions">
          <button type="button" className="ghost-button" onClick={onPersist} disabled={persistState === 'granted'}>
            <Icon name="shield" size={16} />
            {persistState === 'granted' ? 'Storage protected' : 'Protect storage'}
          </button>
          <button type="button" className="ghost-button is-danger" onClick={onClearAll}>
            <Icon name="trash" size={16} />
            Clear all clips
          </button>
        </div>
        <p className="group-note">
          <Icon name="info" size={15} /> Browsers can clear site data at any time. Protect storage to ask for a persistent grant; keeping clips downloaded is the safest backup.
        </p>
      </section>

      <section className="card settings-group">
        <h2 className="group-title">
          <Icon name="info" size={18} /> About ViralYantra AI
        </h2>
        <dl className="about-list">
          <div>
            <dt>Version</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div>
            <dt>Frontend</dt>
            <dd>React + Vite + TypeScript (PWA)</dd>
          </div>
          <div>
            <dt>Demo engine</dt>
            <dd>Canvas + MediaRecorder, runs fully on-device</dd>
          </div>
          <div>
            <dt>AI engine</dt>
            <dd>Optional Python FastAPI + open-source model</dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>₹0 — free and open-source only</dd>
          </div>
        </dl>
        <button type="button" className="ghost-button" onClick={onOpenDocs}>
          <Icon name="external" size={16} />
          Read the setup & model guide
        </button>
        <button type="button" className="ghost-button" onClick={onGoHome}>
          <Icon name="home" size={16} />
          Back to studio
        </button>
        <p className="about-note">
          ViralYantra AI is a working prototype. Real AI video generation only happens once you connect and run an open-source model on your own machine or server. Until then, every output you see is a clearly labelled local demo render.
        </p>
      </section>
    </div>
  )
}
