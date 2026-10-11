import { describe, expect, it } from 'vitest'
import { FORM_CONFIGS, getFormConfig, HOME_FORM_SLUG } from './configs'
import { limeAndLattice } from './configs/lime-and-lattice'
import { SHARED_TYPE, THEME_PRESETS, THEMES } from './themes'
import type { FormConfig } from './types'
import { contrastErrors, contrastRatio, validateFormConfig } from './validateConfig'

function withChanges(change: (c: FormConfig) => void): FormConfig {
  const copy = structuredClone(limeAndLattice)
  change(copy)
  return copy
}

function errorsFor(change: (c: FormConfig) => void): string[] {
  const result = validateFormConfig(withChanges(change))
  expect(result.ok).toBe(false)
  return result.errors
}

describe('registered configs', () => {
  it.each(FORM_CONFIGS.map((c) => [c.slug, c] as const))('%s is valid', (_slug, config) => {
    expect(validateFormConfig(config).errors).toEqual([])
  })

  it('have unique slugs and start with Nila, the home form', () => {
    const slugs = FORM_CONFIGS.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    expect(FORM_CONFIGS[0].slug).toBe(HOME_FORM_SLUG)
    expect(getFormConfig(HOME_FORM_SLUG)?.studio.name).toBe('Nila Design House')
    expect(getFormConfig(HOME_FORM_SLUG)?.sourceKey).toBe('demo-web-form')
  })

  it('cover all three presets and all three layouts, and every sample studio is labelled', () => {
    expect(new Set(FORM_CONFIGS.map((c) => c.theme.preset))).toEqual(new Set(['atelier', 'terrazzo', 'teak']))
    expect(new Set(FORM_CONFIGS.map((c) => c.layout))).toEqual(new Set(['card', 'split', 'minimal']))
    for (const c of FORM_CONFIGS) {
      expect(c.studio.isDemo).toBe(true)
      expect(c.fields.some((f) => 'key' in f)).toBe(true)
    }
  })

  it('never put "demo" in a studio name or slug', () => {
    for (const c of FORM_CONFIGS) {
      expect(c.studio.name).not.toMatch(/demo/i)
      expect(c.studio.logoText ?? '').not.toMatch(/demo/i)
      expect(c.slug).not.toMatch(/demo/i)
    }
  })
})

describe('theme presets', () => {
  it.each(THEME_PRESETS)("%s uses Nila's type and shape", (preset) => {
    expect(THEMES[preset]).toMatchObject(SHARED_TYPE)
  })

  it.each(THEME_PRESETS)('%s passes every contrast check', (preset) => {
    expect(contrastErrors(THEMES[preset])).toEqual([])
    expect(contrastRatio(THEMES[preset].text, THEMES[preset].bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(THEMES[preset].text, THEMES[preset].surface)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(THEMES[preset].accentText, THEMES[preset].accent)).toBeGreaterThanOrEqual(4.5)
  })

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2)
  })
})

