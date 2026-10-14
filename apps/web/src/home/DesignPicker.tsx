import { useId, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent } from 'react'
import { FormStack } from '../forms/components/FormStack'
import { FORM_CONFIGS } from '../forms/configs'
import { resolveTheme } from '../forms/themes'
import type { FormConfig } from '../forms/types'
import { focus, materialThick } from './hig'
import { prefersReducedMotion } from './motion'

const LAYOUT_NAMES: Record<FormConfig['layout'], string> = { split: 'Split', card: 'Card', minimal: 'Minimal' }

/** A tile in the form's own colours and material, so each design is recognisable at a glance. */
function DesignThumb({ config }: { config: FormConfig }) {
  const t = resolveTheme(config.theme)
  const base = t.hero === 'accent' ? t.accent : t.surface
  const style: CSSProperties = {
    backgroundColor: base,
    backgroundImage: t.pattern,
    backgroundSize: t.patternSize,
    boxShadow: `inset 0 0 0 1px rgb(0 0 0 / 0.08), inset -9px -9px 0 -5px ${t.hero === 'accent' ? t.bg : t.accent}`,
  }
  return <span aria-hidden="true" style={style} className="block size-6 shrink-0 rounded-[8px] sm:size-8 sm:rounded-[10px]" />
}

function Arrow({ direction }: { direction: 'prev' | 'next' }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-[2.25]">
      <path d={direction === 'prev' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Top of a focused field, counting its label: the field's own <label>, or the
 * label of the group it sits in (chips, the month picker). Labels far above,
 * like a form's heading, don't count.
 */
function fieldTop(el: HTMLElement, panel: HTMLElement) {
  const own = el.getBoundingClientRect().top
  const groupLabel = el.closest('[aria-labelledby]')?.getAttribute('aria-labelledby')?.split(' ') ?? []
  const labels = [...((el as HTMLInputElement).labels ?? []), ...groupLabel.map((id) => document.getElementById(id))]
  return labels.reduce((top, label) => {
    if (!label || !panel.contains(label)) return top
    const t = label.getBoundingClientRect().top
    return t < top && own - t < 280 ? t : top
  }, own)
}

const roundButton = [
  'flex size-11 shrink-0 items-center justify-center rounded-full text-hig-ink',
  'transition-[background-color,scale] hover:bg-black/[0.05] active:scale-95',
  focus,
].join(' ')

/**
 * The sample forms behind one prominent design picker: a segmented control
 * (WAI-ARIA tabs: arrow keys, Home and End move and select) with previous and
 * next buttons, pinned under the nav while the form scrolls past. Forms are
 * live, and each keeps what was typed while you look at the others.
 */
export function DesignPicker() {
  const uid = useId()
  const [active, setActive] = useState(FORM_CONFIGS[0].slug)
  const tabs = useRef<(HTMLButtonElement | null)[]>([])
  const bar = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const count = FORM_CONFIGS.length
  const index = FORM_CONFIGS.findIndex((c) => c.slug === active)
  const config = FORM_CONFIGS[index]
  const prev = FORM_CONFIGS[(index - 1 + count) % count]
  const next = FORM_CONFIGS[(index + 1) % count]

  function select(i: number, focusTab: boolean) {
    const to = (i + count) % count
    setActive(FORM_CONFIGS[to].slug)
    if (focusTab) tabs.current[to]?.focus()
    // Switching while deep in a long form starts the new one from its top, just below the pinned picker.
    const top = frame.current?.getBoundingClientRect().top ?? 0
    const pinnedBottom = bar.current?.getBoundingClientRect().bottom ?? 0
    if (top < 0) window.scrollBy?.({ top: top - pinnedBottom - 12, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  // Browsers don't scroll to a field that's already on screen, even when it sits under the
  // pinned picker (Shift+Tab back up the form, say), so nudge it and its label clear.
  function onFrameFocus(e: FocusEvent<HTMLDivElement>) {
    const target = e.target
    requestAnimationFrame(() => {
      const panel = frame.current
      const pinned = bar.current?.getBoundingClientRect()
      if (!panel || !pinned || document.activeElement !== target) return
      const top = fieldTop(target, panel)
      const clear = pinned.bottom + 12
      if (top < clear) window.scrollBy({ top: top - clear })
    })
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
      <div className="pointer-events-none sticky top-[3.25rem] z-30 py-2">
        <div
          ref={bar}
          className={`pointer-events-auto mx-auto flex w-full max-w-full items-center gap-1 sm:w-fit rounded-full border border-black/[0.06] p-1 shadow-[0_12px_32px_-14px_rgb(0_0_0/0.3)] sm:gap-1.5 sm:p-1.5 ${materialThick}`}
        >
          <button type="button" onClick={() => select(index - 1, false)} aria-label={`Previous form: ${prev.studio.name}`} className={roundButton}>
            <Arrow direction="prev" />
          </button>
          <div role="tablist" aria-label="Sample studio forms" className="relative grid min-w-0 flex-1 grid-cols-3 rounded-full bg-[rgb(118_118_128/0.12)] p-1">
            {/* The selection slides between segments, like iOS's segmented control. */}
            <span
              aria-hidden="true"
              style={{ transform: `translateX(${index * 100}%)` }}
              className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.12),0_3px_1px_rgb(0_0_0/0.04)] transition-transform duration-500 ease-spring motion-reduce:transition-none"
            />
            {FORM_CONFIGS.map((c, i) => {
              const selected = c.slug === active
              const theme = resolveTheme(c.theme)
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
                  className={`relative z-10 flex min-h-11 min-w-0 flex-col items-center justify-center gap-1 rounded-full px-2 py-1 sm:py-2 md:flex-row md:gap-2 md:py-1.5 md:pr-4 md:pl-2 ${focus}`}
                >
                  <DesignThumb config={c} />
                  <span className="min-w-0 text-center leading-tight md:text-left">
                    <span className={`block text-[0.8125rem] tracking-[-0.01em] text-balance text-hig-ink sm:text-[0.9375rem] ${selected ? 'font-semibold' : 'font-medium'}`}>
                      <span className="sm:hidden">{c.studio.name.split(' ')[0]}</span>
                      <span className="hidden sm:inline">{c.studio.name}</span>
                    </span>
                    <span className="hidden text-xs text-balance text-hig-ink/75 sm:block">
                      {theme.label} · {LAYOUT_NAMES[c.layout]} layout
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
          <button type="button" onClick={() => select(index + 1, false)} aria-label={`Next form: ${next.studio.name}`} className={roundButton}>
            <Arrow direction="next" />
          </button>
        </div>
      </div>

      <div
        ref={frame}
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${uid}-tab-${active}`}
        onFocus={onFrameFocus}
        // Fields the browser scrolls to on focus land below the nav and the pinned picker.
        className="mt-3 overflow-clip rounded-[1.25rem] border border-black/10 bg-white shadow-[0_40px_90px_-40px_rgb(0_0_0/0.35)] [&_:is(input,select,textarea,button,label)]:scroll-mt-40"
      >
        <div aria-hidden="true" className="flex h-11 items-center gap-3 border-b border-black/10 bg-[#F6F6F6] px-4">
          <span className="flex gap-2">
            <span className="size-3 rounded-full bg-[#FF5F57]" />
            <span className="size-3 rounded-full bg-[#FEBC2E]" />
            <span className="size-3 rounded-full bg-[#28C840]" />
          </span>
          <span className="mx-auto flex min-w-0 items-center gap-2 truncate rounded-md border border-black/[0.06] bg-white px-3 py-1 text-xs text-hig-ink-2">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: resolveTheme(config.theme).accent }} />
            {config.studio.name}
            <span className="-ml-1 hidden sm:inline">· enquiry form</span>
          </span>
          <span className="w-[3.25rem]" />
        </div>
        <FormStack configs={FORM_CONFIGS} active={active} />
      </div>
    </div>
  )
}
