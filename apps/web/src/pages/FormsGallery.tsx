import { useEffect } from 'react'
import { Link } from 'react-router'
import { FormRenderer } from '../forms/components/FormRenderer'
import { FORM_CONFIGS } from '../forms/configs'
import { THEMES } from '../forms/themes'

const LAYOUT_NAMES = { card: 'Card', split: 'Split', minimal: 'Minimal' } as const

/** `/forms`: a live preview of every registered studio form, for showing prospects. Nothing here submits. */
export default function FormsGallery() {
  useEffect(() => {
    document.title = 'Enquiry form gallery'
  }, [])
  return (
    <div className="min-h-dvh bg-stone-100 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <p className="text-xs font-semibold tracking-[0.16em] text-stone-600 uppercase">Flow Systems</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Enquiry form gallery</h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-stone-600">
            Every studio form we can set up from a config, shown live. Try the fields, the errors and the success
            screen: these are previews, so nothing is ever sent.
          </p>
          <nav aria-label="Forms in this gallery" className="mt-6 flex flex-wrap gap-2">
            {FORM_CONFIGS.map((c) => (
              <a
                key={c.slug}
                href={`#preview-${c.slug}`}
                onClick={(e) => {
                  // Scroll without touching the URL hash, which hash routing uses for the route.
                  e.preventDefault()
                  document.getElementById(`preview-${c.slug}`)?.scrollIntoView({ behavior: 'smooth' })
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-stone-300 bg-white px-4 text-sm font-medium hover:border-stone-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
              >
                {c.studio.name}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        {FORM_CONFIGS.map((config) => (
          <section key={config.slug} id={`preview-${config.slug}`} aria-labelledby={`gallery-${config.slug}`} className="scroll-mt-6">
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
              <div>
                <h2 id={`gallery-${config.slug}`} className="text-xl font-semibold">
                  {config.studio.name}, {config.studio.area}
                </h2>
                <p className="mt-1 text-sm text-stone-600">
                  {THEMES[config.theme.preset].label} theme · {LAYOUT_NAMES[config.layout]} layout ·{' '}
                  {config.fields.length} fields
                </p>
              </div>
              <Link
                to={`/f/${config.slug}`}
                className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-stone-900 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
              >
                Open full page<span aria-hidden="true">→</span>
              </Link>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-stone-300 shadow-sm">
              <FormRenderer config={config} preview />
            </div>
          </section>
        ))}
      </main>
    </div>
  )
}
