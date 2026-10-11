import type { CSSProperties } from 'react'
import type { FormConfig, ThemeOverrideKey, ThemePreset } from './types'

/**
 * A full token set for one preset. Components never read these directly: the
 * form root turns them into --ff-* CSS variables (themeStyle) and every class
 * refers to those, so several themes can sit on one page.
 */
export type ThemeTokens = {
  label: string
  description: string
  bg: string
  surface: string
  /** Input and unselected chip background. */
  field: string
  text: string
  /** Hints, placeholders and secondary copy. Must still pass 4.5:1. */
  muted: string
  /** Decorative card and divider lines. */
  border: string
  /** Input and chip outlines: at least 3:1 against field so the control edge is visible. */
  fieldBorder: string
  accent: string
  accentText: string
  error: string
  radius: string
  /** Which colour pair the card layout's hero uses. */
  hero: 'accent' | 'surface'
  fontDisplay: string
  fontBody: string
  displayWeight: number
  displayTracking: string
  /** Multiplier for headline size; serif display faces run small. */
  displayScale: number
  /** Google Fonts stylesheet, injected only when a form with this preset mounts. */
  fontHref: string
  /** Decorative background for the hero / copy panel, in the theme's own material. */
  pattern: string
  patternSize: string
  /** Native control chrome (select popups, scrollbars). */
  colorScheme: 'light' | 'dark'
}

export const THEMES: Record<ThemePreset, ThemeTokens> = {
  // Lime plaster, terracotta and an editorial serif: calm, gallery-like studios.
  atelier: {
    label: 'Atelier',
    description: 'Lime plaster, terracotta and a classic serif',
    bg: '#F3EDE4',
    surface: '#FFFCF7',
    field: '#FFFFFF',
    text: '#2B2521',
    muted: '#6A5D53',
    border: '#E2D8CA',
    fieldBorder: '#8C7D70',
    accent: '#9A4A2B',
    accentText: '#FFF8F1',
    error: '#A3261B',
    radius: '4px',
    hero: 'accent',
    fontDisplay: "'Cormorant Garamond', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
    fontBody: "'Manrope', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    displayWeight: 600,
    displayTracking: '-0.01em',
    displayScale: 1.15,
    fontHref:
      'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500;600;700&family=Manrope:wght@400;500;600;700&display=swap',
    // Fluted plaster: fine vertical reeding.
    pattern:
      'repeating-linear-gradient(90deg, rgb(255 248 241 / 0.09) 0 1px, transparent 1px 22px), radial-gradient(120% 90% at 85% 0%, rgb(255 248 241 / 0.12), transparent 60%)',
    patternSize: 'auto',
    colorScheme: 'light',
  },
  // Speckled terrazzo floor, deep verdigris green and a characterful grotesk.
  terrazzo: {
    label: 'Terrazzo',
    description: 'Speckled terrazzo, verdigris green and a modern grotesk',
    bg: '#EFEDE6',
    surface: '#FBFAF6',
    field: '#FFFFFF',
    text: '#1C2826',
    muted: '#55625F',
    border: '#DCD8CE',
    fieldBorder: '#7A8682',
    accent: '#1F5A50',
    accentText: '#F3F7F2',
    error: '#B42318',
    radius: '14px',
    hero: 'accent',
    fontDisplay: "'Bricolage Grotesque', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    fontBody: "'DM Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    displayWeight: 700,
    displayTracking: '-0.03em',
    displayScale: 1,
    fontHref:
      'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=DM+Sans:opsz,wght@9..40,400..700&display=swap',
    // Marble chips scattered on the green.
    pattern: [
      'radial-gradient(circle at 12% 18%, #E8A58F 0 3px, transparent 3.5px)',
      'radial-gradient(circle at 63% 30%, #E6C27A 0 2px, transparent 2.5px)',
      'radial-gradient(circle at 38% 72%, rgb(243 247 242 / 0.85) 0 2.5px, transparent 3px)',
      'radial-gradient(circle at 86% 78%, #9CC3B6 0 4px, transparent 4.5px)',
      'radial-gradient(circle at 27% 44%, #E8A58F 0 1.5px, transparent 2px)',
      'radial-gradient(circle at 74% 58%, rgb(243 247 242 / 0.6) 0 1.5px, transparent 2px)',
      'radial-gradient(circle at 52% 92%, #E6C27A 0 3px, transparent 3.5px)',
    ].join(', '),
    // A different tile per chip layer so the scatter never lines up into a grid.
    patternSize: '131px 131px, 97px 97px, 151px 151px, 113px 113px, 89px 89px, 127px 127px, 173px 173px',
    colorScheme: 'light',
  },
  // Dark teak, brass hardware and a warm soft serif: premium, after-dark.
  teak: {
    label: 'Teak',
    description: 'Dark teak, brass and a warm soft serif',
    bg: '#1B1511',
    surface: '#261D17',
    field: '#1F1813',
    text: '#F2E8DA',
    muted: '#BFAE9B',
    border: '#3E3128',
    fieldBorder: '#8A7663',
    accent: '#D4A056',
    accentText: '#1B1511',
    error: '#FF9B85',
    radius: '6px',
    hero: 'surface',
    fontDisplay: "'Fraunces', 'Iowan Old Style', Georgia, 'Times New Roman', serif",
    fontBody: "'Figtree', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
    displayWeight: 500,
    displayTracking: '-0.02em',
    displayScale: 1.05,
    fontHref:
      'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..700&family=Figtree:wght@400;500;600;700&display=swap',
    // Quarter-sawn grain with a brass glow.
    pattern:
      'repeating-linear-gradient(97deg, rgb(212 160 86 / 0.05) 0 2px, transparent 2px 11px), repeating-linear-gradient(93deg, rgb(0 0 0 / 0.18) 0 1px, transparent 1px 31px), radial-gradient(90% 70% at 100% 0%, rgb(212 160 86 / 0.16), transparent 65%)',
    patternSize: 'auto',
    colorScheme: 'dark',
  },
}

