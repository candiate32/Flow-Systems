import { useEffect } from 'react'
import { Link } from 'react-router'

export default function NotFound() {
  useEffect(() => {
    document.title = 'Form not found'
  }, [])
  return (
    <div className="flex min-h-dvh items-center justify-center bg-stone-50 px-4 py-12 text-stone-900">
      <main className="w-full max-w-md text-center">
        <p className="text-sm font-semibold tracking-[0.16em] text-stone-600 uppercase">Not found</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">We couldn't find that form</h1>
        <p className="mt-3 leading-relaxed text-stone-600">
          The link may have a typo, or the studio may have moved its enquiry form. If you were trying to reach an
          interior studio, message them on WhatsApp directly.
        </p>
        <Link
          to="/"
          className="mt-8 inline-flex min-h-12 items-center justify-center rounded-lg bg-stone-900 px-5 font-semibold text-white hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900"
        >
          See the demo studio's form
        </Link>
      </main>
    </div>
  )
}
