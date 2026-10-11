import { useState, type FormEvent } from 'react'
import { turnstileSiteKey, whatsappFallbackUrl } from '../lib/config'
import {
  BHK_OPTIONS,
  submitEnquiry,
  validateEnquiry,
  type EnquiryForm,
  type FieldErrors,
} from '../lib/enquiry'
import { Turnstile } from '../lib/Turnstile'

type Status = 'idle' | 'submitting' | 'success' | 'failed'

const FIELD_KEYS = ['name', 'phone', 'bhk', 'possession_month', 'consent']

const inputClass =
  'mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-base text-stone-900 shadow-sm focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/30'

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="mt-1 text-sm text-red-700">
      {message}
    </p>
  )
}

export default function Landing() {
  const [form, setForm] = useState<EnquiryForm>({
    name: '',
    phone: '',
    bhk: '',
    possessionMonth: '',
    consent: false,
  })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<Status>('idle')
  const [token, setToken] = useState<string | null>(null)
  const siteKey = turnstileSiteKey()

  function update<K extends keyof EnquiryForm>(key: K, value: EnquiryForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const clientErrors = validateEnquiry(form)
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length > 0) return
    setStatus('submitting')
    const result = await submitEnquiry(form, siteKey ? token : null)
    if (result.kind === 'success') setStatus('success')
    else if (result.kind === 'invalid') {
      setErrors(result.errors)
      setStatus('idle')
    } else setStatus('failed')
  }

  const otherErrors = Object.entries(errors).filter(([k]) => !FIELD_KEYS.includes(k))

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-xl items-center justify-between gap-3 px-4 py-3">
          <span className="font-semibold">Demo Interiors</span>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Demo
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-8">
        <h1 className="text-3xl font-semibold leading-tight">Demo Interiors, Sarjapur Road</h1>
        <p className="mt-2 text-stone-600">
          Modular kitchens, wardrobes and full-home interiors. Tell us about your home and we'll reply on
          WhatsApp in under a minute.
        </p>
        <p className="mt-2 text-sm text-stone-500">
          This is a demonstration studio run by Flow Systems, not a real business.
        </p>

        {status === 'success' ? (
          <section role="status" className="mt-8 rounded-xl border border-green-200 bg-green-50 p-5">
            <h2 className="text-lg font-semibold text-green-900">Thanks, check WhatsApp — you'll hear from us in under a minute.</h2>
          </section>
        ) : (
          <form noValidate onSubmit={onSubmit} className="mt-8 space-y-5 rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
            <div>
              <label htmlFor="name" className="text-sm font-medium">Name</label>
              <input
                id="name"
                name="name"
                autoComplete="name"
                maxLength={80}
                value={form.name}
                onChange={(e) => update('name', e.target.value)}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? 'name-error' : undefined}
                className={inputClass}
              />
              <FieldError id="name-error" message={errors.name} />
            </div>

            <div>
              <label htmlFor="phone" className="text-sm font-medium">WhatsApp number</label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="98765 43210"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
                aria-invalid={!!errors.phone}
                aria-describedby={errors.phone ? 'phone-error' : undefined}
                className={inputClass}
              />
              <FieldError id="phone-error" message={errors.phone} />
            </div>

            <div>
              <label htmlFor="bhk" className="text-sm font-medium">Home type</label>
              <select
                id="bhk"
                name="bhk"
                value={form.bhk}
                onChange={(e) => update('bhk', e.target.value)}
                aria-invalid={!!errors.bhk}
                className={inputClass}
              >
                <option value="">Select…</option>
                {BHK_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <FieldError id="bhk-error" message={errors.bhk} />
            </div>

            <div>
              <label htmlFor="possession_month" className="text-sm font-medium">Possession month</label>
              <input
                id="possession_month"
                name="possession_month"
                type="month"
                value={form.possessionMonth}
                onChange={(e) => update('possessionMonth', e.target.value)}
                aria-invalid={!!errors.possession_month}
                className={inputClass}
              />
              <FieldError id="possession_month-error" message={errors.possession_month} />
            </div>

            <div>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  name="consent"
                  required
                  checked={form.consent}
                  onChange={(e) => update('consent', e.target.checked)}
                  aria-invalid={!!errors.consent}
                  className="mt-0.5 h-5 w-5 rounded border-stone-300 accent-amber-700"
                />
                <span>I agree to be contacted on WhatsApp</span>
              </label>
              <FieldError id="consent-error" message={errors.consent} />
            </div>

            {siteKey && <Turnstile siteKey={siteKey} onToken={setToken} />}

            {otherErrors.map(([k, msg]) => (
              <p key={k} role="alert" className="text-sm text-red-700">{msg}</p>
            ))}

            {status === 'failed' && (
              <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
                <p>Something went wrong sending your enquiry.</p>
                <a
                  href={whatsappFallbackUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-block rounded-lg bg-green-600 px-4 py-2 font-semibold text-white"
                >
                  Chat on WhatsApp
                </a>
              </div>
            )}

            <button
              type="submit"
              disabled={status === 'submitting'}
              className="w-full rounded-lg bg-amber-700 px-4 py-3 text-base font-semibold text-white hover:bg-amber-800 disabled:opacity-60"
            >
              {status === 'submitting' ? 'Sending…' : 'Get a WhatsApp reply'}
            </button>
          </form>
        )}

        <section className="mt-6 text-xs leading-relaxed text-stone-500">
          <h2 className="font-semibold text-stone-600">Privacy</h2>
          <p className="mt-1">
            Demo Interiors collects your name, WhatsApp number, home type and possession month only to reply
            to your enquiry and follow up about your interiors. Flow Systems processes this data on the
            studio's behalf and stores it in India. To have your data deleted, message the studio on WhatsApp and
            ask; we will remove it.
          </p>
        </section>
      </main>
    </div>
  )
}
