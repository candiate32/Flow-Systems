// Response-time numbers for the admin page (spec 004, D.3). The weekly numbers
// come from the lead_response_weekly view; per-lead times are computed here
// with the same rules as the lead_response_metrics view
// (supabase/migrations/20261016120000_response_metrics.sql).
import type { Lead } from '../../lib/types'

/** IST is UTC+05:30 all year. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000
const DAY_MS = 86_400_000

/** One org's row of the lead_response_weekly view. */
export type WeeklyNumbers = {
  org_id: string
  week_start: string
  lead_count: number
  auto_replied_count: number
  median_seconds_to_auto_reply: number | null
  p90_seconds_to_auto_reply: number | null
  human_replied_count: number
  median_seconds_to_first_human_reply: number | null
  human_reply_within_1h_count: number
  pct_human_reply_within_1h: number | null
  replied_by_lead_count: number
}

/** The lead fields the admin list reads, beyond the shared Lead type. */
export type AdminLead = Lead & {
  last_enquiry_at: string
  first_human_reply_at: string | null
}

/** Monday (YYYY-MM-DD) of the IST week that `now` falls in. Weeks run Monday 00:00 to Sunday 23:59:59 IST. */
export function istWeekStart(now: Date): string {
  const ist = new Date(now.getTime() + IST_OFFSET_MS)
  const daysSinceMonday = (ist.getUTCDay() + 6) % 7
  const monday = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysSinceMonday))
  return monday.toISOString().slice(0, 10)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "12–18 Oct 2026", "28 Sep – 4 Oct 2026", "29 Dec 2025 – 4 Jan 2026". */
export function weekLabel(weekStart: string): string {
  const start = new Date(`${weekStart}T00:00:00Z`)
  const end = new Date(start.getTime() + 6 * DAY_MS)
  const d = (x: Date) => x.getUTCDate()
  const m = (x: Date) => MONTHS[x.getUTCMonth()]
  const y = (x: Date) => x.getUTCFullYear()
  if (y(start) !== y(end)) return `${d(start)} ${m(start)} ${y(start)} – ${d(end)} ${m(end)} ${y(end)}`
  if (m(start) !== m(end)) return `${d(start)} ${m(start)} – ${d(end)} ${m(end)} ${y(end)}`
  return `${d(start)}–${d(end)} ${m(end)} ${y(end)}`
}

/** The lead's first enquiry: the earlier of created_at and last_enquiry_at, as in the view. */
export function enquiryAt(lead: Pick<AdminLead, 'created_at' | 'last_enquiry_at'>): Date {
  return new Date(Math.min(new Date(lead.created_at).getTime(), new Date(lead.last_enquiry_at).getTime()))
}

/** Seconds from the first enquiry to `at`; null without `at` or when it is before the enquiry (not a reply to it). */
function secondsFromEnquiry(lead: Pick<AdminLead, 'created_at' | 'last_enquiry_at'>, at: string | null): number | null {
  if (!at) return null
  const ms = new Date(at).getTime() - enquiryAt(lead).getTime()
  return ms < 0 ? null : ms / 1000
}

/** Seconds from the first enquiry to the first auto-reply, as seconds_to_auto_reply in the view. */
export function secondsToAutoReply(
  lead: Pick<AdminLead, 'created_at' | 'last_enquiry_at' | 'first_auto_reply_at'>,
): number | null {
  return secondsFromEnquiry(lead, lead.first_auto_reply_at)
}

/**
 * Seconds from the first enquiry to the first human reply, or null when there
 * is none yet. A reply recorded before the enquiry is not a reply to it (null).
 */
export function secondsToFirstHumanReply(
  lead: Pick<AdminLead, 'created_at' | 'last_enquiry_at' | 'first_human_reply_at'>,
): number | null {
  return secondsFromEnquiry(lead, lead.first_human_reply_at)
}

/** "<1s", "7s", "4m 10s", "1h 5m", "2d 3h"; an em dash when there is no value. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—'
  if (seconds < 1) return '<1s'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const join = (a: number, ua: string, b: number, ub: string) => (b ? `${a}${ua} ${b}${ub}` : `${a}${ua}`)
  if (s < 3600) return join(Math.floor(s / 60), 'm', s % 60, 's')
  const m = Math.round(s / 60)
  if (m < 24 * 60) return join(Math.floor(m / 60), 'h', m % 60, 'm')
  const h = Math.round(s / 3600)
  return join(Math.floor(h / 24), 'd', h % 24, 'h')
}

/** "60%", "33.3%"; an em dash when there were no leads. */
export function formatPercent(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '—'
  return `${Number(pct.toFixed(1))}%`
}
