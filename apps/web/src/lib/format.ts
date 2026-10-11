import type { Lead } from './types'

const istFormat = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
})

/** Format a UTC timestamp for display in IST. */
export function formatIst(iso: string): string {
  return `${istFormat.format(new Date(iso))} IST`
}

/** Seconds from created_at to first_auto_reply_at, or an em dash when not replied yet. */
export function replySeconds(lead: Pick<Lead, 'created_at' | 'first_auto_reply_at'>): string {
  if (!lead.first_auto_reply_at) return '—'
  const ms = new Date(lead.first_auto_reply_at).getTime() - new Date(lead.created_at).getTime()
  return String(Math.max(0, Math.round(ms / 1000)))
}