describe('validateFormConfig rejects', () => {
  it('duplicate field keys', () => {
    expect(errorsFor((c) => c.fields.push({ kind: 'bhk' }))).toContainEqual(expect.stringMatching(/"bhk" is used more than once/))
    expect(
      errorsFor((c) =>
        c.fields.push(
          { kind: 'text', key: 'notes', label: 'Notes' },
          { kind: 'text', key: 'notes', label: 'More notes' },
        ),
      ),
    ).toContainEqual(expect.stringMatching(/"notes" is used more than once/))
  })

  it.each(['Budget', '1st', 'has-dash', 'a'.repeat(33), ''])('custom key %j that breaks the pattern', (key) => {
    expect(errorsFor((c) => c.fields.push({ kind: 'text', key, label: 'Q' }))).toContainEqual(
      expect.stringMatching(/must match \^\[a-z\]/),
    )
  })

  it.each(['name', 'phone', 'bhk', 'possession_month', 'consent', 'details'])('custom key %s clashing with a core key', (key) => {
    expect(errorsFor((c) => c.fields.push({ kind: 'text', key, label: 'Q' }))).toContainEqual(
      expect.stringMatching(/clashes with a built-in field/),
    )
  })

  it('more than 6 custom fields', () => {
    const errors = errorsFor((c) => {
      c.fields = c.fields.filter((f) => !('key' in f))
      for (let i = 0; i < 7; i++) c.fields.push({ kind: 'text', key: `q${i}`, label: `Q${i}` })
    })
    expect(errors).toContainEqual(expect.stringMatching(/at most 6 custom questions, found 7/))
  })

  it('BHK options outside the server list', () => {
    const errors = errorsFor((c) => {
      c.fields[2] = { kind: 'bhk', options: ['2BHK', '5BHK' as never] }
    })
    expect(errors).toContainEqual(expect.stringMatching(/"5BHK" are not in the server's list/))
  })

  it.each([
    ['one option', ['Only']],
    ['thirteen options', Array.from({ length: 13 }, (_, i) => `Option ${i}`)],
  ])('a chips field with %s', (_what, options) => {
    expect(errorsFor((c) => c.fields.push({ kind: 'chips', key: 'pick', label: 'Pick', options }))).toContainEqual(
      expect.stringMatching(/needs 2 to 12 options/),
    )
  })

  it('a select field with too few options', () => {
    expect(errorsFor((c) => c.fields.push({ kind: 'select', key: 'pick', label: 'Pick', options: ['A'] }))).toContainEqual(
      expect.stringMatching(/needs 2 to 12 options, has 1/),
    )
  })

  it('an unknown theme preset', () => {
    expect(errorsFor((c) => (c.theme = { preset: 'marble' as never }))).toContainEqual(
      expect.stringMatching(/theme.preset "marble" is not one of atelier, terrazzo, teak/),
    )
  })

  it.each(['red', '#12345', '#GGGGGG', 'rgb(0,0,0)'])('override colour %s that is not hex', (value) => {
    expect(errorsFor((c) => (c.theme.overrides = { accent: value }))).toContainEqual(
      expect.stringMatching(/theme.overrides.accent .* is not a hex colour/),
    )
  })

  it('an override that breaks text contrast', () => {
    expect(errorsFor((c) => (c.theme.overrides = { text: '#B0A69C' }))).toContainEqual(
      expect.stringMatching(/text #B0A69C on bg #F3EDE4 is \d\.\d\d:1, below 4.5:1/),
    )
    expect(errorsFor((c) => (c.theme.overrides = { accent: '#E8C9A0' }))).toContainEqual(
      expect.stringMatching(/accentText .* on accent #E8C9A0/),
    )
  })

  it('accepts a valid override', () => {
    expect(validateFormConfig(withChanges((c) => (c.theme.overrides = { accent: '#7A3B22' }))).errors).toEqual([])
  })

  it.each(['12345', '+1 415 555 0100', '5876543210', ''])('fallback WhatsApp number %j', (n) => {
    expect(errorsFor((c) => (c.studio.whatsappFallback = n))).toContainEqual(
      expect.stringMatching(/whatsappFallback .* is not a valid Indian \(\+91\) mobile number/),
    )
  })

  it('a config missing name or phone', () => {
    const errors = errorsFor((c) => (c.fields = c.fields.filter((f) => f.kind !== 'phone')))
    expect(errors).toContainEqual(expect.stringMatching(/must include the phone field/))
  })

  it('an unknown layout and a text maxLength over 200', () => {
    const errors = errorsFor((c) => {
      c.layout = 'grid' as never
      c.fields.push({ kind: 'text', key: 'notes', label: 'Notes', maxLength: 500 })
    })
    expect(errors).toContainEqual(expect.stringMatching(/layout "grid"/))
    expect(errors).toContainEqual(expect.stringMatching(/maxLength must be a whole number from 1 to 200/))
  })

  it('prefixes every message with the slug', () => {
    for (const e of errorsFor((c) => (c.studio.whatsappFallback = 'x'))) expect(e.startsWith('lime-and-lattice: ')).toBe(true)
  })
})
