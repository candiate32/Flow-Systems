import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { contactWhatsappLink, FAQ, SERVICES, STEPS } from '../v2/content'
import { InkSculpture } from '../v2/InkSculpture'
import { loadV2Fonts, scrollToSection, sectionHref } from '../v2/motion'
import { Reveal } from '../v2/Reveal'
import { ServiceArt } from '../v2/ServiceArt'

// Website v2 home (spec 008): every Flow Systems service on one page, in a
// monochrome ink style. The interior designer pages at / and /home are separate.

const tokens = {
  '--v2-bg': '#09090b',
  '--v2-panel': '#111114',
  '--v2-raised': '#18181c',
  '--v2-line': 'rgb(255 255 255 / 0.09)',
  '--v2-line-strong': 'rgb(255 255 255 / 0.2)',
  '--v2-text': '#fafafa',
  '--v2-muted': '#a1a1aa',
  '--v2-sans': "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  '--v2-mono': "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
} as CSSProperties

const container = 'mx-auto w-full max-w-6xl px-4 sm:px-8'
const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-[var(--v2-text)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--v2-bg)]'
const mono = 'font-[family-name:var(--v2-mono)] text-[0.75rem] font-medium tracking-[0.14em] uppercase'
const sectionClass = 'scroll-mt-20 outline-none'
const h2Class = 'text-[2rem] leading-[1.1] font-semibold tracking-[-0.03em] text-balance sm:text-[2.75rem]'
const primaryButton = [
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[var(--v2-text)] px-6 text-[0.9375rem] font-semibold text-[var(--v2-bg)]',
  'transition-[transform,background-color] duration-200 hover:bg-white active:scale-[0.98]',
  focusRing,
].join(' ')
const secondaryButton = [
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[var(--v2-line-strong)] px-6 text-[0.9375rem] font-medium',
  'text-[var(--v2-text)] transition-colors duration-200 hover:border-[var(--v2-text)]',
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

/** The main call to action: WhatsApp when we have a number, otherwise the services. Never a dead link. */
function ContactButton({ className = primaryButton }: { className?: string }) {
  const href = contactWhatsappLink()
  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        Book a free audit
        <Arrow />
      </a>
    )
  }
  return (
    <SectionLink to="services" className={className}>
      Explore services
      <Arrow />
    </SectionLink>
  )
}

function Arrow() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3 8h10m0 0L9 4m4 4-4 4" />
    </svg>
  )
}

/** Flow Systems' v2 mark: three strands crossing, drawn in ink. Decorative, so label the link around it. */
function Mark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className="size-7 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <rect x="0.75" y="0.75" width="26.5" height="26.5" rx="8" strokeOpacity="0.35" />
      <path d="M6 18c4 0 4-8 8-8s4 8 8 8" />
      <path d="M6 14c4 0 4-4 8-4s4 4 8 4" strokeOpacity="0.55" />
      <path d="M6 10c4 0 4 8 8 8s4-8 8-8" strokeOpacity="0.3" />
    </svg>
  )
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <Mark />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em]">Flow Systems</span>
    </span>
  )
}

const NAV = [
  { to: 'services', label: 'Services' },
  { to: 'live', label: 'In action' },
  { to: 'process', label: 'How we work' },
  { to: 'faq', label: 'FAQ' },
] as const

function Nav() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const link = `inline-flex min-h-11 items-center rounded-full px-3.5 text-[0.875rem] text-[var(--v2-muted)] transition-colors hover:text-[var(--v2-text)] ${focusRing}`
  return (
    <header
      className={`sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300 ${
        scrolled ? 'border-[var(--v2-line)] bg-[rgb(9_9_11/0.8)] backdrop-blur-md' : 'border-transparent'
      }`}
    >
      <div className={`${container} flex h-16 items-center gap-3`}>
        <SectionLink to="top" className={`-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 ${focusRing}`}>
          <Wordmark />
          <span className="sr-only">, back to top</span>
        </SectionLink>
        <nav aria-label="On this page" className="ml-auto hidden md:block">
          <ul className="flex items-center">
            {NAV.map((item) => (
              <li key={item.to}>
                <SectionLink to={item.to} className={link}>
                  {item.label}
                </SectionLink>
              </li>
            ))}
          </ul>
        </nav>
        <SectionLink
          to="contact"
          className={`ml-auto inline-flex min-h-11 items-center rounded-full border border-[var(--v2-line-strong)] px-4 text-[0.875rem] font-medium transition-colors hover:border-[var(--v2-text)] md:ml-2 ${focusRing}`}
        >
          Talk to us
        </SectionLink>
      </div>
    </header>
  )
}

