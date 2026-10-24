interface LogoProps {
  size?: number
  withWordmark?: boolean
}

export function Logo({ size = 34, withWordmark = true }: LogoProps) {
  return (
    <span className="logo">
      <svg width={size} height={size} viewBox="0 0 512 512" role="img" aria-label="ViralYantra AI logo">
        <defs>
          <linearGradient id="vy-logo-g" x1="60" y1="40" x2="452" y2="472" gradientUnits="userSpaceOnUse">
            <stop stopColor="#8B5CF6" />
            <stop offset="0.55" stopColor="#C026D3" />
            <stop offset="1" stopColor="#FB923C" />
          </linearGradient>
        </defs>
        <rect x="16" y="16" width="480" height="480" rx="132" fill="url(#vy-logo-g)" />
        <g stroke="#ffffff" strokeOpacity="0.22" strokeWidth="10" fill="none">
          <circle cx="256" cy="256" r="150" />
          <circle cx="256" cy="256" r="112" />
        </g>
        <path d="M218 190.5c0-14.3 15.5-23.2 27.9-16.1l82.5 47.6c12.4 7.2 12.4 25.1 0 32.3l-82.5 47.6c-12.4 7.1-27.9-1.8-27.9-16.1v-95.3Z" fill="#150B2E" stroke="#ffffff" strokeOpacity="0.85" strokeWidth="8" />
      </svg>
      {withWordmark && (
        <span className="logo-word">
          ViralYantra<span className="logo-word-accent"> AI</span>
        </span>
      )}
    </span>
  )
}
