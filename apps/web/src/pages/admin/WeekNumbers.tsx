import { useEffect, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatDuration, formatPercent, istWeekStart, weekLabel, type WeeklyNumbers } from './metrics'

type Org = { id: string; name: string }
type Loaded = { orgs: Org[]; rows: WeeklyNumbers[] }

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <dt className="text-xs text-stone-500">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value}</dd>
      {note && <dd className="text-xs text-stone-500">{note}</dd>}
    </div>
  )
}

function OrgNumbers({ org, row, showName }: { org: Org; row: WeeklyNumbers | undefined; showName: boolean }) {
  const n = row?.lead_count ?? 0
  return (
    <div className="mt-3">
      {showName && <h3 className="text-sm font-medium text-stone-700">{org.name}</h3>}
      <dl aria-label={`This week's numbers for ${org.name}`} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Enquiries" value={String(n)} />
        <Stat
          label="Auto-reply (median)"
          value={formatDuration(row?.median_seconds_to_auto_reply ?? null)}
          note={`90% within ${formatDuration(row?.p90_seconds_to_auto_reply ?? null)}`}
        />
        <Stat
          label="Team first reply (median)"
          value={formatDuration(row?.median_seconds_to_first_human_reply ?? null)}
          note={`${row?.human_replied_count ?? 0} of ${n} replied`}
        />
        <Stat
          label="Team reply within 1 hour"
          value={formatPercent(row?.pct_human_reply_within_1h ?? null)}
          note={`${row?.human_reply_within_1h_count ?? 0} of ${n}`}
        />
      </dl>
    </div>
  )
}

/**
 * This week's response-time numbers (Monday to Sunday, IST) for each org the
 * signed-in member belongs to, from the lead_response_weekly view. Reads with
 * the member's session, so row-level security limits it to their orgs.
 */
export default function WeekNumbers({ supabase }: { supabase: SupabaseClient }) {
  const [weekStart] = useState(() => istWeekStart(new Date()))
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      supabase.from('orgs').select('id, name').order('name'),
      supabase
        .from('lead_response_weekly')
        .select(
          'org_id, week_start, lead_count, auto_replied_count, median_seconds_to_auto_reply, p90_seconds_to_auto_reply, ' +
            'human_replied_count, median_seconds_to_first_human_reply, human_reply_within_1h_count, ' +
            'pct_human_reply_within_1h, replied_by_lead_count',
        )
        .eq('week_start', weekStart),
    ]).then(([orgs, weekly]) => {
      if (cancelled) return
      const err = orgs.error ?? weekly.error
      if (err) setError(err.message)
      else setData({ orgs: (orgs.data ?? []) as Org[], rows: (weekly.data ?? []) as unknown as WeeklyNumbers[] })
    })
    return () => {
      cancelled = true
    }
  }, [supabase, weekStart])

  return (
    <section aria-labelledby="this-week" className="mt-6">
      <h2 id="this-week" className="text-lg font-semibold">
        This week <span className="text-sm font-normal text-stone-500">{weekLabel(weekStart)} (IST)</span>
      </h2>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-700">Could not load this week's numbers: {error}</p>
      ) : !data ? (
        <p className="mt-2 text-sm text-stone-500">Loading this week's numbers…</p>
      ) : data.orgs.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">No studio linked to this account.</p>
      ) : (
        data.orgs.map((org) => (
          <OrgNumbers
            key={org.id}
            org={org}
            row={data.rows.find((r) => r.org_id === org.id)}
            showName={data.orgs.length > 1}
          />
        ))
      )}
    </section>
  )
}
