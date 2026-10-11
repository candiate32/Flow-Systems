import { adminUrl } from '../lib/config'
import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'
import { formatIst, replySeconds } from '../lib/format'
import type { Lead } from '../lib/types'

const inputClass =
  'mt-1 block w-full rounded-lg border border-stone-300 bg-white px-3 py-3 text-base focus:border-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-600/30'
const buttonClass =
  'w-full rounded-lg bg-stone-900 px-4 py-3 font-semibold text-white hover:bg-stone-800 disabled:opacity-60'

function SignIn() {
  const supabase = getSupabase()!
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: adminUrl() },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setStep('code')
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' })
    setBusy(false)
    if (error) setError(error.message)
  }

  return (
    <div className="mx-auto mt-8 max-w-sm rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold">Sign in</h2>
      {step === 'email' ? (
        <form onSubmit={sendCode} className="mt-4 space-y-4">
          <div>
            <label htmlFor="email" className="text-sm font-medium">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} className={inputClass} />
          </div>
          <button type="submit" disabled={busy} className={buttonClass}>Email me a code</button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 space-y-4">
          <p className="text-sm text-stone-600">We sent a 6-digit code to {email}.</p>
          <div>
            <label htmlFor="code" className="text-sm font-medium">Code</label>
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
              required value={code} onChange={(e) => setCode(e.target.value)} className={inputClass} />
          </div>
          <button type="submit" disabled={busy} className={buttonClass}>Verify</button>
          <button type="button" onClick={() => { setStep('email'); setCode('') }}
            className="w-full text-sm text-stone-600 underline">Use a different email</button>
        </form>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </div>
  )
}

function LeadsTable() {
  const supabase = getSupabase()!
  const [leads, setLeads] = useState<Lead[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    supabase
      .from('leads')
      .select('id, name, phone_e164, bhk, created_at, first_auto_reply_at')
      .order('created_at', { ascending: false })
      .limit(500)
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setLeads((data ?? []) as Lead[])
      })
    return () => {
      cancelled = true
    }
  }, [supabase])

  if (error) return <p role="alert" className="mt-6 text-sm text-red-700">Could not load leads: {error}</p>
  if (!leads) return <p className="mt-6 text-sm text-stone-500">Loading leads…</p>
  if (leads.length === 0) return <p className="mt-6 text-sm text-stone-500">No leads yet.</p>

  return (
    <div className="mt-6 overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-stone-100 text-xs uppercase tracking-wide text-stone-600">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Phone</th>
            <th className="px-3 py-2">BHK</th>
            <th className="px-3 py-2">Created (IST)</th>
            <th className="px-3 py-2 text-right">Reply (s)</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} className="border-t border-stone-100">
              <td className="px-3 py-2">{lead.name}</td>
              <td className="whitespace-nowrap px-3 py-2">{lead.phone_e164}</td>
              <td className="px-3 py-2">{lead.bhk ?? '—'}</td>
              <td className="whitespace-nowrap px-3 py-2">{formatIst(lead.created_at)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{replySeconds(lead)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Admin() {
  const supabase = getSupabase()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [supabase])

  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Leads</h1>
          {session && supabase && (
            <button type="button" onClick={() => supabase.auth.signOut()}
              className="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium">
              Sign out
            </button>
          )}
        </div>
        {!supabase ? (
          <p role="alert" className="mt-6 text-sm text-red-700">
            Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
          </p>
        ) : !ready ? (
          <p className="mt-6 text-sm text-stone-500">Loading…</p>
        ) : session ? (
          <>
            <p className="mt-1 text-sm text-stone-500">Signed in as {session.user.email}</p>
            <LeadsTable />
          </>
        ) : (
          <SignIn />
        )}
      </main>
    </div>
  )
}
