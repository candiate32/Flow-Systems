import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { FORM_CONFIGS } from '../forms/configs'

const fetchMock = vi.fn()

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
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

describe('/', () => {
  it('renders the Demo Interiors form with the demo label, core fields and privacy notice', () => {
    renderAt('/')
    expect(screen.getAllByText('Demo').length).toBeGreaterThan(0)
    expect(screen.getByRole('form', { name: 'Enquiry form for Demo Interiors' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Interiors for your new home, planned properly.' })).toBeTruthy()
    expect(screen.getByText(/Demo Interiors, Sarjapur Road is a demonstration studio run by Flow Systems/)).toBeTruthy()
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect((screen.getByLabelText('WhatsApp number') as HTMLInputElement).type).toBe('tel')
    const bhk = screen.getByRole('radiogroup', { name: /Home type/ })
    expect(within(bhk).getAllByRole('radio').map((r) => r.textContent)).toEqual(['1BHK', '2BHK', '3BHK', '4BHK+', 'Villa', 'Office'])
    expect(screen.getByRole('group', { name: /Possession month/ })).toBeTruthy()
    expect(screen.getByText(/Flow Systems processes this data/)).toBeTruthy()
    expect(document.title).toBe('Demo Interiors, Sarjapur Road')
  })

  it('posts with the demo source key', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ lead_id: 'x', duplicate: false }), { status: 200 }))
    renderAt('/')
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Asha Rao' } })
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByRole('radio', { name: '3BHK' }))
    fireEvent.click(screen.getByLabelText('I agree to be contacted on WhatsApp about this enquiry'))
    fireEvent.click(screen.getByRole('button', { name: 'Get a WhatsApp reply' }))
    expect(await screen.findByText('+91 98•••••210')).toBeTruthy()
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ source_key: 'demo-web-form', bhk: '3BHK', possession_month: null, details: {} })
  })
})

describe('/f/:slug', () => {
  it.each(FORM_CONFIGS.map((c) => [c.slug, c] as const))('renders %s', (slug, config) => {
    renderAt(`/f/${slug}`)
    expect(screen.getByRole('form', { name: `Enquiry form for ${config.studio.name}` })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: config.copy.headline })).toBeTruthy()
  })

  it('shows custom questions from the config', () => {
    renderAt('/f/nila-design-house')
    expect(screen.getByRole('radiogroup', { name: 'What are we designing?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Get my free consult slot' })).toBeTruthy()
  })

  it('shows a friendly not-found for an unknown slug', () => {
    renderAt('/f/no-such-studio')
    expect(screen.getByRole('heading', { name: "We couldn't find that form" })).toBeTruthy()
    expect(screen.getByRole('link', { name: "See the demo studio's form" }).getAttribute('href')).toBe('/')
    expect(screen.queryByRole('form')).toBeNull()
  })
})

describe('/forms gallery', () => {
  it('renders a live preview of every registered config, each in its own theme', () => {
    const { container } = renderAt('/forms')
    for (const c of FORM_CONFIGS) {
      expect(screen.getByRole('form', { name: `Enquiry form for ${c.studio.name}` })).toBeTruthy()
    }
    expect(screen.getAllByText('Preview: this form works but sends nothing.')).toHaveLength(FORM_CONFIGS.length)
    const accents = Array.from(container.querySelectorAll<HTMLElement>('[data-ff-preset]')).map((el) =>
      el.style.getPropertyValue('--ff-accent'),
    )
    expect(new Set(accents).size).toBe(FORM_CONFIGS.length)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('never calls fetch, even when a preview is submitted', () => {
    renderAt('/forms')
    const form = screen.getByRole('form', { name: 'Enquiry form for Demo Interiors' })
    fireEvent.click(within(form).getByRole('button', { name: 'Get a WhatsApp reply' }))
    expect(within(form).getByText('Please enter your name.')).toBeTruthy()

    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Asha' } })
    fireEvent.change(within(form).getByLabelText('WhatsApp number'), { target: { value: '9876543210' } })
    fireEvent.click(within(form).getByLabelText('I agree to be contacted on WhatsApp about this enquiry'))
    fireEvent.click(within(form).getByRole('button', { name: 'Get a WhatsApp reply' }))
    expect(screen.getByText('Preview only: nothing was sent.')).toBeTruthy()
    expect(screen.getByText('+91 98•••••210')).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset preview' }))
    expect(screen.getByRole('form', { name: 'Enquiry form for Demo Interiors' })).toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