function Hero() {
  return (
    <section id="top" tabIndex={-1} aria-labelledby="hero-title" className={`${sectionClass} relative overflow-hidden`}>
      {/* A faint grid that fades out toward the edges. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)] opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(var(--v2-line) 1px, transparent 1px), linear-gradient(90deg, var(--v2-line) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
        }}
      />
      <div className={`${container} relative grid items-center gap-4 pt-10 pb-16 sm:pt-16 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pt-20 lg:pb-24`}>
        <div className="motion-safe:animate-[hero-in_900ms_cubic-bezier(0.22,1,0.36,1)_both]">
          <p className={`${mono} text-[var(--v2-muted)]`}>AI systems studio · Bangalore</p>
          <h1
            id="hero-title"
            className="mt-5 text-[2.6rem] leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-[3.6rem] lg:text-[4.25rem]"
          >
            AI that answers, follows up and gets work done.
          </h1>
          <p className="mt-6 max-w-xl text-[1.0625rem] leading-relaxed text-[var(--v2-muted)] sm:text-lg">
            We design, build and run voice agents, marketing and content engines, lead capture, automations and custom
            apps for growing businesses. You approve what they say. We keep them running.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <ContactButton />
            <SectionLink to="live" className={secondaryButton}>
              See it in action
            </SectionLink>
          </div>
        </div>
        <div className="relative -mx-4 h-[360px] sm:mx-0 sm:h-[460px] lg:h-[580px]">
          <InkSculpture />
          <p aria-hidden="true" className={`${mono} pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 text-[0.6875rem] text-[var(--v2-muted)]`}>
            Drag to turn
          </p>
        </div>
      </div>
    </section>
  )
}

// Bento placement on wide screens: two rows of two, then a full-width row.
const SPAN: Record<string, string> = {
  voice: 'lg:col-span-4',
  marketing: 'lg:col-span-2',
  content: 'lg:col-span-2',
  exhibition: 'lg:col-span-2',
  workflow: 'lg:col-span-2',
  apps: 'lg:col-span-6',
}

function Services() {
  return (
    <section id="services" tabIndex={-1} aria-labelledby="services-title" className={`${sectionClass} border-t border-[var(--v2-line)] py-20 sm:py-28`}>
      <div className={container}>
        <Reveal className="max-w-2xl">
          <p className={`${mono} text-[var(--v2-muted)]`}>Services</p>
          <h2 id="services-title" className={`${h2Class} mt-4`}>
            Six ways we take work off your plate.
          </h2>
        </Reveal>
        <ol className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {SERVICES.map((service, i) => {
            const wide = service.id === 'apps'
            return (
              <li key={service.id} className={SPAN[service.id]}>
                <Reveal delay={(i % 3) * 80} className="h-full">
                  <article
                    className={`group flex h-full flex-col gap-8 rounded-2xl border border-[var(--v2-line)] bg-[var(--v2-panel)] p-6 transition-colors duration-300 hover:border-[var(--v2-line-strong)] sm:p-7 ${
                      wide ? 'lg:flex-row lg:items-center lg:justify-between' : ''
                    }`}
                  >
                    <ServiceArt
                      art={service.id}
                      className={`h-16 text-[var(--v2-muted)] transition-colors duration-300 group-hover:text-[var(--v2-text)] [&_svg]:h-full [&_svg]:w-auto ${
                        wide ? 'lg:order-2 lg:h-20' : ''
                      }`}
                    />
                    <div className={wide ? 'lg:max-w-xl' : ''}>
                      <p className={`${mono} flex gap-3 text-[var(--v2-muted)]`}>
                        <span aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                        <span>{service.category}</span>
                      </p>
                      <h3 className="mt-3 text-[1.375rem] font-semibold tracking-[-0.02em]">{service.name}</h3>
                      <p className="mt-2 leading-relaxed text-[var(--v2-muted)]">{service.line}</p>
                    </div>
                  </article>
                </Reveal>
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}

const TIMELINE = [
  { when: '11:02 pm', what: 'New enquiry from the website form' },
  { when: '11:02 pm', what: 'WhatsApp reply sent, owner alerted' },
  { when: 'Day 1, 3, 7', what: 'Follow-ups go out on their own' },
  { when: 'Monday', what: 'Weekly report: enquiries, reply times, status' },
] as const

function Live() {
  return (
    <section id="live" tabIndex={-1} aria-labelledby="live-title" className={`${sectionClass} border-t border-[var(--v2-line)] py-20 sm:py-28`}>
      <div className={`${container} grid gap-12 lg:grid-cols-2 lg:items-center`}>
        <Reveal>
          <p className={`${mono} text-[var(--v2-muted)]`}>Ready today · Interior design studios</p>
          <h2 id="live-title" className={`${h2Class} mt-4`}>
            Every enquiry answered on WhatsApp in under a minute.
          </h2>
          <p className="mt-5 max-w-lg text-[1.0625rem] leading-relaxed text-[var(--v2-muted)]">
            Our Lead Leak Fix, built for interior design studios in Bangalore, replies instantly to every new enquiry,
            follows up on day 1, 3 and 7, alerts the owner and sends a weekly report. Try a sample form and watch it work.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/" className={primaryButton}>
              Try a live form
              <Arrow />
            </Link>
            <Link to="/home" className={secondaryButton}>
              See the studio page
            </Link>
          </div>
        </Reveal>
        <Reveal delay={120}>
          <ol aria-label="What happens to one enquiry" className="relative rounded-2xl border border-[var(--v2-line)] bg-[var(--v2-panel)] p-6 sm:p-8">
            {TIMELINE.map((step, i) => (
              <li key={step.what} className="relative flex gap-5 pb-7 last:pb-0">
                {i < TIMELINE.length - 1 && (
                  <span aria-hidden="true" className="absolute top-4 bottom-0 left-[5px] w-px bg-[var(--v2-line-strong)]" />
                )}
                <span
                  aria-hidden="true"
                  className={`relative mt-1.5 size-[11px] shrink-0 rounded-full border border-[var(--v2-text)] ${i < 2 ? 'bg-[var(--v2-text)]' : 'bg-[var(--v2-panel)]'}`}
                />
                <div>
                  <p className={`${mono} text-[var(--v2-muted)]`}>{step.when}</p>
                  <p className="mt-1 text-[1.0625rem]">{step.what}</p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>
      </div>
    </section>
  )
}

function Process() {
  return (
    <section id="process" tabIndex={-1} aria-labelledby="process-title" className={`${sectionClass} border-t border-[var(--v2-line)] py-20 sm:py-28`}>
      <div className={container}>
        <Reveal className="max-w-2xl">
          <p className={`${mono} text-[var(--v2-muted)]`}>How we work</p>
          <h2 id="process-title" className={`${h2Class} mt-4`}>
            From a free audit to a system that runs itself.
          </h2>
        </Reveal>
        <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-[var(--v2-line)] bg-[var(--v2-line)] sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => (
            <li key={step.title} className="bg-[var(--v2-bg)] p-6 sm:p-7">
              <Reveal delay={i * 80}>
                <p className={`${mono} text-[var(--v2-muted)]`}>Step {i + 1}</p>
                <h3 className="mt-6 text-[1.375rem] font-semibold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-2 leading-relaxed text-[var(--v2-muted)]">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Faq() {
  return (
    <section id="faq" tabIndex={-1} aria-labelledby="faq-title" className={`${sectionClass} border-t border-[var(--v2-line)] py-20 sm:py-28`}>
      <div className={`${container} grid gap-10 lg:grid-cols-[1fr_1.6fr]`}>
        <Reveal>
          <p className={`${mono} text-[var(--v2-muted)]`}>FAQ</p>
          <h2 id="faq-title" className={`${h2Class} mt-4`}>
            Questions we hear first.
          </h2>
        </Reveal>
        <Reveal delay={80}>
          <div className="border-t border-[var(--v2-line)]">
            {FAQ.map((item) => (
              <details key={item.q} className="group border-b border-[var(--v2-line)]">
                <summary
                  className={`flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 rounded-lg py-4 text-[1.0625rem] font-medium [&::-webkit-details-marker]:hidden ${focusRing}`}
                >
                  {item.q}
                  <span aria-hidden="true" className="relative size-4 shrink-0 text-[var(--v2-muted)]">
                    <span className="absolute top-1/2 left-0 h-px w-4 bg-current" />
                    <span className="absolute top-0 left-1/2 h-4 w-px bg-current transition-transform duration-300 group-open:scale-y-0" />
                  </span>
                </summary>
                <p className="max-w-2xl pb-6 leading-relaxed text-[var(--v2-muted)]">{item.a}</p>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Contact() {
  return (
    <section id="contact" tabIndex={-1} aria-labelledby="contact-title" className={`${sectionClass} border-t border-[var(--v2-line)] py-20 sm:py-28`}>
      <div className={container}>
        <Reveal className="relative overflow-hidden rounded-3xl border border-[var(--v2-line)] bg-[radial-gradient(ellipse_at_top,var(--v2-raised),var(--v2-panel)_70%)] px-6 py-16 text-center sm:px-12 sm:py-20">
          <h2 id="contact-title" className={`${h2Class} mx-auto max-w-2xl`}>
            Tell us where work gets stuck.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[1.0625rem] leading-relaxed text-[var(--v2-muted)]">
            Start with a free audit. In one call we find where leads, hours or money leak out, and you leave with a short
            plan whether or not you work with us.
          </p>
          <div className="mt-9 flex justify-center">
            <ContactButton />
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Footer() {
  const link = `inline-flex min-h-11 items-center rounded text-[var(--v2-muted)] transition-colors hover:text-[var(--v2-text)] ${focusRing}`
  return (
    <footer className="border-t border-[var(--v2-line)]">
      <div className={`${container} flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between`}>
        <div>
          <Wordmark />
          <p className="mt-3 text-sm text-[var(--v2-muted)]">AI agents, automation and custom apps. Bangalore, India.</p>
        </div>
        <ul className="flex flex-wrap gap-x-6 text-sm">
          <li>
            <SectionLink to="services" className={link}>
              Services
            </SectionLink>
          </li>
          <li>
            <Link to="/home" className={link}>
              For interior studios
            </Link>
          </li>
          <li>
            <span className="inline-flex min-h-11 items-center text-[var(--v2-muted)]">© 2026 Flow Systems</span>
          </li>
        </ul>
      </div>
    </footer>
  )
}

export default function HomeV2() {
  useEffect(() => {
    loadV2Fonts()
    document.title = 'Flow Systems · AI agents, automation and custom apps'
  }, [])

  return (
    <div
      style={tokens}
      className="min-h-dvh overflow-x-clip bg-[var(--v2-bg)] font-[family-name:var(--v2-sans)] text-[var(--v2-text)] antialiased selection:bg-[var(--v2-text)] selection:text-[var(--v2-bg)]"
    >
      <a
        href={sectionHref('main')}
        onClick={(e) => {
          e.preventDefault()
          scrollToSection('main')
        }}
        className={`sr-only z-50 rounded-full bg-[var(--v2-text)] px-4 py-3 text-[var(--v2-bg)] focus:not-sr-only focus:fixed focus:top-3 focus:left-3 ${focusRing}`}
      >
        Skip to content
      </a>
      <Nav />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <Services />
        <Live />
        <Process />
        <Faq />
        <Contact />
      </main>
      <Footer />
    </div>
  )
}
