import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import type { Lead } from '../lib/types'

const leads: Lead[] = [
  {
    id: '1',
    name: 'Asha Rao',
    phone_e164: '+919876543210',
    bhk: '3BHK',
    created_at: '2026-10-11T04:30:00.000Z',
    first_auto_reply_at: '2026-10-11T04:30:07.400Z',
    details: { budget_band: '₹8–15L', scope: 'Full home' },
  },
  {
    id: '2',
    name: 'Ravi Kumar',
    phone_e164: '+919812345678',
    bhk: null,
    created_at: '2026-10-10T18:45:00.000Z',
    first_auto_reply_at: null,
    details: {},
  },
]

const mocks = vi.hoisted(() => {
  const query = {
    select: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  }
  const client = {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(() => query),
  }
  return { client, query }
})

vi.mock('../lib/supabase', () => ({ getSupabase: () => mocks.client }))

function setup(session: unknown) {
  mocks.client.auth.getSession.mockResolvedValue({ data: { session } })
  mocks.query.select.mockReturnValue(mocks.query)
  mocks.query.order.mockReturnValue(mocks.query)
  mocks.query.limit.mockResolvedValue({ data: leads, error: null })
  render(
    <MemoryRouter initialEntries={['/admin']}>
      <App />
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('admin page', () => {
  it('renders lead rows with IST times and reply seconds', async () => {
    setup({ user: { email: 'owner@example.com' } })
    const table = await screen.findByRole('table')
    expect(mocks.client.from).toHaveBeenCalledWith('leads')
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(2)

    const first = within(rows[0]).getAllByRole('cell').map((c) => c.textContent)
    expect(first[0]).toMatch(/^Asha Rao/)
    expect(first[1]).toBe('+919876543210')
    expect(first[2]).toBe('3BHK')
    expect(first[3]).toMatch(/11 Oct 2026/)
    expect(first[3]).toMatch(/10:00/)
    expect(first[4]).toBe('7s')
    expect(mocks.query.select).toHaveBeenCalledWith(expect.stringContaining('details'))
    const details = within(rows[0]).getByLabelText('Details')
    expect(details.textContent).toBe('Budget band₹8–15LScopeFull home')
    expect(within(rows[1]).queryByLabelText('Details')).toBeNull()

    const second = within(rows[1]).getAllByRole('cell').map((c) => c.textContent)
    expect(second[0]).toMatch(/^Ravi Kumar/)
    expect(second[3]).toMatch(/11 Oct 2026/) // 18:45 UTC is 00:15 IST the next day
    expect(second[4]).toBe('—')

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(mocks.client.auth.signOut).toHaveBeenCalled()
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
