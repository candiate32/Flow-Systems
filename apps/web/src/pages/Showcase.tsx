import { useEffect, useRef } from 'react'
import { Link, useNavigate, useSearchParams, type To } from 'react-router'
import { FormRenderer } from '../forms/components/FormRenderer'
import { FORM_CONFIGS, getFormConfig, HOME_FORM_SLUG } from '../forms/configs'
import { resolveTheme, SHARED_TYPE } from '../forms/themes'
import type { FormConfig } from '../forms/types'

/** The default form keeps a clean `/`; the others are `/?form=<slug>`, so every view can be shared. */
function showcaseLink(slug: string): To {
  return { pathname: '/', search: slug === HOME_FORM_SLUG ? '' : `?form=${slug}` }
}

const barFocus = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white'

function Swatch({ config }: { config: FormConfig }) {
  return (
    <span
      aria-hidden="true"
      className="size-2.5 shrink-0 rounded-full ring-1 ring-white/30"
      style={{ backgroundColor: resolveTheme(config.theme).accent }}
    />
  )
}

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

/** Arrow keys switch forms unless the person is using them inside a field or chip group. */
function isInFormControl(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('input, select, textarea, [contenteditable], [role="radio"]')
}

/**
 * `/`: every sample studio form on one page, one at a time, with arrows to
 * move between them. Forms here are live: they submit to the lead engine.
 */
export default function Showcase() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const config = getFormConfig(params.get('form') ?? '') ?? getFormConfig(HOME_FORM_SLUG) ?? FORM_CONFIGS[0]
  const count = FORM_CONFIGS.length
  const index = FORM_CONFIGS.indexOf(config)
  const prev = FORM_CONFIGS[(index - 1 + count) % count]
  const next = FORM_CONFIGS[(index + 1) % count]

  useEffect(() => {
    document.title = `${config.studio.name} · Sample forms by Flow Systems`
  }, [config])

  // A switch made while scrolled down starts the new form from its top.
  const shownSlug = useRef(config.slug)
  useEffect(() => {
    if (shownSlug.current === config.slug) return
    shownSlug.current = config.slug
    if (window.scrollY > 0) window.scrollTo({ top: 0 })
  }, [config.slug])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      if (isInFormControl(e.target)) return
      e.preventDefault()
      navigate(showcaseLink(e.key === 'ArrowLeft' ? prev.slug : next.slug), { replace: true })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, prev.slug, next.slug])

  return (
    <div className="flex min-h-dvh flex-col bg-stone-950" style={{ fontFamily: SHARED_TYPE.fontBody }}>
      <header className="border-b border-white/10 text-stone-100">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2 sm:px-6 lg:gap-6 lg:px-8">
          <div className="min-w-0 flex-1">
            <p className="hidden lg:block">
              <span className="block text-[0.9375rem] font-bold tracking-[-0.01em]" style={{ fontFamily: SHARED_TYPE.fontDisplay }}>
                Flow Systems
              </span>
              <span className="block text-xs text-stone-400">Sample enquiry forms, live on our lead engine</span>
            </p>
            <p className="text-[0.6875rem] leading-none font-semibold tracking-[0.16em] text-stone-400 uppercase lg:hidden">
              Flow Systems · Sample forms
            </p>
            <p className="mt-1.5 flex min-w-0 items-center gap-2 text-sm font-semibold lg:hidden">
              <Swatch config={config} />
              <span className="truncate">{config.studio.name}</span>
              <span className="shrink-0 font-normal text-stone-400 tabular-nums">
                {index + 1} of {count}
              </span>
            </p>
          </div>
          <nav aria-label="Sample forms" className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {FORM_CONFIGS.map((c) => {
                const current = c.slug === config.slug
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
                      <Swatch config={c} />
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
      {/* Keyed so each switch starts the form empty and fades it in. */}
      <div key={config.slug} className="flex flex-1 flex-col motion-safe:animate-[ff-enter_240ms_ease-out]">
        <FormRenderer config={config} fullPage />
      </div>
    </div>
  )
}
