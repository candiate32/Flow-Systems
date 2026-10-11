import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams, type To } from 'react-router'
import { FormStack } from '../forms/components/FormStack'
import { Swatch } from '../forms/components/Swatch'
import { FORM_CONFIGS, getFormConfig, HOME_FORM_SLUG } from '../forms/configs'
import { SHARED_TYPE } from '../forms/themes'

/** The default form keeps a clean `/`; the others are `/?form=<slug>`, so every view can be shared. */
function showcaseLink(slug: string): To {
  return { pathname: '/', search: slug === HOME_FORM_SLUG ? '' : `?form=${slug}` }
}

const barFocus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

function ArrowLink({ to, label, direction }: { to: To; label: string; direction: 'prev' | 'next' }) {
  return (
    <Link
      to={to}
      replace
      aria-label={label}
      title={label}
      className={`inline-flex size-11 items-center justify-center rounded-full border border-white/15 text-stone-100 transition-colors hover:border-white/40 hover:bg-white/10 ${barFocus}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-2">
        <path
          d={direction === 'prev' ? 'M12.5 4.5 7 10l5.5 5.5' : 'M7.5 4.5 13 10l-5.5 5.5'}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  )
}

/** Arrow keys switch forms only from outside the form, so they never fight a field, chip or button. */
function isInForm(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('form, input, select, textarea, [contenteditable]')
}

/**
 * `/`: every sample studio form on one page, one at a time, with arrows to
 * move between them. Forms here are live: they submit to the lead engine.
 */
export default function Showcase() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const urlSlug = (getFormConfig(params.get('form') ?? '') ?? getFormConfig(HOME_FORM_SLUG) ?? FORM_CONFIGS[0]).slug

  // The shown form is state, so key presses compose (setActive(fn)) at any
  // speed; the URL follows it, and a link or edited URL leads it.
  const [active, setActive] = useState(urlSlug)
  const [lastUrlSlug, setLastUrlSlug] = useState(urlSlug)
  if (urlSlug !== lastUrlSlug) {
    setLastUrlSlug(urlSlug)
    setActive(urlSlug)
  }
  useEffect(() => {
    if (active !== urlSlug) navigate(showcaseLink(active), { replace: true })
  }, [active, urlSlug, navigate])

  const count = FORM_CONFIGS.length
  const index = FORM_CONFIGS.findIndex((c) => c.slug === active)
  const config = FORM_CONFIGS[index]
  const prev = FORM_CONFIGS[(index - 1 + count) % count]
  const next = FORM_CONFIGS[(index + 1) % count]

  useEffect(() => {
    document.title = `${config.studio.name} · Sample forms by Flow Systems`
  }, [config])

  // A switch made while scrolled down starts the new form from its top.
  const shownSlug = useRef(active)
  useEffect(() => {
    if (shownSlug.current === active) return
    shownSlug.current = active
    if (window.scrollY > 0) window.scrollTo({ top: 0 })
  }, [active])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (isInForm(e.target)) return
      e.preventDefault()
      const step = e.key === 'ArrowLeft' ? -1 : 1
      setActive((slug) => {
        const i = FORM_CONFIGS.findIndex((c) => c.slug === slug)
        return FORM_CONFIGS[(i + step + count) % count].slug
      })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [count])

  return (
    <div className="flex min-h-dvh flex-col bg-stone-950" style={{ fontFamily: SHARED_TYPE.fontBody }}>
      <header className="border-b border-white/10 text-stone-100">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6 lg:gap-6 lg:px-8">
          <div className="min-w-0 flex-1">
            <Link
              to="/home"
              className={`hidden min-h-11 flex-col justify-center rounded-md lg:inline-flex ${barFocus}`}
              aria-label="Flow Systems: what we do"
            >
              <span className="block text-[0.9375rem] font-bold tracking-[-0.01em]" style={{ fontFamily: SHARED_TYPE.fontDisplay }}>
                Flow Systems
              </span>
              <span className="block text-xs text-stone-400">Sample enquiry forms, live on our lead engine</span>
            </Link>
            <p className="text-[0.6875rem] leading-none font-semibold tracking-[0.16em] text-stone-400 uppercase lg:hidden">
              Flow Systems · Sample forms
            </p>
            <p className="mt-1.5 flex min-w-0 items-center gap-2 text-sm font-semibold lg:hidden">
              <Swatch config={config} className="ring-1 ring-white/30" />
              <span className="truncate">{config.studio.name}</span>
              <span className="shrink-0 font-normal text-stone-400 tabular-nums">
                {index + 1} of {count}
              </span>
            </p>
          </div>
          <nav aria-label="Sample forms" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {FORM_CONFIGS.map((c) => {
                const current = c.slug === active
                return (
                  <li key={c.slug}>
                    <Link
                      to={showcaseLink(c.slug)}
                      replace
                      aria-current={current ? 'page' : undefined}
                      className={[
                        'inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors',
                        current ? 'bg-white text-stone-950' : 'text-stone-300 hover:bg-white/10 hover:text-white',
                        barFocus,
                      ].join(' ')}
                    >
                      <Swatch config={c} className="ring-1 ring-white/30" />
                      {c.studio.name}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
          <div className="flex shrink-0 items-center gap-2">
            <ArrowLink to={showcaseLink(prev.slug)} label={`Previous form: ${prev.studio.name}`} direction="prev" />
            <ArrowLink to={showcaseLink(next.slug)} label={`Next form: ${next.studio.name}`} direction="next" />
          </div>
        </div>
        <p aria-live="polite" className="sr-only">
          Showing {config.studio.name}, form {index + 1} of {count}
        </p>
      </header>
      <FormStack configs={FORM_CONFIGS} active={active} fullPage />
    </div>
  )
}
