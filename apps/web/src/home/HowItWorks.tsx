import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { ADD_ONS, COMING_SOON, STEPS } from './content'
import { container, eyebrow, lead, sectionTitle, tile, wide } from './hig'
import { prefersReducedMotion } from './motion'
import { Reveal } from './Reveal'
import { useInView } from './useInView'

/** Counts up to `target` once `run` turns true; shows `target` straight away with reduced motion. */
function useCountUp(target: number, run: boolean, duration: number) {
  const [value, setValue] = useState(() => (run && prefersReducedMotion() ? target : 0))
  useEffect(() => {
    if (!run || prefersReducedMotion()) return
    let frame = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      setValue(Math.round((1 - (1 - p) ** 3) * target))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [run, target, duration])
  return value
}

/** Classes that move between a hidden and a shown state once the tile is in view. */
function enter(run: boolean, shown: string, hidden: string) {
  return `transition-[opacity,translate,scale,transform,background-color,color] duration-700 ease-spring motion-reduce:transition-none ${run ? shown : hidden}`
}

/** A bento tile that rises in when it scrolls into view, then plays its illustration once. */
function Tile({ className = '', delay = 0, children }: { className?: string; delay?: number; children: (run: boolean) => ReactNode }) {
  const [ref, shown] = useInView<HTMLLIElement>({ threshold: 0.25, rootMargin: '0px' })
  const style: CSSProperties | undefined = delay ? { transitionDelay: `${delay}ms` } : undefined
  return (
    <li
      ref={ref}
      style={style}
      className={`flex flex-col overflow-hidden p-7 sm:p-9 ${tile} transition-[opacity,translate,scale] duration-[1000ms] ease-spring ${
        shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-8 scale-[0.96] opacity-0'
      } ${className}`}
    >
      {children(shown)}
    </li>
  )
}

function TileHeader({ when, title, body }: { when: string; title: string; body: string }) {
  return (
    <div>
      <p className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-hig-tint">{when}</p>
      <h3 className="mt-1.5 text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.025em] text-balance text-hig-ink sm:text-[2rem]">
        {title}
      </h3>
      <p className="mt-3 max-w-md text-[1.0625rem] leading-[1.47] tracking-[-0.01em] text-pretty text-hig-ink-2">{body}</p>
    </div>
  )
}

const RING = 2 * Math.PI * 52

/** A stopwatch ring that fills to an example 38 seconds, then the reply it timed. */
function ReplyTimer({ run }: { run: boolean }) {
  const seconds = useCountUp(38, run, 1600)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 pt-10 sm:flex-row sm:justify-between lg:flex-col lg:justify-center lg:gap-10">
      <p className="sr-only">Example: a reply 38 seconds after the enquiry arrives.</p>
      <div aria-hidden="true" className="relative size-48 shrink-0 sm:size-56 lg:size-64">
        <svg viewBox="0 0 120 120" className="size-full -rotate-90">
          <circle cx="60" cy="60" r="52" strokeWidth="9" className="fill-none stroke-hig-track" />
          <circle
            cx="60"
            cy="60"
            r="52"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={run ? RING * (1 - 38 / 60) : RING}
            className="fill-none stroke-hig-tint transition-[stroke-dashoffset] duration-[1600ms] ease-out motion-reduce:transition-none"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <p className="text-[3.25rem] leading-none font-semibold tracking-[-0.04em] text-hig-ink tabular-nums">
            {seconds}
            <span className="text-[1.75rem] tracking-normal">s</span>
          </p>
          <p className="mt-1.5 text-[0.8125rem] text-hig-ink-2">Example reply</p>
        </div>
      </div>
      <div
        aria-hidden="true"
        style={{ transitionDelay: '1400ms' }}
        className={`w-full max-w-[18rem] rounded-[1.15rem] lg:max-w-[20rem] rounded-bl-[0.4rem] bg-hig-fill px-4 py-3 text-[0.9375rem] leading-snug tracking-[-0.01em] text-hig-ink ${enter(run, 'translate-y-0 opacity-100', 'translate-y-3 opacity-0')}`}
      >
        Hi Asha, thanks for your enquiry! This is Nila Design House. Is 11 am or 4 pm better for a call?
        <span className="mt-1.5 block text-right text-[0.6875rem] text-hig-ink-2">Sent in your studio's name</span>
      </div>
    </div>
  )
}

