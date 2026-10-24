import type { VideoRecord } from '../types'
import { Icon } from './Icon'
import { formatBytes, timeAgo } from '../lib/share'

interface VideoCardProps {
  record: VideoRecord
  onOpen: () => void
  onDownload: () => void
  onShare: () => void
  onDelete: () => void
  compact?: boolean
}

export function VideoCard({ record, onOpen, onDownload, onShare, onDelete, compact = false }: VideoCardProps) {
  const isAi = record.isAiGenerated
  return (
    <article className={`video-card${compact ? ' is-compact' : ''}`}>
      <button type="button" className={`video-thumb ratio-${record.aspect.replace(':', '-')}`} onClick={onOpen} aria-label={`Open ${record.title}`}>
        {record.thumbnail ? (
          <img src={record.thumbnail} alt="" loading="lazy" />
        ) : (
          <span className="video-thumb-fallback" aria-hidden="true">
            <Icon name="film" size={26} />
          </span>
        )}
        <span className="video-thumb-play">
          <Icon name="play" size={20} filled />
        </span>
        <span className={`source-dot ${isAi ? 'is-ai' : 'is-demo'}`} title={isAi ? 'AI generated' : 'Demo clip, not AI generated'} />
        <span className="video-thumb-duration">{record.duration}s</span>
      </button>
      <div className="video-card-body">
        <h3 className="video-card-title" title={record.title}>{record.title}</h3>
        <p className="video-card-meta">
          {record.engineLabel} · {record.aspect} · {timeAgo(record.createdAt)}
        </p>
        {!compact && (
          <p className="video-card-size">
            {record.width}×{record.height} · {formatBytes(record.sizeBytes)}
          </p>
        )}
        <div className="video-card-actions">
          <button type="button" onClick={onOpen} title="Play">
            <Icon name="play" size={16} />
            <span>Play</span>
          </button>
          <button type="button" onClick={onDownload} title="Download">
            <Icon name="download" size={16} />
          </button>
          <button type="button" onClick={onShare} title="Share">
            <Icon name="share" size={16} />
          </button>
          <button type="button" className="is-danger" onClick={onDelete} title="Delete">
            <Icon name="trash" size={16} />
          </button>
        </div>
      </div>
    </article>
  )
}
