import { hashRouting } from '../lib/config'

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

/** An href for an in-page section that doesn't fight hash routing (`#/home` is the route itself there). */
export function sectionHref(id: string): string {
  return hashRouting() ? '#/home' : `#${id}`
}
