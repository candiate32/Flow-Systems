import { useEffect, useState, type CSSProperties, type MouseEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { loadThemeFonts, SHARED_TYPE } from '../forms/themes'
import { BrandMark } from '../home/BrandMark'
import { auditWhatsappLink, WHY } from '../home/content'
import { DesignPicker } from '../home/DesignPicker'
import { HeroExchange } from '../home/HeroExchange'
import { chevronLink, container, eyebrow, filledButton, focus, lead, material, sectionTitle, tile, wide } from '../home/hig'
import { HowItWorks } from '../home/HowItWorks'
import { scrollToSection, sectionHref } from '../home/motion'
import { Reveal } from '../home/Reveal'

/** Inter stands in for SF Pro on devices that don't have it. */
const INTER_HREF = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap'

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

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 8 14" className="mt-px h-3 w-2 fill-none stroke-current stroke-[1.75] transition-transform group-hover/link:translate-x-0.5">
      <path d="m1.5 1.5 5 5.5-5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="text-[1.0625rem] font-semibold tracking-[-0.02em] text-hig-ink">Flow Systems</span>
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

  const link = `inline-flex min-h-11 items-center px-3 text-[0.8125rem] tracking-[-0.01em] text-hig-ink/80 transition-colors hover:text-hig-ink ${focus}`
  return (
    <header
      className={`sticky top-0 z-40 border-b transition-[background-color,border-color] duration-300 ${
        scrolled ? `border-black/10 ${material}` : 'border-transparent bg-white'
      }`}
    >
      <div className={`${wide} flex h-12 items-center gap-2`}>
        <SectionLink to="top" className={`-ml-1 inline-flex min-h-11 items-center rounded-lg px-1 ${focus}`}>
          <Wordmark />
          <span className="sr-only">, back to top</span>
        </SectionLink>
        <nav aria-label="On this page" className="ml-auto hidden sm:block">
          <ul className="flex items-center">
            <li>
              <SectionLink to="forms" className={link}>
                Forms
              </SectionLink>
            </li>
            <li>
              <SectionLink to="how" className={link}>
                How it works
              </SectionLink>
            </li>
          </ul>
        </nav>
        <SectionLink to="audit" className={`group ml-auto inline-flex min-h-11 items-center rounded-full sm:ml-2 ${focus}`}>
          <span className="rounded-full bg-hig-tint px-3.5 py-1.5 text-[0.8125rem] font-medium text-white transition-colors group-hover:bg-hig-tint-bright">
            Free audit
          </span>
        </SectionLink>
      </div>
    </header>
  )
}

const HERO_POINTS = ['Set up in about 7 days', 'Same WhatsApp app for your team', 'Lead data stays in India']

