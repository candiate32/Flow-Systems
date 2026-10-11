import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { displayClass, focusRing, primaryButtonClass } from '../forms/components/ui'
import { loadThemeFonts, SHARED_TYPE, THEMES, themeStyle } from '../forms/themes'
import { auditWhatsappLink, WHY } from '../home/content'
import { FormTabs } from '../home/FormTabs'
import { HeroExchange } from '../home/HeroExchange'
import { HowItWorks } from '../home/HowItWorks'
import { scrollToSection, sectionHref } from '../home/motion'
import { Reveal } from '../home/Reveal'

const container = 'mx-auto max-w-6xl px-5 sm:px-8'
const eyebrow = 'text-xs font-semibold tracking-[0.16em] text-[var(--ff-accent)] uppercase'
const secondaryButtonClass = [
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--ff-radius)] border border-[var(--ff-field-border)] px-5 py-3',
  'text-base font-semibold text-[var(--ff-text)] transition-colors hover:border-[var(--ff-accent)] hover:text-[var(--ff-accent)]',
  focusRing,
].join(' ')

/** A link to a section on this page: smooth scroll, focus moves there, hash routing untouched. */
function SectionLink({ to, className, children }: { to: string; className: string; children: ReactNode }) {
  function onClick(e: MouseEvent<HTMLAnchorElement>) {
    e.preventDefault()
    scrollToSection(to)
  }
  return (
    <a href={sectionHref(to)} onClick={onClick} className={className}>
      {children}
    </a>
  )
}

function Mark() {
  return (
    <span aria-hidden="true" className="relative block size-8 rounded-[10px] bg-[var(--ff-accent)]">
      <span className="absolute top-[7px] left-[8px] size-[5px] rounded-full bg-[#E8A58F]" />
      <span className="absolute top-[14px] left-[18px] size-[4px] rounded-full bg-[#E6C27A]" />
      <span className="absolute top-[20px] left-[9px] size-[6px] rounded-full bg-[#9CC3B6]" />
    </span>
  )
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      <span className={`${displayClass} text-[1.125rem] leading-none`}>Flow Systems</span>
    </span>
  )
}

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const link = `inline-flex min-h-11 items-center rounded-full px-4 text-[0.9375rem] font-medium text-[var(--ff-muted)] transition-colors hover:text-[var(--ff-text)] ${focusRing}`
  return (
    <header
      className={`sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300 ${
        scrolled
          ? 'border-[var(--ff-border)] bg-[color-mix(in_srgb,var(--ff-bg)_86%,transparent)] backdrop-blur-md'
          : 'border-transparent'
      }`}
    >
      <div className={`${container} flex h-16 items-center gap-4`}>
        <SectionLink to="top" className={`-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 ${focusRing}`}>
          <Wordmark />
          <span className="sr-only">, back to top</span>
        </SectionLink>
        <nav aria-label="On this page" className="ml-auto hidden md:block">
          <ul className="flex items-center gap-1">
            <li>
              <SectionLink to="how" className={link}>
                How it works
              </SectionLink>
            </li>
            <li>
              <SectionLink to="forms" className={link}>
                Forms
              </SectionLink>
            </li>
          </ul>
        </nav>
        <SectionLink
          to="audit"
          className={`ml-auto inline-flex min-h-11 items-center rounded-full bg-[var(--ff-accent)] px-5 text-[0.9375rem] font-semibold text-[var(--ff-accent-text)] transition-[filter] hover:brightness-110 md:ml-2 ${focusRing}`}
        >
          Free audit
        </SectionLink>
      </div>
    </header>
  )
}

