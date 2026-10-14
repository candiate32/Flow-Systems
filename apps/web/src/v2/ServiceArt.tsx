import type { ServiceArt as Art } from './content'

// Small line drawings, one per service, in the page's single ink colour. Decorative.

const common = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.25,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Voice() {
  const bars = [6, 14, 24, 34, 20, 40, 28, 16, 30, 44, 26, 12, 22, 34, 18, 8, 14, 6]
  return (
    <svg viewBox="0 0 200 64" {...common}>
      {bars.map((h, i) => (
        <line key={i} x1={10 + i * 10.5} x2={10 + i * 10.5} y1={32 - h / 2} y2={32 + h / 2} opacity={0.35 + (h / 44) * 0.65} />
      ))}
    </svg>
  )
}

function Marketing() {
  const pts = [
    [10, 52],
    [48, 40],
    [86, 44],
    [124, 24],
    [162, 28],
    [190, 10],
  ]
  return (
    <svg viewBox="0 0 200 64" {...common}>
      <line x1="10" y1="58" x2="190" y2="58" opacity="0.3" />
      <polyline points={pts.map((p) => p.join(',')).join(' ')} />
      {pts.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="3" fill="var(--v2-bg)" />
      ))}
    </svg>
  )
}

function Content() {
  return (
    <svg viewBox="0 0 200 64" {...common}>
      <rect x="40" y="6" width="120" height="52" rx="6" opacity="0.35" />
      <rect x="30" y="12" width="120" height="48" rx="6" fill="var(--v2-panel)" />
      <line x1="44" y1="26" x2="110" y2="26" />
      <line x1="44" y1="36" x2="136" y2="36" opacity="0.6" />
      <line x1="44" y1="46" x2="124" y2="46" opacity="0.6" />
    </svg>
  )
}

function Exhibition() {
  const cells = [0, 1, 3, 4, 5, 7, 8, 10, 12, 13, 14, 15]
  return (
    <svg viewBox="0 0 200 64" {...common}>
      <rect x="62" y="6" width="52" height="52" rx="6" />
      {cells.map((c) => (
        <rect key={c} x={70 + (c % 4) * 9.5} y={14 + Math.floor(c / 4) * 9.5} width="6" height="6" rx="1" fill="currentColor" stroke="none" opacity="0.8" />
      ))}
      <path d="M124 32h30m0 0-7-7m7 7-7 7" />
      <circle cx="170" cy="32" r="8" />
    </svg>
  )
}

function Workflow() {
  return (
    <svg viewBox="0 0 200 64" {...common}>
      <rect x="8" y="22" width="36" height="20" rx="5" />
      <rect x="82" y="6" width="36" height="20" rx="5" />
      <rect x="82" y="38" width="36" height="20" rx="5" opacity="0.5" />
      <rect x="156" y="22" width="36" height="20" rx="5" />
      <path d="M44 32c19 0 19-16 38-16M44 32c19 0 19 16 38 16M118 16c19 0 19 16 38 16M118 48c19 0 19-16 38-16" opacity="0.7" />
    </svg>
  )
}

function Apps() {
  return (
    <svg viewBox="0 0 200 64" {...common}>
      <rect x="40" y="6" width="96" height="52" rx="6" />
      <line x1="40" y1="16" x2="136" y2="16" opacity="0.5" />
      <rect x="50" y="24" width="30" height="24" rx="3" opacity="0.5" />
      <line x1="88" y1="28" x2="124" y2="28" opacity="0.5" />
      <line x1="88" y1="36" x2="116" y2="36" opacity="0.5" />
      <rect x="128" y="18" width="30" height="44" rx="6" fill="var(--v2-panel)" />
      <line x1="138" y1="56" x2="148" y2="56" />
    </svg>
  )
}

const ART: Record<Art, () => React.JSX.Element> = {
  voice: Voice,
  marketing: Marketing,
  content: Content,
  exhibition: Exhibition,
  workflow: Workflow,
  apps: Apps,
}

export function ServiceArt({ art, className = '' }: { art: Art; className?: string }) {
  const Drawing = ART[art]
  return (
    <div aria-hidden="true" className={className}>
      <Drawing />
    </div>
  )
}
