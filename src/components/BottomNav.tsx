import { Icon, type IconName } from './Icon'

export type PageId = 'home' | 'videos' | 'settings'

const ITEMS: { id: PageId; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'videos', label: 'My Videos', icon: 'videos' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
]

interface BottomNavProps {
  page: PageId
  onChange: (page: PageId) => void
  videosCount: number
}

export function BottomNav({ page, onChange, videosCount }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      <div className="bottom-nav-inner">
        {ITEMS.map((item) => {
          const active = page === item.id
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => onChange(item.id)}
            >
              <span className="nav-icon">
                <Icon name={item.icon} size={22} />
                {item.id === 'videos' && videosCount > 0 && <span className="nav-badge">{videosCount > 99 ? '99+' : videosCount}</span>}
              </span>
              <span className="nav-label">{item.label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