const ALERTS = [
  { name: 'Asha', detail: '3BHK · Whitefield · Full home', time: 'now', delay: 900 },
  { name: 'Rohan', detail: 'Villa · Sarjapur Road · Kitchen only', time: '2m ago', delay: 300 },
]

/** Lead alerts dropping in like notifications. Made-up leads. */
function AlertStack({ run }: { run: boolean }) {
  return (
    <div aria-hidden="true" className="mt-auto space-y-2.5 pt-8">
      {ALERTS.map((a) => (
        <div
          key={a.name}
          style={{ transitionDelay: `${a.delay}ms` }}
          className={`flex items-center gap-3 rounded-[1.1rem] bg-hig-fill p-3 ${enter(run, 'translate-y-0 scale-100 opacity-100', '-translate-y-4 scale-95 opacity-0')}`}
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[0.6rem] bg-hig-tint text-white">
            <svg viewBox="0 0 20 20" className="size-5 fill-current">
              <path d="M10 3c-4 0-7 2.7-7 6.1 0 1.9 1 3.6 2.5 4.7L5 17l3.4-1.6c.5.1 1 .2 1.6.2 4 0 7-2.7 7-6.1S14 3 10 3Z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="flex items-baseline justify-between gap-2 text-[0.875rem]">
              <span className="font-semibold text-hig-ink">New lead: {a.name}</span>
              <span className="shrink-0 text-[0.75rem] text-hig-ink-2">{a.time}</span>
            </p>
            <p className="mt-0.5 truncate text-[0.8125rem] text-hig-ink-2">{a.detail}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

const FOLLOW_UP_DAYS = [1, 3, 7]

/** A week strip where days 1, 3 and 7 light up in turn. */
function FollowUpDays({ run }: { run: boolean }) {
  return (
    <div aria-hidden="true" className="mt-auto pt-8">
      <div className="relative grid grid-cols-7">
        <span className="absolute top-[1.125rem] right-[7%] left-[7%] h-0.5 rounded-full bg-hig-track sm:top-[1.375rem]" />
        <span
          className={`absolute top-[1.125rem] right-[7%] left-[7%] h-0.5 origin-left sm:top-[1.375rem] rounded-full bg-hig-tint transition-transform duration-[1600ms] ease-out motion-reduce:transition-none ${run ? 'scale-x-100' : 'scale-x-0'}`}
        />
        {[1, 2, 3, 4, 5, 6, 7].map((day) => {
          const send = FOLLOW_UP_DAYS.indexOf(day)
          const style: CSSProperties | undefined = send >= 0 ? { transitionDelay: `${200 + send * 500}ms` } : undefined
          return (
            <div key={day} className="relative flex flex-col items-center gap-2">
              <span
                style={style}
                className={`flex size-9 items-center justify-center rounded-full text-[0.875rem] font-semibold sm:size-11 sm:text-[0.9375rem] tabular-nums ${
                  send >= 0
                    ? enter(run, 'scale-100 bg-hig-tint text-white', 'scale-90 bg-white text-hig-ink-2 ring-1 ring-hig-line')
                    : 'bg-white text-hig-ink-2 ring-1 ring-hig-line'
                }`}
              >
                {day}
              </span>
              <span className="text-[0.75rem] text-hig-ink-2">{send >= 0 ? 'Sent' : ''}&nbsp;</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const BARS = [
  { day: 'M', height: 40 },
  { day: 'T', height: 64 },
  { day: 'W', height: 50 },
  { day: 'T', height: 86 },
  { day: 'F', height: 70 },
  { day: 'S', height: 34 },
  { day: 'S', height: 58 },
]

const STAGES = [
  { label: 'New', color: 'bg-[#0A84FF]' },
  { label: 'Replied', color: 'bg-hig-tint' },
  { label: 'Site visit', color: 'bg-[#F5B83D]' },
]

/** A sample weekly report: bars that grow, and where leads stand. No numbers: it's an illustration. */
function ReportBars({ run }: { run: boolean }) {
  return (
    <div aria-hidden="true" className="mt-auto pt-8">
      <div className="rounded-[1.1rem] bg-hig-fill p-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[0.875rem] font-semibold text-hig-ink">Enquiries this week</p>
          <p className="text-[0.75rem] text-hig-ink-2">Sample</p>
        </div>
        <div className="mt-4 flex h-24 items-end gap-2">
          {BARS.map((b, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <span
                style={{ height: `${b.height}%`, transitionDelay: `${i * 70}ms` }}
                className={`w-full origin-bottom rounded-t-[0.4rem] rounded-b-[0.2rem] bg-hig-tint ${enter(run, 'scale-y-100', 'scale-y-0')}`}
              />
              <span className="text-[0.6875rem] text-hig-ink-2">{b.day}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-black/[0.06] pt-3">
          {STAGES.map((s) => (
            <span key={s.label} className="flex items-center gap-1.5 text-[0.75rem] text-hig-ink-2">
              <span className={`size-2 rounded-full ${s.color}`} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

const ADD_ON_ICONS = [
  // Site visit reminders: a calendar with a tick.
  <path key="a" d="M4 6.5h16M8 3v3M16 3v3M5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12A1.5 1.5 0 0 1 5.5 5ZM9 13.5l2 2 4-4" />,
  // Old enquiry follow-up: a loop.
  <path key="b" d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />,
  // Google review requests: a star.
  <path key="c" d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9L12 3.5Z" />,
  // Enquiry landing page: a phone.
  <path key="d" d="M8.5 3h7A1.5 1.5 0 0 1 17 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5v-15A1.5 1.5 0 0 1 8.5 3ZM11 18h2" />,
]

function AddOns({ run }: { run: boolean }) {
  return (
    <>
      <p className="text-[0.9375rem] font-semibold tracking-[-0.01em] text-hig-tint">Add-ons</p>
      <h3 className="mt-1.5 text-[1.75rem] leading-[1.1] font-semibold tracking-[-0.025em] text-hig-ink sm:text-[2rem]">
        Add when you need them
      </h3>
      <ul className="mt-7 mb-8 grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {ADD_ONS.map((item, i) => (
          <li key={item.title} style={{ transitionDelay: `${150 + i * 90}ms` }} className={`flex gap-3.5 ${enter(run, 'translate-y-0 opacity-100', 'translate-y-2 opacity-0')}`}>
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-hig-tint-soft text-hig-tint">
              <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]">
                {ADD_ON_ICONS[i]}
              </svg>
            </span>
            <div>
              <h4 className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-hig-ink">{item.title}</h4>
              <p className="mt-1 text-[0.9375rem] leading-[1.45] text-hig-ink-2">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-auto flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-5 text-[0.8125rem] text-hig-ink-2">
        <span className="font-semibold text-hig-ink">Coming soon</span>
        {COMING_SOON.map((item) => (
          <span key={item} className="rounded-full bg-hig-fill px-3 py-1">
            {item}
          </span>
        ))}
      </p>
    </>
  )
}

const [reply, alerts, followUps, report] = STEPS

/** How it works: the four core services and the add-ons as a bento grid, each tile animating as it arrives. */
export function HowItWorks() {
  return (
    <section id="how" tabIndex={-1} aria-labelledby="how-title" className="scroll-mt-12 bg-hig-fill py-24 outline-none sm:py-32">
      <Reveal className={`${container} text-center`}>
        <p className={eyebrow}>How it works</p>
        <h2 id="how-title" className={`${sectionTitle} mt-2`}>
          One package. We run it for you.
        </h2>
        <p className={`${lead} mx-auto mt-5 max-w-2xl`}>
          Four services that work together from the moment an enquiry lands. We set it up in about 7 days and run it, so
          there's nothing new for your team to learn: they keep using the same WhatsApp app.
        </p>
      </Reveal>

      <ul className={`${wide} mt-14 grid gap-4 sm:mt-16 md:grid-cols-2 lg:grid-cols-12 lg:gap-5`}>
        <Tile className="md:col-span-2 lg:col-span-7 lg:row-span-2">
          {(run) => (
            <>
              <TileHeader {...reply} />
              <ReplyTimer run={run} />
            </>
          )}
        </Tile>
        <Tile className="lg:col-span-5" delay={100}>
          {(run) => (
            <>
              <TileHeader {...alerts} />
              <AlertStack run={run} />
            </>
          )}
        </Tile>
        <Tile className="lg:col-span-5" delay={150}>
          {(run) => (
            <>
              <TileHeader {...followUps} />
              <FollowUpDays run={run} />
            </>
          )}
        </Tile>
        <Tile className="lg:col-span-5">
          {(run) => (
            <>
              <TileHeader {...report} />
              <ReportBars run={run} />
            </>
          )}
        </Tile>
        <Tile className="lg:col-span-7" delay={100}>
          {(run) => <AddOns run={run} />}
        </Tile>
      </ul>
    </section>
  )
}