function Hero({ auditLink }: { auditLink: string | null }) {
  return (
    <section id="top" tabIndex={-1} className="scroll-mt-16 overflow-x-clip outline-none">
      <div className={`${container} grid items-center gap-14 pt-10 pb-20 sm:pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-10 lg:pt-20 lg:pb-28`}>
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-[var(--ff-border)] bg-[var(--ff-surface)] py-1.5 pr-3.5 pl-2.5 text-sm text-[var(--ff-muted)] motion-safe:animate-[hero-in_640ms_cubic-bezier(0.22,1,0.36,1)_both]">
            <span aria-hidden="true" className="relative flex size-2">
              <span className="absolute inset-0 rounded-full bg-[var(--ff-accent)] opacity-60 motion-safe:animate-ping" />
              <span className="relative size-2 rounded-full bg-[var(--ff-accent)]" />
            </span>
            For interior design studios in Bangalore
          </p>
          <h1
            style={{ animationDelay: '80ms' }}
            className={`${displayClass} mt-6 text-[2.75rem] leading-[1.02] text-balance sm:text-6xl lg:text-[4.25rem] motion-safe:animate-[hero-in_700ms_cubic-bezier(0.22,1,0.36,1)_both]`}
          >
            Every enquiry answered in <span className="text-[var(--ff-accent)]">under a minute.</span>
          </h1>
          <p
            style={{ animationDelay: '160ms' }}
            className="mt-6 max-w-xl text-lg leading-relaxed text-pretty text-[var(--ff-muted)] sm:text-xl motion-safe:animate-[hero-in_700ms_cubic-bezier(0.22,1,0.36,1)_both]"
          >
            Flow Systems replies to every new enquiry on WhatsApp in your studio's name, follows up until the homeowner
            answers, and shows you where every lead stands. Fully managed, on the WhatsApp Business number you already
            use.
          </p>
          <div
            style={{ animationDelay: '240ms' }}
            className="mt-9 flex flex-col gap-3 sm:flex-row motion-safe:animate-[hero-in_700ms_cubic-bezier(0.22,1,0.36,1)_both]"
          >
            {auditLink ? (
              <>
                <a href={auditLink} target="_blank" rel="noopener noreferrer" className={`${primaryButtonClass} sm:w-auto`}>
                  Get a free Enquiry Leak Audit
                </a>
                <SectionLink to="forms" className={secondaryButtonClass}>
                  Try a live form
                </SectionLink>
              </>
            ) : (
              <>
                <SectionLink to="forms" className={`${primaryButtonClass} sm:w-auto`}>
                  Try a live form
                </SectionLink>
                <SectionLink to="how" className={secondaryButtonClass}>
                  See how it works
                </SectionLink>
              </>
            )}
          </div>
          <ul
            style={{ animationDelay: '320ms' }}
            className="mt-9 flex flex-wrap gap-x-6 gap-y-2 text-sm text-[var(--ff-muted)] motion-safe:animate-[hero-in_700ms_cubic-bezier(0.22,1,0.36,1)_both]"
          >
            {['Set up in about 7 days', 'Same WhatsApp app for your team', 'Lead data stays in India'].map((item) => (
              <li key={item} className="flex items-center gap-2">
                <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-none stroke-[var(--ff-accent)] stroke-2">
                  <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
        <HeroExchange />
      </div>
    </section>
  )
}

const WHY_ICONS = [
  // Reply first: a stopwatch.
  <path key="a" d="M12 8v4.5l3 2M9.5 2.5h5M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z" />,
  // Follow-ups: a loop.
  <path key="b" d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.6L4 15.5M4 20v-4.5h4.5" />,
  // Know what's working: bars.
  <path key="c" d="M5 20V12M12 20V5M19 20v-5M3 20.5h18" />,
]

function Why() {
  return (
    <section aria-labelledby="why-title" className="border-y border-[var(--ff-border)] bg-[var(--ff-surface)]">
      <div className={`${container} py-20 sm:py-28`}>
        <Reveal>
          <p className={eyebrow}>Why it matters</p>
          <h2 id="why-title" className={`${displayClass} mt-4 max-w-4xl text-[1.75rem] leading-[1.15] text-balance sm:text-[2.75rem]`}>
            Homeowners message three or four studios at once. The one that replies first, and keeps following up, often
            gets the site visit.
          </h2>
        </Reveal>
        <ul className="mt-14 grid gap-5 md:grid-cols-3">
          {WHY.map((item, i) => (
            <li key={item.title}>
              <Reveal delay={i * 100} className="h-full">
                <div className="h-full rounded-[calc(var(--ff-radius)*1.5)] border border-[var(--ff-border)] bg-[var(--ff-bg)] p-7">
                  <span aria-hidden="true" className="flex size-11 items-center justify-center rounded-full bg-[var(--ff-accent)] text-[var(--ff-accent-text)]">
                    <svg viewBox="0 0 24 24" className="size-5 fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]">
                      {WHY_ICONS[i]}
                    </svg>
                  </span>
                  <h3 className={`${displayClass} mt-6 text-xl leading-tight`}>{item.title}</h3>
                  <p className="mt-2 leading-relaxed text-[var(--ff-muted)]">{item.body}</p>
                </div>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Forms() {
  return (
    <section id="forms" tabIndex={-1} aria-labelledby="forms-title" className="scroll-mt-16 border-t border-[var(--ff-border)] bg-[var(--ff-surface)] outline-none">
      <div className={`${container} py-20 sm:py-28`}>
        <Reveal className="max-w-2xl">
          <p className={eyebrow}>Your enquiry form</p>
          <h2 id="forms-title" className={`${displayClass} mt-3 text-[2.25rem] leading-[1.05] text-balance sm:text-5xl`}>
            A form that looks like your studio.
          </h2>
          <p className="mt-5 text-lg leading-relaxed text-pretty text-[var(--ff-muted)]">
            Every studio gets its own enquiry form, in its own colours, asking the questions it cares about. These three
            sample studios are live and wired to the same engine, so go ahead and send one.
          </p>
        </Reveal>
        <Reveal delay={120} className="mt-10">
          <FormTabs />
        </Reveal>
      </div>
    </section>
  )
}

function Audit({ auditLink }: { auditLink: string | null }) {
  return (
    <section id="audit" tabIndex={-1} aria-labelledby="audit-title" className="scroll-mt-16 bg-[var(--ff-surface)] pb-8 outline-none sm:pb-12">
      <div className={container}>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-[var(--ff-accent)] text-[var(--ff-accent-text)] [background-image:var(--ff-pattern)] [background-size:var(--ff-pattern-size)]">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-[linear-gradient(180deg,var(--ff-accent)_0%,var(--ff-accent)_62%,transparent_100%)] sm:bg-[linear-gradient(90deg,var(--ff-accent)_0%,var(--ff-accent)_45%,transparent_100%)]"
            />
            <div className="relative max-w-2xl px-6 py-14 sm:px-12 sm:py-20">
              <p className="text-xs font-semibold tracking-[0.16em] uppercase opacity-85">Free Enquiry Leak Audit</p>
              <h2 id="audit-title" className={`${displayClass} mt-4 text-[2.25rem] leading-[1.05] text-balance sm:text-5xl`}>
                How fast does your studio really reply?
              </h2>
              <p className="mt-5 text-lg leading-relaxed text-pretty opacity-90">
                We send your studio a test enquiry, then show you how quickly it was answered and followed up. It's free,
                and there's nothing to set up.
              </p>
              <div className="mt-9">
                {auditLink ? (
                  <a
                    href={auditLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--ff-radius)] bg-[var(--ff-accent-text)] px-6 py-3 font-semibold text-[var(--ff-accent)] transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-accent-text)]"
                  >
                    Book your free audit on WhatsApp
                  </a>
                ) : (
                  <SectionLink
                    to="forms"
                    className="inline-flex min-h-12 items-center justify-center gap-2 rounded-[var(--ff-radius)] bg-[var(--ff-accent-text)] px-6 py-3 font-semibold text-[var(--ff-accent)] transition-[filter] hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-accent-text)]"
                  >
                    Try a live form first
                  </SectionLink>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer className="bg-[var(--ff-surface)]">
      <div className={`${container} flex flex-col gap-6 py-10 text-sm text-[var(--ff-muted)] sm:flex-row sm:items-center sm:justify-between`}>
        <div className="text-[var(--ff-text)]">
          <Wordmark />
        </div>
        <p className="max-w-md leading-relaxed">
          Enquiry handling and follow-up for interior design studios in Bangalore. Lead data is stored in India and deleted
          on request.
        </p>
        <Link to="/" className={`inline-flex min-h-11 items-center font-semibold text-[var(--ff-text)] underline underline-offset-4 ${focusRing}`}>
          All sample forms, full screen
        </Link>
      </div>
    </footer>
  )
}

/** `/home`: what Flow Systems is and does, with the sample forms built in. Nila's design system throughout. */
export default function Home() {
  const theme = THEMES.terrazzo
  const auditLink = auditWhatsappLink()
  // --ff-sticky-top keeps a sample form's sticky column clear of the sticky nav.
  const rootStyle = { ...themeStyle(theme), '--ff-sticky-top': '6.5rem' } as CSSProperties

  useEffect(() => {
    loadThemeFonts(SHARED_TYPE.fontHref)
    document.title = 'Flow Systems · Every enquiry answered in under a minute'
    if (window.scrollY > 0) window.scrollTo({ top: 0 })
  }, [])

  return (
    <div
      style={rootStyle}
      className="min-h-dvh bg-[var(--ff-bg)] font-[family-name:var(--ff-font-body)] text-[var(--ff-text)] antialiased"
    >
      <Nav />
      <main>
        <Hero auditLink={auditLink} />
        <Why />
        <HowItWorks />
        <Forms />
        <Audit auditLink={auditLink} />
      </main>
      <Footer />
    </div>
  )
}
