import { useMemo, useState } from 'react'
import type { VideoRecord } from '../types'
import { Icon } from './Icon'
import { VideoCard } from './VideoCard'
import { formatBytes } from '../lib/share'

type Filter = 'all' | 'demo' | 'ai'

interface MyVideosPageProps {
  records: VideoRecord[]
  loading: boolean
  onOpen: (record: VideoRecord) => void
  onDelete: (record: VideoRecord) => void
  onDownload: (record: VideoRecord) => void
  onShare: (record: VideoRecord) => void
  onClearAll: () => void
  onGoHome: () => void
  usageLabel: string | null
}

export function MyVideosPage({ records, loading, onOpen, onDelete, onDownload, onShare, onClearAll, onGoHome, usageLabel }: MyVideosPageProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest')
  const [confirmClear, setConfirmClear] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = records.filter((record) => {
      if (filter === 'demo' && record.isAiGenerated) return false
      if (filter === 'ai' && !record.isAiGenerated) return false
      if (!q) return true
      return record.title.toLowerCase().includes(q) || record.prompt.toLowerCase().includes(q)
    })
    return list.sort((a, b) => (sort === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt))
  }, [records, query, filter, sort])

  const totalSize = useMemo(() => records.reduce((sum, r) => sum + (r.sizeBytes || 0), 0), [records])
  const demoCount = records.filter((r) => !r.isAiGenerated).length
  const aiCount = records.length - demoCount

  return (
    <div className="screen">
      <header className="page-head">
        <div>
          <h1>My Videos</h1>
          <p>
            {records.length === 0
              ? 'Clips you generate are saved on this device.'
              : `${records.length} clip${records.length === 1 ? '' : 's'} · ${formatBytes(totalSize)}${usageLabel ? ` · ${usageLabel}` : ''}`}
          </p>
        </div>
        {records.length > 0 && (
          <button type="button" className="icon-button" onClick={() => setConfirmClear(true)} title="Clear all clips" aria-label="Clear all clips">
            <Icon name="trash" size={19} />
          </button>
        )}
      </header>

      {records.length > 0 && (
        <div className="filters card">
          <div className="search-field">
            <Icon name="info" size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clips and prompts" aria-label="Search clips" />
            {query && (
              <button type="button" className="icon-button small" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
          <div className="filter-row">
            <div className="segmented" role="tablist" aria-label="Filter clips">
              <button type="button" className={filter === 'all' ? 'is-active' : ''} onClick={() => setFilter('all')}>
                All {records.length}
              </button>
              <button type="button" className={filter === 'demo' ? 'is-active' : ''} onClick={() => setFilter('demo')}>
                Demo {demoCount}
              </button>
              <button type="button" className={filter === 'ai' ? 'is-active' : ''} onClick={() => setFilter('ai')}>
                AI {aiCount}
              </button>
            </div>
            <button type="button" className="sort-button" onClick={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}>
              <Icon name="refresh" size={15} />
              {sort === 'newest' ? 'Newest' : 'Oldest'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="skeleton-grid">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-card">
              <span className="skeleton-thumb" />
              <span className="skeleton-line" />
              <span className="skeleton-line short" />
            </div>
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-art">
            <Icon name="film" size={38} />
          </span>
          <h2>No videos yet</h2>
          <p>Generate your first demo clip on the Home tab. Everything is stored locally, so nothing is uploaded anywhere.</p>
          <button type="button" className="generate-button" onClick={onGoHome}>
            <Icon name="wand" size={18} />
            Create a video
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-art">
            <Icon name="alert" size={34} />
          </span>
          <h2>No matches</h2>
          <p>Try a different search or filter.</p>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setQuery('')
              setFilter('all')
            }}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="video-grid">
          {filtered.map((record) => (
            <VideoCard
              key={record.id}
              record={record}
              onOpen={() => onOpen(record)}
              onDownload={() => onDownload(record)}
              onShare={() => onShare(record)}
              onDelete={() => onDelete(record)}
            />
          ))}
        </div>
      )}

      {confirmClear && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Confirm clear" onClick={() => setConfirmClear(false)}>
          <div className="confirm-sheet" onClick={(event) => event.stopPropagation()}>
            <span className="confirm-icon">
              <Icon name="trash" size={24} />
            </span>
            <h3>Delete all clips?</h3>
            <p>This removes every saved video and its local file from this device. It cannot be undone.</p>
            <div className="confirm-actions">
              <button type="button" className="ghost-button" onClick={() => setConfirmClear(false)}>
                Keep them
              </button>
              <button
                type="button"
                className="action-button is-danger"
                onClick={() => {
                  setConfirmClear(false)
                  onClearAll()
                }}
              >
                <Icon name="trash" size={18} />
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
