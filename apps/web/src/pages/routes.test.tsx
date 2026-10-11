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

function showcaseForm(name: string) {
  return screen.getByRole('form', { name: `Enquiry form for ${name}` })
}

describe('/ showcase', () => {
  it('opens on Nila with the demo label, privacy notice and a switcher', () => {
    renderAt('/')
    expect(showcaseForm('Nila Design House')).toBeTruthy()
    expect(screen.getAllByRole('form')).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'Homes that feel like you, not a catalogue.' })).toBeTruthy()
    expect(screen.getAllByText('Demo').length).toBeGreaterThan(0)
    expect(screen.getByText(/Nila Design House, Indiranagar is a demonstration studio run by Flow Systems/)).toBeTruthy()
    expect(screen.getByText(/Flow Systems processes this data/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Previous form: Haveli Works' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Next form: Lime & Lattice' })).toBeTruthy()
    const nav = screen.getByRole('navigation', { name: 'Sample forms' })
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(FORM_CONFIGS.map((c) => c.studio.name))
    expect(within(nav).getByRole('link', { name: 'Nila Design House' }).getAttribute('aria-current')).toBe('page')
    expect(document.title).toBe('Nila Design House · Sample forms by Flow Systems')
  })

  it('moves through every form with the arrows, wrapping at both ends', () => {
    renderAt('/')
    fireEvent.click(screen.getByRole('link', { name: 'Next form: Lime & Lattice' }))
    expect(showcaseForm('Lime & Lattice')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Next form: Haveli Works' }))
    expect(showcaseForm('Haveli Works')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Next form: Nila Design House' }))
    expect(showcaseForm('Nila Design House')).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'Previous form: Haveli Works' }))
    expect(showcaseForm('Haveli Works')).toBeTruthy()
    expect(screen.getAllByRole('form')).toHaveLength(1)
  })

  it('selects a form from ?form= and falls back to Nila for an unknown one', () => {
    renderAt('/?form=haveli-works')
    expect(showcaseForm('Haveli Works')).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: 'Book a design consultation' })).toBeTruthy()
    cleanup()
    renderAt('/?form=no-such-studio')
    expect(showcaseForm('Nila Design House')).toBeTruthy()
  })

  it('links each form at a shareable URL, with a clean / for Nila', () => {
    renderAt('/?form=lime-and-lattice')
    const nav = screen.getByRole('navigation', { name: 'Sample forms' })
    expect(within(nav).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual([
      '/',
      '/?form=lime-and-lattice',
      '/?form=haveli-works',
    ])
  })

  it('switches with the Left and Right keys, but not while choosing a chip', () => {
    renderAt('/')
    fireEvent.keyDown(document.body, { key: 'ArrowRight' })
    expect(showcaseForm('Lime & Lattice')).toBeTruthy()
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' })
    expect(showcaseForm('Nila Design House')).toBeTruthy()

    const chip = screen.getByRole('radio', { name: '2BHK' })
    chip.focus()
    fireEvent.keyDown(chip, { key: 'ArrowRight' })
    expect(showcaseForm('Nila Design House')).toBeTruthy()
    expect(screen.getByRole('radio', { name: '3BHK' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.keyDown(screen.getByLabelText('Your name'), { key: 'ArrowRight' })
    expect(showcaseForm('Nila Design House')).toBeTruthy()
  })

  it('starts each form empty after a switch', () => {
    renderAt('/')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha' } })
    fireEvent.click(screen.getByRole('link', { name: 'Next form: Lime & Lattice' }))
    fireEvent.click(screen.getByRole('link', { name: 'Previous form: Nila Design House' }))
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('')
  })

  it('submits for real, with the source key and custom answers', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ lead_id: 'x', duplicate: false }), { status: 200 }))
    renderAt('/')
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Asha Rao' } })
    fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '9876543210' } })
    fireEvent.click(screen.getByRole('radio', { name: '3BHK' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Full home' }))
    fireEvent.click(screen.getByLabelText('I agree to be contacted on WhatsApp about this enquiry'))
    fireEvent.click(screen.getByRole('button', { name: 'Get my free consult slot' }))
    expect(await screen.findByText('+91 98•••••210')).toBeTruthy()
    expect(screen.queryByText('Preview only: nothing was sent.')).toBeNull()
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string)
    expect(body).toMatchObject({ source_key: 'demo-web-form', bhk: '3BHK', details: { scope: 'Full home' } })
  })
})

describe('/forms', () => {
  it('redirects to the showcase', () => {
    renderAt('/forms')
    expect(showcaseForm('Nila Design House')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: 'Sample forms' })).toBeTruthy()
  })
})

describe('/f/:slug', () => {
  it.each(FORM_CONFIGS.map((c) => [c.slug, c] as const))('renders %s on its own, with no showcase switcher', (slug, config) => {
    renderAt(`/f/${slug}`)
    expect(screen.getByRole('form', { name: `Enquiry form for ${config.studio.name}` })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1, name: config.copy.headline })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Sample forms' })).toBeNull()
    expect(document.title).toBe(`${config.studio.name}, ${config.studio.area}`)
  })

  it('shows custom questions from the config', () => {
    renderAt('/f/nila-design-house')
    expect(screen.getByRole('radiogroup', { name: 'What are we designing?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Get my free consult slot' })).toBeTruthy()
  })

  it('shows a friendly not-found for an unknown slug', () => {
    renderAt('/f/no-such-studio')
    expect(screen.getByRole('heading', { name: "We couldn't find that form" })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See our sample forms' }).getAttribute('href')).toBe('/')
    expect(screen.queryByRole('form')).toBeNull()
  })
})
