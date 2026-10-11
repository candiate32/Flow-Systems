import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderLanding() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  )
}

function fill({ name = 'Asha Rao', phone = '98765 43210', consent = true } = {}) {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: phone } })
  fireEvent.change(screen.getByLabelText('Home type'), { target: { value: '3BHK' } })
  fireEvent.change(screen.getByLabelText('Possession month'), { target: { value: '2027-03' } })
  if (consent) fireEvent.click(screen.getByLabelText('I agree to be contacted on WhatsApp'))
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Get a WhatsApp reply' }))
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
  vi.stubEnv('VITE_DEMO_SOURCE_KEY', '')
  vi.stubEnv('VITE_WHATSAPP_FALLBACK_PHONE', '+91 90000 00001')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('landing page', () => {
  it('shows the demo label and form fields', () => {
    renderLanding()
    expect(screen.getByText('Demo')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Demo Interiors, Sarjapur Road' })).toBeTruthy()
    expect((screen.getByLabelText('WhatsApp number') as HTMLInputElement).type).toBe('tel')
    expect((screen.getByLabelText('Possession month') as HTMLInputElement).type).toBe('month')
    const options = Array.from((screen.getByLabelText('Home type') as HTMLSelectElement).options).map((o) => o.value)
    expect(options).toEqual(['', '1BHK', '2BHK', '3BHK', '4BHK+', 'Villa', 'Office'])
    expect(screen.getByText(/Flow Systems processes this data/)).toBeTruthy()
  })

  it('blocks submit without consent', () => {
    renderLanding()
    fill({ consent: false })
    submit()
    expect(screen.getByText('Please agree to be contacted on WhatsApp.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks submit with a bad phone', () => {
    renderLanding()
    fill({ phone: '12345' })
    submit()
    expect(screen.getByText('Enter a valid Indian mobile number.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('blocks submit with an empty name', () => {
    renderLanding()
    fill({ name: '   ' })
    submit()
    expect(screen.getByText('Please enter your name.')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the enquiry and shows the success state on 200', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { lead_id: 'abc', duplicate: false }))
    renderLanding()
    fill()
    submit()
    expect(await screen.findByText("Thanks, check WhatsApp — you'll hear from us in under a minute.")).toBeTruthy()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.supabase.co/functions/v1/ingest-form')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', apikey: 'sb_publishable_test' })
    expect(JSON.parse(init.body as string)).toEqual({
      source_key: 'demo-web-form',
      name: 'Asha Rao',
      phone: '98765 43210',
      bhk: '3BHK',
      possession_month: '2027-03',
      consent: true,
      turnstile_token: null,
    })
  })

  it('shows field errors returned by a 400', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { errors: { phone: 'Server says no.', source_key: 'Unknown source.' } }))
    renderLanding()
    fill()
    submit()
    expect(await screen.findByText('Server says no.')).toBeTruthy()
    expect(screen.getByText('Unknown source.')).toBeTruthy()
    expect(screen.queryByText('Chat on WhatsApp')).toBeNull()
  })

  it('shows the WhatsApp fallback link on 500', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }))
    renderLanding()
    fill()
    submit()
    const link = await screen.findByRole('link', { name: 'Chat on WhatsApp' })
    expect(link.getAttribute('href')).toBe('https://wa.me/919000000001')
  })

  it('shows the WhatsApp fallback link on a network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderLanding()
    fill()
    submit()
    expect(await screen.findByRole('link', { name: 'Chat on WhatsApp' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Get a WhatsApp reply' })).toBeTruthy())
  })
})
