import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { possessionYears } from '../formModel'
import { THEMES } from '../themes'
import type { FormConfig } from '../types'
import { FormRenderer } from './FormRenderer'

const config: FormConfig = {
  slug: 'test-studio',
  sourceKey: 'test-source',
  studio: { name: 'Test Studio', area: 'HSR Layout', whatsappFallback: '98765 00001' },
  theme: { preset: 'terrazzo', overrides: { accent: '#18473F' } },
  layout: 'minimal',
  copy: { headline: 'Tell us about your home', intro: 'We reply on WhatsApp.', submitLabel: 'Send enquiry' },
  fields: [
    { kind: 'phone', label: 'Mobile' },
    { kind: 'name' },
    { kind: 'chips', key: 'budget_band', label: 'Budget', options: ['Under ₹8L', '₹8–15L', '₹15L+'], required: true },
    { kind: 'possession_month', required: true },
    { kind: 'text', key: 'project_name', label: 'Project name', maxLength: 80 },
  ],
}

const fetchMock = vi.fn()

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function renderForm(c: FormConfig = config) {
  return render(<FormRenderer config={c} fullPage />)
}

const nextYear = String(possessionYears(new Date())[1])

function fillValid({ phone = '98765 43345' } = {}) {
  fireEvent.change(screen.getByLabelText('Mobile'), { target: { value: phone } })
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Asha Rao ' } })
  fireEvent.click(screen.getByRole('radio', { name: '₹8–15L' }))
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '03' } })
  fireEvent.change(screen.getByLabelText('Year'), { target: { value: nextYear } })
  fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: 'Prestige Lakeside' } })
  fireEvent.click(screen.getByLabelText('I agree to be contacted on WhatsApp about this enquiry'))
}

function submitButton() {
  return screen.getByRole('button', { name: 'Send enquiry' })
}

function sentBody() {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
  return JSON.parse(init.body as string)
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('FormRenderer builds the form from the config', () => {
  it('renders fields in config order, hides omitted optional fields, and shows custom questions', () => {
    renderForm()
    const order = [
      screen.getByLabelText('Mobile'),
      screen.getByLabelText('Name'),
      screen.getByRole('radiogroup', { name: 'Budget' }),
      screen.getByRole('group', { name: /Possession month/ }),
      screen.getByLabelText(/Project name/),
      screen.getByLabelText('I agree to be contacted on WhatsApp about this enquiry'),
      submitButton(),
    ]
    for (let i = 1; i < order.length; i++) {
      expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
    expect(screen.queryByRole('radiogroup', { name: /Home type/ })).toBeNull()
    expect((screen.getByLabelText('Mobile') as HTMLInputElement).type).toBe('tel')
    expect((screen.getByLabelText(/Project name/) as HTMLInputElement).maxLength).toBe(80)
    expect(screen.getByText('(optional)')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Tell us about your home' })).toBeTruthy()
    expect(screen.getByRole('form', { name: 'Enquiry form for Test Studio' }).hasAttribute('novalidate')).toBe(true)
  })

  it('shows BHK as chips with the configured options only', () => {
    renderForm({ ...config, fields: [{ kind: 'name' }, { kind: 'phone' }, { kind: 'bhk', options: ['2BHK', '3BHK', 'Villa'] }] })
    const group = screen.getByRole('radiogroup', { name: /Home type/ })
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['2BHK', '3BHK', 'Villa'])
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('sets the theme only as CSS variables on the form root, with overrides applied', () => {
    const { container } = renderForm()
    const root = container.firstElementChild as HTMLElement
    expect(root.style.getPropertyValue('--ff-accent')).toBe('#18473F')
    expect(root.style.getPropertyValue('--ff-bg')).toBe(THEMES.terrazzo.bg)
    expect(root.style.getPropertyValue('--ff-font-display')).toContain('Bricolage Grotesque')
    expect(root.getAttribute('data-ff-layout')).toBe('minimal')
  })

  it('loads the preset fonts once, when the form mounts', () => {
    renderForm()
    renderForm()
    const links = Array.from(document.head.querySelectorAll('link[data-ff-font]'))
    expect(links.map((l) => l.getAttribute('href'))).toEqual([THEMES.terrazzo.fontHref])
  })
})

describe('chips', () => {
  it('works as a radio group from the keyboard', () => {
    renderForm()
    const radios = within(screen.getByRole('radiogroup', { name: 'Budget' })).getAllByRole('radio')
    expect(radios.map((r) => r.tabIndex)).toEqual([0, -1, -1])

    radios[0].focus()
    fireEvent.keyDown(radios[0], { key: 'ArrowRight' })
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radios[1])
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1])

    fireEvent.keyDown(radios[1], { key: 'End' })
    expect(radios[2].getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radios[2], { key: 'ArrowRight' }) // wraps
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    expect(document.activeElement).toBe(radios[0])
    fireEvent.keyDown(radios[0], { key: 'ArrowLeft' }) // wraps back
    expect(radios[2].getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radios[2], { key: 'Home' })
    expect(radios[0].getAttribute('aria-checked')).toBe('true')
    fireEvent.keyDown(radios[1], { key: ' ' })
    expect(radios[1].getAttribute('aria-checked')).toBe('true')
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1)
  })
})

