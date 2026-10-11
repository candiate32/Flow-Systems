import { resolveTheme } from '../themes'
import type { FormConfig } from '../types'

/** A small dot in a form's accent colour, to tell the sample studios apart in switchers. */
export function Swatch({ config, className = '' }: { config: FormConfig; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`size-2.5 shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: resolveTheme(config.theme).accent }}
    />
  )
}
