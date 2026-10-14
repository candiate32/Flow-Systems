import { hashRouting } from '../lib/config'

export const V2_PATH = '/v2'

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Smooth-scrolls to a section and moves focus there for keyboard and screen
 * reader users. Sections carry scroll-margin, so the sticky nav never covers
 * their heading.
 */
export function scrollToSection(id: string): void {
  const el = document.getElementById(id)
  if (!el) return
  el.scrollIntoView?.({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' })
  el.focus({ preventScroll: true })
}

/** An href for an in-page section that doesn't fight hash routing (`#/v2` is the route itself there). */
export function sectionHref(id: string): string {
  return hashRouting() ? `#${V2_PATH}` : `#${id}`
}

const FONTS_HREF =
  'https://fonts.googleapis.com/css2?family=Geist:wght@400..700&family=Geist+Mono:wght@400..600&display=swap'

/** Adds the page's web fonts once; the system stack shows until they arrive. */
export function loadV2Fonts(): void {
  if (document.querySelector(`link[href="${FONTS_HREF}"]`)) return
  for (const origin of ['https://fonts.googleapis.com', 'https://fonts.gstatic.com']) {
    if (document.querySelector(`link[rel="preconnect"][href="${origin}"]`)) continue
    const pre = document.createElement('link')
    pre.rel = 'preconnect'
    pre.href = origin
    if (origin.includes('gstatic')) pre.crossOrigin = ''
    document.head.appendChild(pre)
  }
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = FONTS_HREF
  document.head.appendChild(link)
}