function Hero({ auditLink }: { auditLink: string | null }) {
  const rise = 'motion-safe:animate-[hero-in_900ms_cubic-bezier(0.22,1,0.36,1)_both]'
  return (
    <section id="top" tabIndex={-1} className="scroll-mt-12 overflow-x-clip bg-white pt-14 pb-24 outline-none sm:pt-20 sm:pb-32">
      <div className={`${container} text-center`}>
        <p className={`${eyebrow} ${rise}`}>For interior design studios in Bangalore</p>
        <h1
          style={{ animationDelay: '80ms' }}
          className={`mx-auto mt-3 max-w-4xl text-[2.75rem] leading-[1.05] font-semibold tracking-[-0.035em] text-balance text-hig-ink sm:text-[4rem] lg:text-[5rem] ${rise}`}
        >
          Every enquiry answered{' '}
          <span className="bg-linear-to-r from-hig-tint to-hig-tint-bright bg-clip-text text-transparent">in under a minute.</span>
        </h1>
        <p style={{ animationDelay: '160ms' }} className={`${lead} mx-auto mt-6 max-w-2xl ${rise}`}>
          Flow Systems replies to every new enquiry on WhatsApp in your studio's name, follows up until the homeowner
          answers, and shows you where every lead stands. Fully managed, on the WhatsApp Business number you already use.
        </p>
        <div style={{ animationDelay: '240ms' }} className={`mt-8 flex flex-col items-center justify-center gap-x-7 gap-y-2 sm:flex-row ${rise}`}>
          {auditLink ? (
            <>
              <a href={auditLink} target="_blank" rel="noopener noreferrer" className={filledButton}>
                Get a free Enquiry Leak Audit
              </a>
              <SectionLink to="forms" className={chevronLink}>
                Try a live form <Chevron />
              </SectionLink>
            </>
          ) : (
            <>
              <SectionLink to="forms" className={filledButton}>
                Try a live form
              </SectionLink>
              <SectionLink to="how" className={chevronLink}>
                See how it works <Chevron />
              </SectionLink>
            </>
          )}
        </div>
        <ul
          style={{ animationDelay: '320ms' }}
          className={`mt-7 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[0.875rem] tracking-[-0.01em] text-hig-ink-2 ${rise}`}
        >
          {HERO_POINTS.map((item) => (
            <li key={item} className="flex items-center gap-1.5">
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 fill-none stroke-hig-tint stroke-2">
                <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {item}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-16 px-5 sm:mt-20">
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
    <section aria-labelledby="why-title" className="bg-hig-fill py-24 sm:py-32">
      <Reveal className={`${container} text-center`}>
        <p className={eyebrow}>Why it matters</p>
        <h2 id="why-title" className="mx-auto mt-3 max-w-4xl text-[2rem] leading-[1.12] font-semibold tracking-[-0.03em] text-balance sm:text-[3rem]">
          <span className="text-hig-ink">Homeowners message several studios at once.</span>{' '}
          <span className="text-hig-ink-2">The one that replies first, and keeps following up, often gets the site visit.</span>
        </h2>
      </Reveal>
      <ul className={`${wide} mt-14 grid gap-4 sm:mt-16 md:grid-cols-3 lg:gap-5`}>
        {WHY.map((item, i) => (
          <li key={item.title}>
            <Reveal delay={i * 100} className="h-full">
              <div className={`h-full p-8 sm:p-9 ${tile}`}>
                <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-hig-tint-soft text-hig-tint">
                  <svg viewBox="0 0 24 24" className="size-6 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]">
                    {WHY_ICONS[i]}
                  </svg>
                </span>
                <h3 className="mt-6 text-[1.5rem] leading-tight font-semibold tracking-[-0.02em] text-hig-ink">{item.title}</h3>
                <p className="mt-2 text-[1.0625rem] leading-[1.47] tracking-[-0.01em] text-hig-ink-2">{item.body}</p>
              </div>
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Forms() {
  return (
    <section id="forms" tabIndex={-1} aria-labelledby="forms-title" className="scroll-mt-12 bg-white pt-24 pb-24 outline-none sm:pt-32 sm:pb-32">
      <Reveal className={`${container} text-center`}>
        <p className={eyebrow}>Your enquiry form</p>
        <h2 id="forms-title" className={`${sectionTitle} mt-2 text-hig-ink`}>
          A form that looks like your studio.
        </h2>
        <p className={`${lead} mx-auto mt-5 max-w-2xl`}>
          Every studio gets its own enquiry form, in its own colours, asking the questions it cares about. Switch between
          three sample designs below. Each one is live and wired to the same engine, so go ahead and send one.
        </p>
      </Reveal>
      <div className={`${wide} mt-10 sm:mt-12`}>
        <DesignPicker />
      </div>
    </section>
  )
}

function Audit({ auditLink }: { auditLink: string | null }) {
  const button = [
    'inline-flex min-h-11 items-center justify-center rounded-full bg-white px-6 py-2.5 text-[1.0625rem] font-medium tracking-[-0.01em] text-hig-ink',
    'transition-[background-color,scale] hover:bg-white/90 active:scale-[0.97]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
  ].join(' ')
  return (
    <section id="audit" tabIndex={-1} aria-labelledby="audit-title" className="scroll-mt-12 bg-hig-fill pb-24 outline-none sm:pb-32">
      <div className={wide}>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-hig-ink px-6 py-20 text-center sm:px-12 sm:py-28">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 -top-1/2 h-full bg-[radial-gradient(closest-side,rgb(43_122_107/0.55),transparent)] blur-2xl"
            />
            <div className="relative mx-auto max-w-2xl">
              <p className="text-[1.0625rem] font-semibold tracking-[-0.01em] text-hig-mint">Free Enquiry Leak Audit</p>
              <h2 id="audit-title" className={`${sectionTitle} mt-2 text-white`}>
                How fast does your studio really reply?
              </h2>
              <p className="mt-5 text-[1.1875rem] leading-[1.45] tracking-[-0.01em] text-pretty text-[#A1A1A6] sm:text-[1.3125rem]">
                We send your studio a test enquiry, then show you how quickly it was answered and followed up. It's free,
                and there's nothing to set up.
              </p>
              <div className="mt-9">
                {auditLink ? (
                  <a href={auditLink} target="_blank" rel="noopener noreferrer" className={button}>
                    Book your free audit on WhatsApp
                  </a>
                ) : (
                  <SectionLink to="forms" className={button}>
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
    <footer className="bg-hig-fill">
      <div className={wide}>
        <div className="flex flex-col gap-4 border-t border-black/10 py-8 text-[0.8125rem] leading-[1.5] text-hig-ink-2 sm:flex-row sm:items-center sm:justify-between">
          <Wordmark />
          <p className="max-w-md">
            Enquiry handling and follow-up for interior design studios in Bangalore. Lead data is stored in India and
            deleted on request.
          </p>
          <Link to="/" className={`group/link inline-flex min-h-11 items-center gap-1 text-hig-tint hover:underline hover:underline-offset-4 ${focus}`}>
            All sample forms, full screen <Chevron />
          </Link>
        </div>
      </div>
    </footer>
  )
}

/** `/home`: what Flow Systems is and does, with the sample forms built in. Apple's design language throughout. */
export default function Home() {
  const auditLink = auditWhatsappLink()
  // Clears the nav and the pinned design picker for a sample form's own sticky column.
  const rootStyle = { '--ff-sticky-top': '9.5rem' } as CSSProperties

  useEffect(() => {
    loadThemeFonts(INTER_HREF)
    loadThemeFonts(SHARED_TYPE.fontHref)
    document.title = 'Flow Systems · Every enquiry answered in under a minute'
    if (window.scrollY > 0) window.scrollTo({ top: 0 })
  }, [])

  return (
    <div style={rootStyle} className="min-h-dvh bg-white font-hig text-hig-ink antialiased [font-optical-sizing:auto]">
      <Nav />
      <main>
        <Hero auditLink={auditLink} />
        <Why />
        <Forms />
        <HowItWorks />
        <Audit auditLink={auditLink} />
      </main>
      <Footer />
    </div>
  )
}