export const THEME_PRESETS = Object.keys(THEMES) as ThemePreset[]

/** The preset's tokens with the config's colour overrides applied. */
export function resolveTheme(theme: FormConfig['theme']): ThemeTokens {
  const base = THEMES[theme.preset]
  const overrides = theme.overrides ?? {}
  const out = { ...base }
  for (const key of Object.keys(overrides) as ThemeOverrideKey[]) {
    const value = overrides[key]
    if (value) out[key] = value
  }
  return out
}

/** The --ff-* variables set on a form's root element. */
export function themeStyle(t: ThemeTokens): CSSProperties {
  const heroBg = t.hero === 'accent' ? t.accent : t.surface
  const heroText = t.hero === 'accent' ? t.accentText : t.text
  const heroMuted = t.hero === 'accent' ? t.accentText : t.muted
  return {
    '--ff-bg': t.bg,
    '--ff-surface': t.surface,
    '--ff-field': t.field,
    '--ff-text': t.text,
    '--ff-muted': t.muted,
    '--ff-border': t.border,
    '--ff-field-border': t.fieldBorder,
    '--ff-accent': t.accent,
    '--ff-accent-text': t.accentText,
    '--ff-error': t.error,
    '--ff-radius': t.radius,
    '--ff-hero-bg': heroBg,
    '--ff-hero-text': heroText,
    '--ff-hero-muted': heroMuted,
    '--ff-font-display': t.fontDisplay,
    '--ff-font-body': t.fontBody,
    '--ff-display-weight': String(t.displayWeight),
    '--ff-display-tracking': t.displayTracking,
    '--ff-display-scale': String(t.displayScale),
    '--ff-pattern': t.pattern,
    '--ff-pattern-size': t.patternSize,
    colorScheme: t.colorScheme,
  } as CSSProperties
}

/** Adds the preset's Google Fonts stylesheet once. System fallbacks cover the wait. */
export function loadThemeFonts(href: string, doc: Document = document): void {
  const existing = Array.from(doc.head.querySelectorAll<HTMLLinkElement>('link[data-ff-font]'))
  if (existing.some((l) => l.getAttribute('href') === href)) return
  if (!doc.head.querySelector('link[data-ff-preconnect]')) {
    for (const origin of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
      const pre = doc.createElement('link')
      pre.rel = 'preconnect'
      pre.href = origin
      if (origin.includes('gstatic')) pre.crossOrigin = 'anonymous'
      pre.setAttribute('data-ff-preconnect', '')
      doc.head.appendChild(pre)
    }
  }
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.setAttribute('data-ff-font', '')
  doc.head.appendChild(link)
}
