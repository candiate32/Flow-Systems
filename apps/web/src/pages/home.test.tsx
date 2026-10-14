import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { FORM_CONFIGS } from '../forms/configs'

const fetchMock = vi.fn()

/** Renders /home and waits for the lazy page to load; returns its h1. */
function renderHome() {
  render(
    <MemoryRouter initialEntries={['/home']}>
      <App />
    </MemoryRouter>,
  )
  // The page is large, so give its first render more than the default second on a busy runner.
  return screen.findByRole('heading', { level: 1 }, { timeout: 5000 })
}

function panelForm(name: string) {
  return within(screen.getByRole('tabpanel')).getByRole('form', { name: `Enquiry form for ${name}` })
}

// Load the lazy page once up front, so the first test isn't racing a cold import on a busy runner.
beforeAll(async () => {
  await import('./Home')
})

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '')
  vi.stubEnv('VITE_CONTACT_WHATSAPP', '')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('/home', () => {
  it('explains the service on one page with a single h1', async () => {
    const h1 = await renderHome()
    expect(h1.textContent).toBe('Every enquiry answered in under a minute.')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    for (const name of ['Instant WhatsApp reply', 'New lead alerts', 'Automatic follow-ups', 'Weekly lead report']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeTruthy()
    }
    for (const name of ['Site visit reminders', 'Old enquiry follow-up', 'Google review requests', 'Enquiry landing page']) {
      expect(screen.getByRole('heading', { level: 4, name })).toBeTruthy()
    }
    // The title is set in an effect, which can land just after the lazy page first paints.
    await waitFor(() => expect(document.title).toBe('Flow Systems · Every enquiry answered in under a minute'))
  })

  it('keeps tech, provider and competitor names out of the copy', async () => {
    await renderHome()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\b(supabase|react|vite|tailwind|cloudflare|vercel|n8n|gupshup|360dialog|interakt|wati|aisensy|meta)\b/i)
    expect(text).not.toMatch(/playground/i)
  })

  it('switches the sample forms with tabs, arrow keys and buttons, keeping what was typed', async () => {
    await renderHome()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.getAttribute('aria-label'))).toEqual(FORM_CONFIGS.map((c) => c.studio.name))
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1])

    fireEvent.change(within(panelForm('Nila Design House')).getByLabelText('Your name'), { target: { value: 'Asha' } })
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' })
    expect(panelForm('Lime & Lattice')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Lime & Lattice' }))

    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(panelForm('Haveli Works')).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' })
    expect(panelForm('Nila Design House')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Previous form: Haveli Works' }))
    expect(panelForm('Haveli Works')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next form: Nila Design House' }))
    expect(screen.getAllByRole('form')).toHaveLength(1)
    expect((within(panelForm('Nila Design House')).getByLabelText('Your name') as HTMLInputElement).value).toBe('Asha')
  })

  it('sends a sample enquiry for real', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ lead_id: 'x', duplicate: false }), { status: 200 }))
    await renderHome()
    const form = within(panelForm('Nila Design House'))
    fireEvent.change(form.getByLabelText('Your name'), { target: { value: 'Asha Rao' } })
    fireEvent.change(form.getByLabelText('WhatsApp number'), { target: { value: '9876543210' } })
    fireEvent.click(form.getByRole('radio', { name: '3BHK' }))
    fireEvent.click(form.getByRole('radio', { name: 'Full home' }))
    fireEvent.click(form.getByLabelText('I agree to be contacted on WhatsApp about this enquiry'))
    fireEvent.click(form.getByRole('button', { name: 'Get my free consult slot' }))
    expect(await screen.findByText('+91 98•••••210')).toBeTruthy()
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ source_key: 'demo-web-form', bhk: '3BHK' })
  })

  it('without a contact number, sends the audit buttons to the live forms', async () => {
    await renderHome()
    expect(screen.queryByRole('link', { name: /audit on WhatsApp|Enquiry Leak Audit/ })).toBeNull()
    const forms = document.getElementById('forms')!
    const scrollIntoView = vi.fn()
    forms.scrollIntoView = scrollIntoView
    fireEvent.click(screen.getByRole('link', { name: 'Try a live form first' }))
    expect(scrollIntoView).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(forms)
  })

  it('with a contact number, opens a WhatsApp chat for the audit', async () => {
    vi.stubEnv('VITE_CONTACT_WHATSAPP', '98765 43210')
    await renderHome()
    for (const name of ['Get a free Enquiry Leak Audit', 'Book your free audit on WhatsApp']) {
      const href = screen.getByRole('link', { name }).getAttribute('href') ?? ''
      expect(href.startsWith('https://wa.me/919876543210?text=')).toBe(true)
      expect(decodeURIComponent(href.split('text=')[1])).toContain('Enquiry Leak Audit')
    }
  })

  it('links to the full-screen forms', async () => {
    await renderHome()
    expect(screen.getByRole('link', { name: 'All sample forms, full screen' }).getAttribute('href')).toBe('/')
  })
})
