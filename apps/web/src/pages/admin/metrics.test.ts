import { describe, expect, it } from 'vitest'
import { enquiryAt, formatDuration, formatPercent, istWeekStart, secondsToFirstHumanReply, weekLabel } from './metrics'

describe('istWeekStart', () => {
  it('is the Monday of the IST week', () => {
    expect(istWeekStart(new Date('2026-10-14T06:00:00Z'))).toBe('2026-10-12') // Wednesday
  })

  it('Sunday 23:59:59 IST is still the week that is ending', () => {
    expect(istWeekStart(new Date('2026-10-11T18:29:59Z'))).toBe('2026-10-05')
  })

  it('Monday 00:00 IST starts the next week, though it is still Sunday in UTC', () => {
    expect(istWeekStart(new Date('2026-10-11T18:30:00Z'))).toBe('2026-10-12')
  })

  it('crosses months and years', () => {
    expect(istWeekStart(new Date('2026-01-01T12:00:00Z'))).toBe('2025-12-29')
  })
})

describe('weekLabel', () => {
  it('names Monday to Sunday', () => {
    expect(weekLabel('2026-10-12')).toBe('12–18 Oct 2026')
    expect(weekLabel('2026-09-28')).toBe('28 Sep – 4 Oct 2026')
    expect(weekLabel('2025-12-29')).toBe('29 Dec 2025 – 4 Jan 2026')
  })
})

describe('secondsToFirstHumanReply', () => {
  const base = { created_at: '2026-10-12T04:30:00Z', last_enquiry_at: '2026-10-12T04:30:00Z' }

  it('is the time from the enquiry to the first human reply', () => {
    expect(secondsToFirstHumanReply({ ...base, first_human_reply_at: '2026-10-12T04:34:10Z' })).toBe(250)
  })

  it('is null without a reply', () => {
    expect(secondsToFirstHumanReply({ ...base, first_human_reply_at: null })).toBeNull()
  })

  it('counts from the first enquiry, not a later repeat', () => {
    const lead = { ...base, last_enquiry_at: '2026-10-14T04:30:00Z', first_human_reply_at: '2026-10-12T05:30:00Z' }
    expect(enquiryAt(lead).toISOString()).toBe('2026-10-12T04:30:00.000Z')
    expect(secondsToFirstHumanReply(lead)).toBe(3600)
  })

  it('counts a WhatsApp-first lead from its message, which is earlier than the row', () => {
    const lead = {
      created_at: '2026-10-12T04:30:03Z',
      last_enquiry_at: '2026-10-12T04:30:00Z',
      first_human_reply_at: '2026-10-12T04:31:00Z',
    }
    expect(secondsToFirstHumanReply(lead)).toBe(60)
  })

  it('ignores a reply recorded before the enquiry', () => {
    expect(secondsToFirstHumanReply({ ...base, first_human_reply_at: '2026-10-12T04:00:00Z' })).toBeNull()
  })
})

describe('formatting', () => {
  it('formats durations', () => {
    expect([null, 0.4, 7.4, 60, 250, 2700, 3600, 3900, 183_700].map(formatDuration)).toEqual([
      '—', '<1s', '7s', '1m', '4m 10s', '45m', '1h', '1h 5m', '2d 3h',
    ])
  })

  it('formats percentages', () => {
    expect([null, 60, 33.3, 0].map(formatPercent)).toEqual(['—', '60%', '33.3%', '0%'])
  })
})
