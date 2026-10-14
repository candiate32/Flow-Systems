import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { SERVICES } from '../v2/content'

/** Renders /v2 and waits for the lazy page to load; returns its h1. */
function renderV2() {
  render(
    <MemoryRouter initialEntries={['/v2']}>
      <App />
    </MemoryRouter>,
  )
  return screen.findByRole('heading', { level: 1 }, { timeout: 5000 })
}

beforeAll(async () => {
  await import('./HomeV2')
})

beforeEach(() => {
  vi.stubEnv('VITE_CONTACT_WHATSAPP', '')
  // jsdom has no canvas; the sculpture just skips drawing.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('/v2 home', () => {
  it('leads with one h1 and the decorative sculpture', async () => {
    const h1 = await renderV2()
    expect(h1.textContent).toBe('AI that answers, follows up and gets work done.')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByTestId('ink-sculpture').getAttribute('aria-hidden')).toBe('true')
    expect(document.title).toBe('Flow Systems · AI agents, automation and custom apps')
  })

  it('lists all six services in order with their category and line', async () => {
    await renderV2()
    const list = within(screen.getByRole('region', { name: 'Six ways we take work off your plate.' })).getByRole('list')
    const names = within(list).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(names).toEqual([
      'AI Voice Agent',
      'Marketing Agent',
      'Content Generator',
      'Exhibition Lead Capture',
      'Workflow Automation',
      'Custom Apps',
    ])
    for (const s of SERVICES) {
      expect(within(list).getByText(s.line)).toBeTruthy()
      expect(within(list).getByText(s.category)).toBeTruthy()
    }
  })

  it('points the call to action at the services while there is no WhatsApp number', async () => {
    await renderV2()
    const ctas = screen.getAllByRole('link', { name: 'Explore services' })
    expect(ctas.length).toBe(2)
    for (const a of ctas) expect(a.getAttribute('href')).toBe('#services')
    expect(screen.queryByRole('link', { name: 'Book a free audit' })).toBeNull()
  })

  it('opens WhatsApp to Flow Systems once the number is set', async () => {
    vi.stubEnv('VITE_CONTACT_WHATSAPP', '98765 43210')
    await renderV2()
    const ctas = screen.getAllByRole('link', { name: 'Book a free audit' })
    expect(ctas.length).toBe(2)
    expect(ctas[0].getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/)
  })

  it('links the working studio product to the live forms and the studio page', async () => {
    await renderV2()
    expect(screen.getByRole('link', { name: 'Try a live form' }).getAttribute('href')).toBe('/')
    expect(screen.getByRole('link', { name: 'See the studio page' }).getAttribute('href')).toBe('/home')
  })

  it('answers the FAQ inline', async () => {
    await renderV2()
    const faq = screen.getByRole('region', { name: 'Questions we hear first.' })
    expect(within(faq).getByText('What happens to my customer data?')).toBeTruthy()
  })
})
