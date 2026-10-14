import { useEffect, useRef, type RefObject } from 'react'
import { displayClass } from '../forms/components/ui'
import { ADD_ONS, COMING_SOON, STEPS } from './content'
import { prefersReducedMotion } from './motion'
import { Reveal } from './Reveal'

/**
 * Marks each step reached once it scrolls above 60% of the viewport, which
 * lights its number and draws the line on to the next step. Writes attributes
 * directly, so scrolling never re-renders React. With reduced motion every
 * step starts reached.
 */
function useStepsReached(list: RefObject<HTMLOListElement | null>) {
  useEffect(() => {
    const el = list.current
    if (!el) return
    const steps = Array.from(el.querySelectorAll<HTMLElement>('[data-step]'))
    if (prefersReducedMotion()) {
      for (const step of steps) step.setAttribute('data-reached', '')
      return
    }
    let frame = 0
    const update = () => {
      frame = 0
      const mark = window.innerHeight * 0.6
      for (const step of steps) step.toggleAttribute('data-reached', step.getBoundingClientRect().top + 18 < mark)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [list])
}

export function HowItWorks() {
  const list = useRef<HTMLOListElement>(null)
  useStepsReached(list)

  return (
    <section id="how" tabIndex={-1} aria-labelledby="how-title" className="scroll-mt-16 outline-none">
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Reveal>
            <p className="text-xs font-semibold tracking-[0.16em] text-[var(--ff-accent)] uppercase">How it works</p>
            <h2 id="how-title" className={`${displayClass} mt-3 text-[2.25rem] leading-[1.05] text-balance sm:text-5xl`}>
              One package. We run it for you.
            </h2>
            <p className="mt-5 max-w-md text-lg leading-relaxed text-pretty text-[var(--ff-muted)]">
              Four services that work together from the moment an enquiry lands. We set it up in about 7 days and run it,
              so there's nothing new for your team to learn: they keep using the same WhatsApp app.
            </p>
          </Reveal>
        </div>

        <ol ref={list} className="relative space-y-10 sm:space-y-12">
          {STEPS.map((step, i) => (
            <li key={step.title} data-step className="group relative pl-14">
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className="absolute top-11 -bottom-9 left-[1.0625rem] w-0.5 overflow-hidden rounded-full bg-[var(--ff-border)] sm:-bottom-11"
                >
                  <span className="block h-full origin-top scale-y-0 bg-[var(--ff-accent)] transition-transform duration-500 ease-out group-data-reached:scale-y-100 motion-reduce:transition-none" />
                </span>
              )}
              <span
                aria-hidden="true"
                className={[
                  'absolute top-0 left-0 flex size-9 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums',
                  'border-[var(--ff-border)] bg-[var(--ff-bg)] text-[var(--ff-muted)] transition-colors duration-300 motion-reduce:transition-none',
                  'group-data-reached:border-[var(--ff-accent)] group-data-reached:bg-[var(--ff-accent)] group-data-reached:text-[var(--ff-accent-text)]',
                ].join(' ')}
              >
                {i + 1}
              </span>
              <Reveal>
                <p className="pt-1.5 text-sm font-semibold text-[var(--ff-accent)]">{step.when}</p>
                <h3 className={`${displayClass} mt-1 text-2xl leading-tight`}>{step.title}</h3>
                <p className="mt-2 max-w-md leading-relaxed text-[var(--ff-muted)]">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>

      <div className="mx-auto max-w-6xl px-5 pb-20 sm:px-8 sm:pb-28">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3 border-t border-[var(--ff-border)] pt-10">
            <h3 className={`${displayClass} text-2xl leading-tight sm:text-[1.75rem]`}>Add when you need them</h3>
            <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--ff-muted)]">
              <span>Coming soon:</span>
              {COMING_SOON.map((item) => (
                <span key={item} className="rounded-full border border-dashed border-[var(--ff-field-border)] px-3 py-1">
                  {item}
                </span>
              ))}
            </p>
          </div>
        </Reveal>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ADD_ONS.map((item, i) => (
            <li key={item.title}>
              <Reveal delay={i * 80} className="h-full">
                <div className="h-full rounded-[calc(var(--ff-radius)*1.5)] border border-[var(--ff-border)] bg-[var(--ff-surface)] p-6 transition-[translate,box-shadow] duration-300 hover:shadow-[0_24px_40px_-28px_rgb(28_40_38/0.35)] motion-safe:hover:-translate-y-1">
                  <h4 className="font-semibold">{item.title}</h4>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed text-[var(--ff-muted)]">{item.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
