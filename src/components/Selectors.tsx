import type { CSSProperties } from 'react'
import { Icon, type IconName } from './Icon'
import type { AspectRatio, Quality, StyleId } from '../types'
import { ASPECTS, DURATIONS, QUALITIES, STYLES } from '../lib/presets'

const ASPECT_ICON: Record<string, IconName> = { '9:16': 'portrait', '16:9': 'landscape', '1:1': 'square' }

interface AspectSelectorProps {
  value: AspectRatio
  onChange: (value: AspectRatio) => void
}

export function AspectSelector({ value, onChange }: AspectSelectorProps) {
  return (
    <div className="ratio-grid" role="radiogroup" aria-label="Aspect ratio">
      {ASPECTS.map((aspect) => {
        const active = aspect.id === value
        return (
          <button
            key={aspect.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`ratio-option${active ? ' is-active' : ''}`}
            onClick={() => onChange(aspect.id)}
          >
            <span className="ratio-shape" aria-hidden="true">
              <Icon name={ASPECT_ICON[aspect.id]} size={26} />
            </span>
            <span className="ratio-label">{aspect.label}</span>
            <span className="ratio-hint">{aspect.id} · {aspect.hint}</span>
          </button>
        )
      })}
    </div>
  )
}

interface StylePickerProps {
  value: StyleId
  onChange: (value: StyleId) => void
}

export function StylePicker({ value, onChange }: StylePickerProps) {
  return (
    <div className="style-scroller" role="radiogroup" aria-label="Style preset">
      {STYLES.map((style) => {
        const active = style.id === value
        return (
          <button
            key={style.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`style-card${active ? ' is-active' : ''}`}
            onClick={() => onChange(style.id)}
            style={{ '--s1': style.colors[0], '--s2': style.colors[1], '--s3': style.colors[2] } as CSSProperties}
          >
            <span className="style-preview" aria-hidden="true">
              <span className="style-preview-emoji">{style.emoji}</span>
            </span>
            <span className="style-name">{style.label}</span>
            <span className="style-blurb">{style.blurb}</span>
            {active && (
              <span className="style-check">
                <Icon name="check" size={13} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

interface DurationChipsProps {
  value: number
  onChange: (value: number) => void
  max?: number
}

export function DurationChips({ value, onChange, max }: DurationChipsProps) {
  return (
    <div className="chip-row" role="radiogroup" aria-label="Duration in seconds">
      {DURATIONS.map((duration) => {
        const disabled = max !== undefined && duration > max
        const active = duration === value
        return (
          <button
            key={duration}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            className={`chip${active ? ' is-active' : ''}`}
            onClick={() => onChange(duration)}
            title={disabled ? `This engine supports up to ${max}s` : undefined}
          >
            {duration}s
          </button>
        )
      })}
    </div>
  )
}

interface QualityPickerProps {
  value: Quality
  onChange: (value: Quality) => void
  compact?: boolean
}

export function QualityPicker({ value, onChange, compact = false }: QualityPickerProps) {
  return (
    <div className={`quality-grid${compact ? ' is-compact' : ''}`} role="radiogroup" aria-label="Output quality">
      {QUALITIES.map((quality) => {
        const active = quality.id === value
        return (
          <button
            key={quality.id}
            type="button"
            role="radio"
            aria-checked={active}
            className={`quality-option${active ? ' is-active' : ''}`}
            onClick={() => onChange(quality.id)}
          >
            <span className="quality-label">{quality.label}</span>
            {!compact && <span className="quality-hint">{quality.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
