import type { SVGProps } from 'react'

export type IconName =
  | 'home'
  | 'videos'
  | 'settings'
  | 'sparkles'
  | 'text'
  | 'image'
  | 'download'
  | 'share'
  | 'play'
  | 'trash'
  | 'close'
  | 'check'
  | 'alert'
  | 'chevron'
  | 'chevronDown'
  | 'plus'
  | 'info'
  | 'link'
  | 'refresh'
  | 'globe'
  | 'film'
  | 'wand'
  | 'clock'
  | 'shield'
  | 'rocket'
  | 'cpu'
  | 'wifiOff'
  | 'lock'
  | 'external'
  | 'copy'
  | 'star'
  | 'video'
  | 'portrait'
  | 'landscape'
  | 'square'
  | 'upload'
  | 'stop'

const PATHS: Record<IconName, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5.5 9.6V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V9.6'],
  videos: ['M3.5 5.5h17a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-17a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1Z', 'M7.5 5.5v13M16.5 5.5v13M2.5 9.5h5M2.5 14.5h5M16.5 9.5h5M16.5 14.5h5'],
  settings: [
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
    'M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.05A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.05A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6h.05A1.7 1.7 0 0 0 10 3.05V3a2 2 0 1 1 4 0v.05a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.05a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.05a1.7 1.7 0 0 0-1.55 1Z'
  ],
  sparkles: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z', 'M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z'],
  text: ['M4 6h16', 'M4 12h12', 'M4 18h8'],
  image: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'M8.5 11a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z', 'm3.5 17 5-5 4 4 3-3 5 5'],
  download: ['M12 3v12', 'm8 11 4 4 4-4', 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2'],
  share: ['M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7', 'M12 15V4', 'm8 8 4-4 4 4'],
  play: ['M8 5.3v13.4a1 1 0 0 0 1.53.85l10.5-6.7a1 1 0 0 0 0-1.7L9.53 4.45A1 1 0 0 0 8 5.3Z'],
  trash: ['M4 7h16', 'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2', 'M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13', 'M10 11v6M14 11v6'],
  close: ['M6 6l12 12', 'M18 6 6 18'],
  check: ['m5 12.5 4.5 4.5L19 7'],
  alert: ['M12 9v4m0 4h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z'],
  chevron: ['m9 5 7 7-7 7'],
  chevronDown: ['m6 9 6 6 6-6'],
  plus: ['M12 5v14M5 12h14'],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5', 'M12 8h.01'],
  link: ['M9.5 14.5 14.5 9.5', 'M10.5 7.5 12 6a4 4 0 1 1 6 6l-1.5 1.5', 'M13.5 16.5 12 18a4 4 0 1 1-6-6l1.5-1.5'],
  refresh: ['M20 12a8 8 0 1 1-2.34-5.66', 'M20 4v5h-5'],
  globe: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M3 12h18', 'M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z'],
  film: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z', 'M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4'],
  wand: ['M5 20 3.5 18.5 15 7l2 2L5 20Z', 'M14.5 4.5 16 3l5 5-1.5 1.5', 'M17 9l2-2'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7.5V12l3 2'],
  shield: ['M12 3l7 3v5.5c0 4.4-3 8-7 9.5-4-1.5-7-5.1-7-9.5V6l7-3Z', 'm9 12 2 2 4-4'],
  rocket: ['M12 3c2.5 1 5 3.6 6 6-1.6 4.2-5.4 7.6-8.5 9L7 15.5C8.4 12.4 11 8.5 12 3Z', 'M7 15.5 5.5 17 4 21l4-1.5L9.5 18', 'M14.5 9.5h.01'],
  cpu: ['M7 8h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z', 'M9 4v3M15 4v3M9 17v3M15 17v3M4 9h3M4 15h3M17 9h3M17 15h3'],
  wifiOff: ['M2 3l19 19', 'M8.5 16.4a5 5 0 0 1 7 0', 'M5 12.9a10 10 0 0 1 3-1.9', 'M16 11a10 10 0 0 1 3 1.9', 'M12 20h.01'],
  lock: ['M6 11h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z', 'M8 11V8a4 4 0 0 1 8 0v3'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  copy: ['M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z', 'M5 15V5a1 1 0 0 1 1-1h10'],
  star: ['M12 3l2.7 5.8L21 10l-4.5 4.2L17.5 21 12 17.8 6.5 21l1-6.8L3 10l6.3-1.2L12 3Z'],
  video: ['M15 8.5 21 5v14l-6-3.5', 'M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z'],
  portrait: ['M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z'],
  landscape: ['M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z'],
  square: ['M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z'],
  upload: ['M12 20V8', 'm8 11 4-4 4 4', 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2'],
  stop: ['M6 6h12v12H6z']
}

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  filled?: boolean
}

export function Icon({ name, size = 22, filled = false, ...rest }: IconProps) {
  const paths = PATHS[name]
  const filledIcons = name === 'play' || name === 'star'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled || filledIcons ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled || filledIcons ? 0 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}
