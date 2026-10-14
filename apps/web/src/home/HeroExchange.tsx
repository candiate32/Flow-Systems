import type { CSSProperties, ReactNode } from 'react'
import { useInView } from './useInView'

/** Plays in once, `delay` ms after the phone comes into view. Shown as is with reduced motion. */
function Beat({ delay, className = '', children }: { delay: number; className?: string; children: ReactNode }) {
  // Inline, so the animation shorthand in the class can't reset it to running.
  const style: CSSProperties = { animationDelay: `${delay}ms`, animationPlayState: 'var(--hero-play, running)' }
  return (
    <div style={style} className={`motion-safe:animate-[hero-in_700ms_cubic-bezier(0.22,1,0.36,1)_both] ${className}`}>
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
          'max-w-[84%] rounded-[1.15rem] px-3.5 py-2 text-[0.9375rem] leading-[1.35] tracking-[-0.01em] text-hig-ink',
          'shadow-[0_1px_0.5px_rgb(0_0_0/0.08)]',
          studio ? 'rounded-bl-[0.4rem] bg-white' : 'rounded-br-[0.4rem] bg-hig-tint-soft',
        ].join(' ')}
      >
        {children}
        <span className="ml-2 inline-block translate-y-0.5 text-[0.6875rem] whitespace-nowrap text-hig-ink-2">{time}</span>
      </p>
    </div>
  )
}

function Typing({ delay }: { delay: number }) {
  return (
    <div
      aria-hidden="true"
      style={{ animationDelay: `${delay}ms`, animationPlayState: 'var(--hero-play, running)' }}
      className="absolute top-0 left-0 flex gap-1 rounded-[1.15rem] rounded-bl-[0.4rem] bg-white px-3.5 py-3 opacity-0 motion-safe:animate-[typing-window_1100ms_ease-in-out_both] motion-reduce:hidden"
    >
      {[0, 160, 320].map((d) => (
        <span
          key={d}
          style={{ animationDelay: `${d}ms` }}
          className="size-1.5 rounded-full bg-hig-ink-2 motion-safe:animate-[typing-dot_900ms_ease-in-out_3]"
        />
      ))}
    </div>
  )
}

/** A floating glass card beside the phone, like a callout on a product page. */
function Callout({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[1.25rem] border border-black/[0.06] bg-white/80 py-3 pr-4 pl-3 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.3)] backdrop-blur-xl">
      {icon}
      <div className="leading-tight">
        <p className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-hig-ink">{title}</p>
        <p className="mt-0.5 text-[0.8125rem] text-hig-ink-2">{detail}</p>
      </div>
    </div>
  )
}

const bell = (
  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#F5B83D] text-hig-ink">
    <svg viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-[1.75]">
      <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 1.5 5.5h-13S5 12 5 8Z" strokeLinejoin="round" />
      <path d="M8.5 16.5a1.6 1.6 0 0 0 3 0" strokeLinecap="round" />
    </svg>
  </span>
)

const calendar = (
  <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-hig-tint text-white">
    <svg viewBox="0 0 20 20" className="size-5 fill-none stroke-current stroke-[1.75]">
      <rect x="3" y="4.5" width="14" height="12" rx="2.5" />
      <path d="M3 8.5h14M7 2.75v3.5M13 2.75v3.5" strokeLinecap="round" />
    </svg>
  </span>
)

/**
 * The hero's picture of the product: a homeowner's phone showing a website
 * enquiry, the studio's WhatsApp reply 38 seconds later and the homeowner's
 * answer, with callouts for the lead alert and the follow-ups. Made-up names,
 * not real data. Plays once a third of it is on screen.
 */
export function HeroExchange() {
  const [ref, play] = useInView<HTMLDivElement>({ threshold: 0.35, rootMargin: '0px' })
  const style = { '--hero-play': play ? 'running' : 'paused' } as CSSProperties
  return (
    <div ref={ref} style={style} className="relative mx-auto w-full max-w-[20rem] sm:max-w-[21.5rem]">
      {/* A soft verdigris glow behind the phone. */}
      <div
        aria-hidden="true"
        className="absolute -inset-x-24 top-16 bottom-0 bg-[radial-gradient(closest-side,rgb(43_122_107/0.28),transparent)] blur-2xl"
      />
      <figure className="relative rounded-[3.1rem] bg-hig-ink p-[10px] shadow-[0_60px_100px_-40px_rgb(0_0_0/0.45),inset_0_0_0_1.5px_rgb(255_255_255/0.12)]">
        <figcaption className="sr-only">
          Example: a homeowner sends an enquiry from a studio's website and gets a WhatsApp reply in the studio's name 38
          seconds later.
        </figcaption>
        <div className="relative overflow-hidden rounded-[2.5rem] bg-[#EFEAE2]">
          {/* Status bar and Dynamic Island. */}
          <div aria-hidden="true" className="flex h-12 items-center justify-between bg-white/90 px-7 pt-1 text-[0.8125rem] font-semibold text-hig-ink">
            <span>11:14</span>
            <span className="absolute top-3 left-1/2 h-[1.6rem] w-[5.75rem] -translate-x-1/2 rounded-full bg-black" />
            <span className="flex items-center gap-1.5">
              <svg viewBox="0 0 18 12" className="h-2.5 w-4 fill-current">
                <rect x="0" y="8" width="3" height="4" rx="1" />
                <rect x="5" y="5.5" width="3" height="6.5" rx="1" />
                <rect x="10" y="3" width="3" height="9" rx="1" />
                <rect x="15" y="0" width="3" height="12" rx="1" />
              </svg>
              <span className="h-2.5 w-5 rounded-[3px] border border-current p-[1.5px]">
                <span className="block h-full w-3/4 rounded-[1px] bg-current" />
              </span>
            </span>
          </div>
          <div className="flex items-center gap-3 border-b border-black/[0.06] bg-white/90 px-4 pb-2.5">
            <svg aria-hidden="true" viewBox="0 0 12 20" className="h-4 w-2.5 fill-none stroke-hig-tint stroke-[2.5]">
              <path d="M10 2 2 10l8 8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-full bg-hig-tint text-[0.9375rem] font-bold text-white">
              n.
            </span>
            <div className="leading-tight">
              <p className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-hig-ink">Nila Design House</p>
              <p className="text-[0.75rem] text-hig-ink-2">Business account</p>
            </div>
          </div>

          <div className="h-[23rem] space-y-2.5 px-3.5 pt-4 [mask-image:linear-gradient(to_bottom,black_82%,transparent)]">
            <Beat delay={250} className="flex justify-center">
              <p className="rounded-full bg-white/90 px-3 py-1 text-[0.75rem] text-hig-ink-2">
                Website enquiry · Asha · 3BHK, Whitefield
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
              <p className="inline-flex items-center gap-1.5 rounded-full bg-hig-tint px-3 py-1 text-[0.75rem] font-semibold text-white">
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
        </div>
      </figure>

      <Beat delay={2850} className="absolute -bottom-6 left-1/2 w-max -translate-x-1/2 lg:top-[52%] lg:bottom-auto lg:left-[calc(100%-2rem)] lg:translate-x-0">
        <Callout icon={bell} title="Lead alert sent to your designer" detail="Asha · 3BHK · Whitefield" />
      </Beat>
      <Beat delay={2600} className="absolute top-[30%] right-[calc(100%-2rem)] hidden w-max lg:block">
        <Callout icon={calendar} title="Follow-ups scheduled" detail="Day 1, 3 and 7, if she goes quiet" />
      </Beat>
    </div>
  )
}
