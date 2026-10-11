import type { ReactNode } from 'react'
import type { FormConfig } from '../types'
import { displayClass } from './ui'

type LayoutProps = {
  config: FormConfig
  /** The form, or its success state. */
  children: ReactNode
  /** Privacy text, already resolved from the config. */
  privacy: string
  /** Inside another page (the gallery): headings drop a level. */
  nested?: boolean
}

function DemoBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-current px-2.5 py-0.5 text-[0.6875rem] font-bold tracking-[0.12em] uppercase">
      Demo
    </span>
  )
}

function StudioBar({ config }: { config: FormConfig }) {
  const { studio } = config
  return (
    <div className="flex items-center justify-between gap-3">
      <p className={`${displayClass} text-xl leading-none`}>
        {studio.logoText ?? studio.name}
        <span className="sr-only">, {studio.area}</span>
      </p>
      {studio.isDemo && <DemoBadge />}
    </div>
  )
}

function Footer({ config, privacy, nested }: { config: FormConfig; privacy: string; nested?: boolean }) {
  const H = nested ? 'h3' : 'h2'
  return (
    <footer className="mt-8 space-y-3 text-xs leading-relaxed text-[var(--ff-muted)]">
      <section aria-labelledby={`${config.slug}-privacy`}>
        <H id={`${config.slug}-privacy`} className="font-semibold text-[var(--ff-text)]">
          Privacy
        </H>
        <p className="mt-1">{privacy}</p>
      </section>
      {config.studio.isDemo && (
        <p>
          {config.studio.name}, {config.studio.area} is a demonstration studio run by Flow Systems, not a real business.
        </p>
      )}
    </footer>
  )
}

const heroPattern = '[background-image:var(--ff-pattern)] [background-size:var(--ff-pattern-size)]'

/** Form card over a patterned hero. */
function CardLayout({ config, children, privacy, nested }: LayoutProps) {
  const H = nested ? 'h2' : 'h1'
  return (
    <>
      <section className={`bg-[var(--ff-hero-bg)] text-[var(--ff-hero-text)] ${heroPattern}`}>
        <div className="mx-auto max-w-xl px-4 pt-6 pb-28 @2xl:px-6 @2xl:pt-10 @2xl:pb-32">
          <StudioBar config={config} />
          <p className="mt-10 text-xs font-semibold tracking-[0.16em] text-[var(--ff-hero-muted)] uppercase @2xl:mt-14">
            {config.studio.area}, Bangalore
          </p>
          <H className={`${displayClass} mt-3 text-[calc(2.25rem*var(--ff-display-scale))] leading-[1.05] text-balance @2xl:text-[calc(3rem*var(--ff-display-scale))]`}>
            {config.copy.headline}
          </H>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-pretty text-[var(--ff-hero-muted)] @2xl:text-lg">{config.copy.intro}</p>
        </div>
      </section>
      <div className="relative mx-auto -mt-20 max-w-xl px-4 pb-12 @2xl:px-6 @2xl:pb-16">
        <div className="rounded-[calc(var(--ff-radius)*1.5)] border border-[var(--ff-border)] bg-[var(--ff-surface)] p-5 shadow-[0_30px_60px_-35px_rgb(0_0_0/0.45)] @md:p-8">
          {children}
        </div>
        <Footer config={config} privacy={privacy} nested={nested} />
      </div>
    </>
  )
}

const PROMISES = [
  'A reply on WhatsApp in under a minute',
  'Only about your enquiry, never broadcasts',
  'Your details are stored in India',
]

/**
 * Copy on the left, form on the right when there is room; stacked, at the
 * card layout's width, below that. The studio bar spans both columns, and the
 * copy column stays in view while the longer form scrolls past it.
 */
function SplitLayout({ config, children, privacy, nested }: LayoutProps) {
  const H = nested ? 'h2' : 'h1'
  return (
    <div className="mx-auto max-w-xl px-4 pt-6 pb-12 @2xl:px-6 @4xl:max-w-6xl @4xl:px-8 @4xl:pt-10 @4xl:pb-16">
      <StudioBar config={config} />
      <div className="mt-10 grid gap-8 @4xl:mt-12 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,29rem)] @4xl:gap-16">
        <div className="@4xl:sticky @4xl:top-[var(--ff-sticky-top,2.5rem)] @4xl:self-start @4xl:pt-8">
          <p className="text-xs font-semibold tracking-[0.16em] text-[var(--ff-muted)] uppercase">{config.studio.area}, Bangalore</p>
          <H className={`${displayClass} mt-3 text-[calc(2.25rem*var(--ff-display-scale))] leading-[1.02] text-balance @4xl:text-[calc(3.5rem*var(--ff-display-scale))]`}>
            {config.copy.headline}
          </H>
          <p className="mt-4 max-w-md text-base leading-relaxed text-pretty text-[var(--ff-muted)] @4xl:text-lg">{config.copy.intro}</p>
          <ul className="mt-8 hidden space-y-3 @4xl:block">
            {PROMISES.map((p) => (
              <li key={p} className="flex items-center gap-3">
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--ff-accent)] text-[var(--ff-accent-text)]">
                  <svg viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-2">
                    <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                {p}
              </li>
            ))}
          </ul>
          <div
            aria-hidden="true"
            className={`mt-10 hidden h-40 rounded-[calc(var(--ff-radius)*1.5)] bg-[var(--ff-hero-bg)] @4xl:block ${heroPattern}`}
          />
        </div>
        <div>
          <div className="rounded-[calc(var(--ff-radius)*1.5)] border border-[var(--ff-border)] bg-[var(--ff-surface)] p-5 shadow-[0_30px_60px_-40px_rgb(0_0_0/0.4)] @md:p-8">
            {children}
          </div>
          <Footer config={config} privacy={privacy} nested={nested} />
        </div>
      </div>
    </div>
  )
}

/** Just the form, for embedding on a studio's own site. */
function MinimalLayout({ config, children, privacy, nested }: LayoutProps) {
  const H = nested ? 'h2' : 'h1'
  return (
    <div className="mx-auto max-w-lg px-4 pt-6 pb-12 @lg:pt-10 @lg:pb-16">
      <StudioBar config={config} />
      <div className="mt-6 h-px bg-[var(--ff-border)]" />
      <H className={`${displayClass} mt-6 text-[calc(1.875rem*var(--ff-display-scale))] leading-tight text-balance`}>
        {config.copy.headline}
      </H>
      <p className="mt-4 leading-relaxed text-pretty text-[var(--ff-muted)]">{config.copy.intro}</p>
      <div className="mt-8">{children}</div>
      <Footer config={config} privacy={privacy} nested={nested} />
    </div>
  )
}

export function FormLayout(props: LayoutProps) {
  switch (props.config.layout) {
    case 'split':
      return <SplitLayout {...props} />
    case 'minimal':
      return <MinimalLayout {...props} />
    default:
      return <CardLayout {...props} />
  }
}
