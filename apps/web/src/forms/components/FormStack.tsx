import { useState } from 'react'
import type { FormConfig } from '../types'
import { FormRenderer } from './FormRenderer'

type Props = {
  configs: readonly FormConfig[]
  active: string
  /** Passed to each form: page-level headings and a root that fills a flex column. */
  fullPage?: boolean
}

/**
 * One form shown at a time from a set. Each form stays mounted, hidden, once it
 * has been shown, so switching away and back keeps what the person typed.
 * Forms mount on first view, so nothing loads for a form nobody opens.
 */
export function FormStack({ configs, active, fullPage = false }: Props) {
  const [opened, setOpened] = useState<string[]>([active])
  // Record a newly shown form during render (React's "adjust state on prop change" pattern).
  if (!opened.includes(active)) setOpened([...opened, active])

  return (
    <>
      {configs
        .filter((c) => c.slug === active || opened.includes(c.slug))
        .map((c) => (
          <div
            key={c.slug}
            hidden={c.slug !== active}
            data-form-slug={c.slug}
            className={`motion-safe:animate-[ff-enter_240ms_ease-out] ${fullPage ? 'flex flex-1 flex-col' : ''}`}
          >
            <FormRenderer config={c} fullPage={fullPage} />
          </div>
        ))}
    </>
  )
}
