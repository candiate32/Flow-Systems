import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { AdminLead, WeeklyNumbers } from './admin/metrics'

const ORG = '00000000-0000-4000-8000-000000000001'

const leads: AdminLead[] = [
  {
    id: '1',
    name: 'Asha Rao',
    phone_e164: '+919876543210',
    bhk: '3BHK',
    created_at: '2026-10-11T04:30:00.000Z',
    last_enquiry_at: '2026-10-11T04:30:00.000Z',
    first_auto_reply_at: '2026-10-11T04:30:07.400Z',
    first_human_reply_at: '2026-10-11T04:34:10.000Z',
    details: { budget_band: '₹8–15L', scope: 'Full home' },
  },
  {
    id: '2',
    name: 'Ravi Kumar',
    phone_e164: '+919812345678',
    bhk: null,
    created_at: '2026-10-10T18:45:00.000Z',
    last_enquiry_at: '2026-10-10T18:45:00.000Z',
    first_auto_reply_at: null,
    first_human_reply_at: null,
    details: {},
  },
]

const week: WeeklyNumbers = {
  org_id: ORG,
  week_start: '2026-10-12',
  lead_count: 5,
  auto_replied_count: 5,
  median_seconds_to_auto_reply: 20,
  p90_seconds_to_auto_reply: 76,
  human_replied_count: 4,
  median_seconds_to_first_human_reply: 2700,
  human_reply_within_1h_count: 3,
  pct_human_reply_within_1h: 60,
  replied_by_lead_count: 1,
}

type Result = { data: unknown; error: { message: string } | null }

const mocks = vi.hoisted(() => {
  const results: Record<string, Result> = {}
  const calls: { table: string; method: string; args: unknown[] }[] = []
  /** A chainable PostgREST-like query that resolves to results[table]. */
  function query(table: string) {
    const q: Record<string, unknown> = {}
    for (const method of ['select', 'order', 'limit', 'eq']) {
      q[method] = (...args: unknown[]) => {
        calls.push({ table, method, args })
        return q
      }
    }
    q.then = (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(ok, fail)
    return q
  }
  const client = {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn((table: string) => query(table)),
  }
  return { client, results, calls }
})

vi.mock('../lib/supabase', () => ({ getSupabase: () => mocks.client }))

function setup(session: unknown, overrides: Partial<Record<string, Result>> = {}) {
  // Wednesday 14 Oct 2026, 11:30 IST: this week is Monday 12 to Sunday 18 October.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-14T06:00:00Z'))
  mocks.client.auth.getSession.mockResolvedValue({ data: { session } })
  Object.assign(mocks.results, {
    leads: { data: leads, error: null },
    orgs: { data: [{ id: ORG, name: 'Lime & Lattice' }], error: null },
    lead_response_weekly: { data: [week], error: null },
    ...overrides,
  })
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <App />
    </MemoryRouter>,
  )
}

const callsTo = (table: string, method: string) =>
  mocks.calls.filter((c) => c.table === table && c.method === method).map((c) => c.args)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.calls.length = 0
  for (const k of Object.keys(mocks.results)) delete mocks.results[k]
})