describe('possession month picker', () => {
  it('offers month and year with readable placeholders and submits YYYY-MM', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { lead_id: 'x', duplicate: false }))
    renderForm()
    const month = screen.getByLabelText('Month') as HTMLSelectElement
    expect(month.options[0].text).toBe('Month')
    expect(month.options[3].text).toBe('March')
    expect((screen.getByLabelText('Year') as HTMLSelectElement).options[0].text).toBe('Year')
    expect(document.body.textContent).not.toMatch(/----/)
    fillValid()
    fireEvent.click(submitButton())
    await screen.findByRole('status')
    expect(sentBody().possession_month).toBe(`${nextYear}-03`)
  })

  it('asks for both parts when only one is chosen', () => {
    renderForm()
    fillValid()
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '' } })
    fireEvent.click(submitButton())
    expect(screen.getByText('Choose both a month and a year.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByLabelText('Month'))
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('submitting', () => {
  it('posts core fields plus custom answers in details', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { lead_id: 'x', duplicate: false }))
    renderForm()
    fillValid()
    fireEvent.click(submitButton())
    await screen.findByRole('status')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.supabase.co/functions/v1/ingest-form')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', apikey: 'sb_publishable_test' })
    expect(sentBody()).toEqual({
      source_key: 'test-source',
      name: 'Asha Rao',
      phone: '98765 43345',
      bhk: null,
      possession_month: `${nextYear}-03`,
      consent: true,
      turnstile_token: null,
      details: { budget_band: '₹8–15L', project_name: 'Prestige Lakeside' },
    })
  })

  it('leaves unanswered optional questions out of details', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { lead_id: 'x', duplicate: false }))
    renderForm()
    fillValid()
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: '   ' } })
    fireEvent.click(submitButton())
    await screen.findByRole('status')
    expect(sentBody().details).toEqual({ budget_band: '₹8–15L' })
  })

  it('shows inline errors linked with aria-describedby and focuses the first invalid field', () => {
    renderForm()
    fireEvent.click(submitButton())
    const phone = screen.getByLabelText('Mobile')
    expect(document.activeElement).toBe(phone)
    expect(phone.getAttribute('aria-invalid')).toBe('true')
    const errorId = phone.getAttribute('aria-describedby')!
    expect(document.getElementById(errorId)?.textContent).toBe('Enter a valid Indian mobile number.')
    const consent = screen.getByLabelText('I agree to be contacted on WhatsApp about this enquiry')
    expect(document.getElementById(consent.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Please agree to be contacted on WhatsApp.',
    )
    expect(fetchMock).not.toHaveBeenCalled()

    // Fix the first two; focus moves on to the chips (the first chip, as none is selected).
    fireEvent.change(phone, { target: { value: '98765 43345' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Asha' } })
    fireEvent.click(submitButton())
    const group = screen.getByRole('radiogroup', { name: 'Budget' })
    expect(document.activeElement).toBe(within(group).getAllByRole('radio')[0])
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Choose one of the options.')
  })

  it('cannot double submit and shows a loading state', async () => {
    let resolve: (r: Response) => void = () => {}
    fetchMock.mockReturnValue(new Promise<Response>((r) => (resolve = r)))
    renderForm()
    fillValid()
    const button = submitButton()
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.submit(button.closest('form')!)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const busy = screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    resolve(jsonResponse(200, { lead_id: 'x', duplicate: false }))
    await screen.findByRole('status')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('confirms success with the number masked', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { lead_id: 'x', duplicate: false }))
    renderForm()
    fillValid({ phone: '+91 98765-43345' })
    fireEvent.click(submitButton())
    const status = await screen.findByRole('status')
    expect(within(status).getByRole('heading', { name: "We've sent you a WhatsApp" })).toBeTruthy()
    expect(within(status).getByText('+91 98•••••345')).toBeTruthy()
    expect(status.textContent).not.toContain('9876543345')
    expect(document.activeElement).toBe(within(status).getByRole('heading'))
  })

  it('tells a returning visitor we already have their enquiry', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { lead_id: 'x', duplicate: true }))
    renderForm()
    fillValid()
    fireEvent.click(submitButton())
    expect(await screen.findByRole('heading', { name: 'We already have your enquiry' })).toBeTruthy()
  })

  it('replaces the button with one WhatsApp action when sending fails', async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: 'boom' }))
    renderForm()
    fillValid()
    fireEvent.click(submitButton())
    const alert = await screen.findByRole('alert')
    const link = within(alert).getByRole('link', { name: 'Chat on WhatsApp instead' })
    expect(link.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919876500001\?text=Hi%20Test%20Studio/)
    expect(screen.queryByRole('button', { name: /Send enquiry|Sending/ })).toBeNull()
    expect(screen.getAllByRole('link', { name: /WhatsApp/ })).toHaveLength(1)
  })

  it('shows the WhatsApp action on a network error too', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    renderForm()
    fillValid()
    fireEvent.click(submitButton())
    expect(await screen.findByRole('link', { name: 'Chat on WhatsApp instead' })).toBeTruthy()
  })

  it('shows server field errors next to the fields, and other errors above the button', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(400, { errors: { phone: 'Server says no.', details: 'Details can have at most 10 answers' } }),
    )
    renderForm()
    fillValid()
    fireEvent.click(submitButton())
    expect(await screen.findByText('Server says no.')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Details can have at most 10 answers')
    expect(document.activeElement).toBe(screen.getByLabelText('Mobile'))
    expect(submitButton()).toBeTruthy()
  })
})
