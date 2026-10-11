import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { displayClass } from '../forms/components/ui'

// Every beat is paused until the exchange is on screen (see HeroExchange).
const playState = '[animation-play-state:var(--hero-play,running)]'

/** Plays in once, `delay` ms after the exchange comes into view. Shown as is with reduced motion. */
function Beat({ delay, className = '', children }: { delay: number; className?: string; children: ReactNode }) {
  const style: CSSProperties = { animationDelay: `${delay}ms` }
  return (
    <div style={style} className={`motion-safe:animate-[hero-in_640ms_cubic-bezier(0.22,1,0.36,1)_both] ${playState} ${className}`}>
      {children}
    </div>
  )
}

function Bubble({ from, time, children }: { from: 'studio' | 'homeowner'; time: string; children: ReactNode }) {
  const studio = from === 'studio'
  return (
    <div className={`flex ${studio ? 'justify-start' : 'justify-end'}`}>
      <p
        className={[
          'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[0.9375rem] leading-snug shadow-[0_1px_1px_rgb(0_0_0/0.06)]',
          studio
            ? 'rounded-tl-md bg-[var(--ff-surface)] text-[var(--ff-text)]'
            : 'rounded-tr-md bg-[color-mix(in_srgb,var(--ff-accent)_16%,var(--ff-surface))] text-[var(--ff-text)]',
        ].join(' ')}
      >
        {children}
        <span className="ml-2 inline-block translate-y-0.5 text-[0.6875rem] whitespace-nowrap text-[var(--ff-muted)]">{time}</span>
      </p>
    </div>
  )
}

function Typing({ delay }: { delay: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ animationDelay: `${delay}ms` }}
      className={`absolute top-0 left-0 flex gap-1 rounded-2xl rounded-tl-md bg-[var(--ff-surface)] px-3.5 py-3.5 opacity-0 motion-safe:animate-[typing-window_1100ms_ease-in-out_both] motion-reduce:hidden ${playState}`}
    >
      {[0, 160, 320].map((d) => (
        <span
          key={d}
          style={{ animationDelay: `${d}ms` }}
          className="size-1.5 rounded-full bg-[var(--ff-muted)] motion-safe:animate-[typing-dot_900ms_ease-in-out_infinite]"
        />
      ))}
    </div>
  )
}

/**
 * Starts the exchange once a third of it is on screen: right away on desktop,
 * and on a phone when you scroll to it, so the reply is seen arriving.
 */
function usePlayWhenSeen() {
  const ref = useRef<HTMLDivElement>(null)
  const [play, setPlay] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (play || !el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        setPlay(true)
        observer.disconnect()
      },
      { threshold: 0.35 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [play])
  return { ref, style: { '--hero-play': play ? 'running' : 'paused' } as CSSProperties }
}

/**
 * The hero's picture of the product: a website enquiry, the studio's WhatsApp
 * reply 38 seconds later, the homeowner answering, and the lead alert. An
 * illustration with made-up names, not real data.
 */
export function HeroExchange() {
  const { ref, style } = usePlayWhenSeen()
  return (
    <div ref={ref} style={style} className="relative mx-auto w-full max-w-[24rem] pb-8 lg:mx-0 lg:ml-auto">
      {/* The terrazzo slab the phone rests on. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 bottom-8 translate-x-4 translate-y-4 rotate-[3deg] rounded-[2rem] bg-[var(--ff-accent)] [background-image:var(--ff-pattern)] [background-size:var(--ff-pattern-size)] sm:translate-x-6 sm:translate-y-6"
      />
      <figure className="relative overflow-hidden rounded-[2rem] border border-[var(--ff-border)] bg-[var(--ff-bg)] shadow-[0_40px_80px_-40px_rgb(28_40_38/0.45)]">
        <figcaption className="sr-only">
          Example: a homeowner sends an enquiry from a studio's website and gets a WhatsApp reply in the studio's name 38
          seconds later.
        </figcaption>
        <div className="flex items-center gap-3 bg-[var(--ff-accent)] px-5 py-4 text-[var(--ff-accent-text)]">
          <span
            aria-hidden="true"
            className={`${displayClass} flex size-10 items-center justify-center rounded-full bg-[var(--ff-accent-text)] text-lg text-[var(--ff-accent)]`}
          >
            n.
          </span>
          <div className="leading-tight">
            <p className="font-semibold">Nila Design House</p>
            <p className="text-xs opacity-80">Business account</p>
          </div>
        </div>
        <div className="space-y-3 px-4 pt-5 pb-14">
          <Beat delay={250} className="flex justify-center">
            <p className="rounded-full bg-[var(--ff-surface)] px-3 py-1 text-xs text-[var(--ff-muted)] shadow-[0_1px_1px_rgb(0_0_0/0.05)]">
              Website enquiry · Asha · 3BHK, Whitefield · 11:14 pm
            </p>
          </Beat>
          <div className="relative">
            <Typing delay={800} />
            <Beat delay={1850}>
              <Bubble from="studio" time="11:14 pm">
                Hi Asha, thanks for your enquiry! This is Nila Design House. Could we call you tomorrow about your 3BHK?
                Is 11 am or 4 pm better?
              </Bubble>
            </Beat>
          </div>
          <Beat delay={2350} className="flex justify-center">
            <p className="inline-flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--ff-accent)_12%,transparent)] px-3 py-1 text-xs font-semibold text-[var(--ff-accent)]">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 fill-none stroke-current stroke-[1.75]">
                <circle cx="8" cy="8" r="6" />
                <path d="M8 4.75V8l2 1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Replied in 38 seconds
            </p>
          </Beat>
          <Beat delay={3300}>
            <Bubble from="homeowner" time="11:16 pm">
              4 pm works. Thanks for the quick reply!
            </Bubble>
          </Beat>
        </div>
      </figure>
      <Beat delay={2850} className="absolute bottom-0 -left-3 sm:-left-10">
        <div className="flex items-center gap-3 rounded-2xl border border-[var(--ff-border)] bg-[var(--ff-surface)] py-3 pr-4 pl-3 shadow-[0_20px_40px_-20px_rgb(28_40_38/0.4)]">
          <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-[#E6C27A] text-[var(--ff-text)]">
            <svg viewBox="0 0 20 20" className="size-4.5 fill-none stroke-current stroke-[1.75]">
              <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5h-13S5 12 5 8Z" strokeLinejoin="round" />
              <path d="M8.5 16.5a1.6 1.6 0 0 0 3 0" strokeLinecap="round" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Lead alert sent to your designer</p>
            <p className="text-xs text-[var(--ff-muted)]">Asha · 3BHK · Whitefield</p>
          </div>
        </div>
      </Beat>
    </div>
  )
}