describe('admin page', () => {
  it('renders lead rows with IST times, auto-reply seconds and time to first human reply', async () => {
    setup({ user: { email: 'owner@example.com' } })
    const table = await screen.findByRole('table')
    expect(mocks.client.from).toHaveBeenCalledWith('leads')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)
    const headers = within(table).getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers.slice(-2)).toEqual(['Auto-reply', 'Team reply'])

    const first = within(rows[0]).getAllByRole('cell').map((c) => c.textContent)
    expect(first[0]).toMatch(/^Asha Rao/)
    expect(first[1]).toBe('+919876543210')
    expect(first[2]).toBe('3BHK')
    expect(first[3]).toMatch(/11 Oct 2026/)
    expect(first[3]).toMatch(/10:00/)
    expect(first[4]).toBe('7s')
    expect(first[5]).toBe('4m 10s')
    const [select] = callsTo('leads', 'select')
    expect(select[0]).toEqual(expect.stringContaining('details'))
    expect(select[0]).toEqual(expect.stringContaining('first_human_reply_at'))
    expect(select[0]).toEqual(expect.stringContaining('last_enquiry_at'))
    const details = within(rows[0]).getByLabelText('Details')
    expect(details.textContent).toBe('Budget band₹8–15LScopeFull home')
    expect(within(rows[1]).queryByLabelText('Details')).toBeNull()

    const second = within(rows[1]).getAllByRole('cell').map((c) => c.textContent)
    expect(second[0]).toMatch(/^Ravi Kumar/)
    expect(second[3]).toMatch(/11 Oct 2026/) // 18:45 UTC is 00:15 IST the next day
    expect(second[4]).toBe('—')
    expect(second[5]).toBe('—')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.client.auth.signOut).toHaveBeenCalled()
  })

  it('shows a WhatsApp-first lead from its message time, as the metrics view counts it', async () => {
    const whatsappFirst: AdminLead = {
      id: '3',
      name: 'Meera N',
      phone_e164: '+919845012345',
      bhk: null,
      // Wrote Sunday 11 Oct 23:59 IST; the webhook created the row 2 minutes later (Monday IST).
      created_at: '2026-10-11T18:31:00.000Z',
      last_enquiry_at: '2026-10-11T18:29:00.000Z',
      first_auto_reply_at: '2026-10-11T18:31:05.000Z',
      first_human_reply_at: '2026-10-11T18:28:00.000Z', // a staff message from before the enquiry
      details: {},
    }
    setup({ user: { email: 'owner@example.com' } }, { leads: { data: [whatsappFirst], error: null } })
    const table = await screen.findByRole('table')
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toContain('Enquiry (IST)')
    const [row] = within(table).getAllByRole('row').slice(1)
    const cells = within(row).getAllByRole('cell').map((c) => c.textContent)
    expect(cells[3]).toMatch(/11 Oct 2026/)
    expect(cells[3]).toMatch(/11:59/)
    expect(cells[4]).toBe('2m 5s') // 125 s from the message, not 5 s from the row
    expect(cells[5]).toBe('—') // a reply before the enquiry is not a reply to it
  })

  it("shows this week's numbers (IST week) above the lead list", async () => {
    setup({ user: { email: 'owner@example.com' } })
    const section = await screen.findByRole('region', { name: /This week/ })
    expect(section.textContent).toContain('12–18 Oct 2026 (IST)')
    expect(callsTo('lead_response_weekly', 'eq')).toEqual([['week_start', '2026-10-12']])

    const numbers = await within(section).findByLabelText("This week's numbers for Lime & Lattice")
    const stat = (label: string) => within(numbers).getByText(label).parentElement!.textContent
    expect(stat('Enquiries')).toBe('Enquiries5')
    expect(stat('Auto-reply (median)')).toBe('Auto-reply (median)20s90% within 1m 16s')
    expect(stat('Team first reply (median)')).toBe('Team first reply (median)45m4 of 5 replied')
    expect(stat('Team reply within 1 hour')).toBe('Team reply within 1 hour60%3 of 5')

    // Above the lead list.
    const table = await screen.findByRole('table')
    expect(section.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows zeros and dashes for an org with no enquiries yet this week', async () => {
    setup({ user: { email: 'owner@example.com' } }, { lead_response_weekly: { data: [], error: null } })
    const numbers = await screen.findByLabelText("This week's numbers for Lime & Lattice")
    expect(within(numbers).getByText('Enquiries').parentElement!.textContent).toBe('Enquiries0')
    expect(within(numbers).getByText('Team reply within 1 hour').parentElement!.textContent).toBe(
      'Team reply within 1 hour—0 of 0',
    )
  })

  it('names each org when the member belongs to more than one', async () => {
    setup(
      { user: { email: 'owner@example.com' } },
      {
        orgs: { data: [{ id: ORG, name: 'Lime & Lattice' }, { id: 'other', name: 'Haveli Works' }], error: null },
      },
    )
    expect(await screen.findByRole('heading', { name: 'Haveli Works' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Lime & Lattice' })).toBeTruthy()
    const other = screen.getByLabelText("This week's numbers for Haveli Works")
    expect(within(other).getByText('Enquiries').parentElement!.textContent).toBe('Enquiries0')
  })

  it("reports an error loading this week's numbers without hiding the lead list", async () => {
    setup(
      { user: { email: 'owner@example.com' } },
      { lead_response_weekly: { data: null, error: { message: 'permission denied' } } },
    )
    expect((await screen.findByText(/Could not load this week's numbers/)).textContent).toContain('permission denied')
    expect(await screen.findByRole('table')).toBeTruthy()
  })

  it('signs in with an email OTP', async () => {
    setup(null)
    mocks.client.auth.signInWithOtp.mockResolvedValue({ error: null })
    mocks.client.auth.verifyOtp.mockResolvedValue({ error: null })
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'owner@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    fireEvent.change(await screen.findByLabelText('Code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
    await waitFor(() =>
      expect(mocks.client.auth.verifyOtp).toHaveBeenCalledWith({ email: 'owner@example.com', token: '123456', type: 'email' }),
    )
    expect(mocks.client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'owner@example.com',
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/admin` },
    })
    expect(mocks.client.from).not.toHaveBeenCalled()
  })
})
