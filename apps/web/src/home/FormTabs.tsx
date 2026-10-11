import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { FormStack } from '../forms/components/FormStack'
import { Swatch } from '../forms/components/Swatch'
import { focusRing } from '../forms/components/ui'
import { FORM_CONFIGS } from '../forms/configs'

function Arrow({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-2">
      <path d={direction === 'prev' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const roundButton = [
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--ff-field-border)]',
  'bg-[var(--ff-surface)] text-[var(--ff-text)] transition-colors hover:border-[var(--ff-accent)] hover:text-[var(--ff-accent)]',
  focusRing,
].join(' ')

/**
 * The sample forms as tabs (WAI-ARIA tabs: arrow keys, Home and End move and
 * select) with previous/next buttons, inside a browser-style frame. Forms are
 * live, and each keeps what was typed while you look at the others.
 */
export function FormTabs() {
  const uid = useId()
  const [active, setActive] = useState(FORM_CONFIGS[0].slug)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const count = FORM_CONFIGS.length
  const index = FORM_CONFIGS.findIndex((c) => c.slug === active)
  const config = FORM_CONFIGS[index]
  const prev = FORM_CONFIGS[(index - 1 + count) % count]
  const next = FORM_CONFIGS[(index + 1) % count]

  function select(i: number, focus: boolean) {
    const to = (i + count) % count
    setActive(FORM_CONFIGS[to].slug)
    if (focus) tabs.current[to]?.focus()
  }

  function onTabKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const moves: Record<string, number> = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: count - 1 }
    if (!(e.key in moves)) return
    e.preventDefault()
    select(moves[e.key], true)
  }

  const panelId = `${uid}-panel`
  return (
    <div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div
          role="tablist"
          aria-label="Sample studio forms"
          className="flex min-w-0 flex-1 gap-1 rounded-full border border-[var(--ff-border)] bg-[var(--ff-surface)] p-1 sm:flex-none"
        >
          {FORM_CONFIGS.map((c, i) => {
            const selected = c.slug === active
            return (
              <button
                key={c.slug}
                ref={(el) => {
                  tabs.current[i] = el
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${c.slug}`}
                aria-selected={selected}
                aria-controls={panelId}
                aria-label={c.studio.name}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(i, false)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={[
                  'inline-flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-2 text-sm font-semibold whitespace-nowrap transition-colors sm:flex-none sm:px-4',
                  selected
                    ? 'bg-[var(--ff-accent)] text-[var(--ff-accent-text)]'
                    : 'text-[var(--ff-muted)] hover:bg-[var(--ff-bg)] hover:text-[var(--ff-text)]',
                  focusRing,
                ].join(' ')}
              >
                <Swatch config={c} className={`hidden sm:block ${selected ? 'ring-2 ring-[var(--ff-accent-text)]/70' : ''}`} />
                <span className="truncate sm:hidden">{c.studio.name.split(' ')[0]}</span>
                <span className="hidden sm:inline">{c.studio.name}</span>
              </button>
            )
          })}
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <button type="button" onClick={() => select(index - 1, false)} aria-label={`Previous form: ${prev.studio.name}`} className={roundButton}>
            <Arrow direction="prev" />
          </button>
          <button type="button" onClick={() => select(index + 1, false)} aria-label={`Next form: ${next.studio.name}`} className={roundButton}>
            <Arrow direction="next" />
          </button>
        </div>
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${uid}-tab-${active}`}
        className="mt-5 overflow-clip rounded-[1.75rem] border border-[var(--ff-border)] bg-[var(--ff-surface)] shadow-[0_40px_80px_-50px_rgb(28_40_38/0.5)]"
      >
        <div aria-hidden="true" className="flex items-center gap-3 border-b border-[var(--ff-border)] px-4 py-3">
          <span className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-[#E8A58F]" />
            <span className="size-2.5 rounded-full bg-[#E6C27A]" />
            <span className="size-2.5 rounded-full bg-[#9CC3B6]" />
          </span>
          <span className="mx-auto flex min-w-0 items-center gap-2 truncate rounded-full bg-[var(--ff-bg)] px-3 py-1 text-xs text-[var(--ff-muted)]">
            <Swatch config={config} className="size-2" />
            {config.studio.name} · enquiry form
          </span>
          <span className="w-[2.625rem]" />
        </div>
        <FormStack configs={FORM_CONFIGS} active={active} />
      </div>
    </div>
  )
}
