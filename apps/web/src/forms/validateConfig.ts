import { BHK_OPTIONS, normalizeIndianMobile } from '../lib/enquiry'
import { THEMES, resolveTheme, type ThemeTokens } from './themes'
import { CORE_KEYS, RESERVED_KEYS, fieldKey, isCustomField, type FormConfig } from './types'

// Mirrors DETAILS_* in supabase/functions/_shared/enquiry.ts (spec 003).
export const DETAILS_KEY_RE = /^[a-z][a-z0-9_]{0,31}$/
export const DETAILS_VALUE_MAX = 200
export const MAX_CUSTOM_FIELDS = 6
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const LAYOUTS = ['card', 'split', 'minimal']
const OVERRIDE_KEYS = ['accent', 'accentText', 'bg', 'surface', 'text']
/** WCAG AA for body text. */
export const MIN_TEXT_CONTRAST = 4.5
/** WCAG AA for UI component edges and focus indicators. */
export const MIN_UI_CONTRAST = 3

function channel(v: number): number {
  const s = v / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG relative luminance of a #rgb / #rrggbb colour. */
export function relativeLuminance(hex: string): number {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

type Pair = [fg: keyof ThemeTokens, bg: keyof ThemeTokens, min: number, what: string]

const CONTRAST_PAIRS: Pair[] = [
  ['text', 'bg', MIN_TEXT_CONTRAST, 'body text on the page background'],
  ['text', 'surface', MIN_TEXT_CONTRAST, 'body text on the form surface'],
  ['text', 'field', MIN_TEXT_CONTRAST, 'typed text in inputs'],
  ['accentText', 'accent', MIN_TEXT_CONTRAST, 'button text on the accent'],
  ['muted', 'bg', MIN_TEXT_CONTRAST, 'secondary text on the page background'],
  ['muted', 'surface', MIN_TEXT_CONTRAST, 'secondary text on the form surface'],
  ['muted', 'field', MIN_TEXT_CONTRAST, 'placeholders in inputs'],
  ['error', 'surface', MIN_TEXT_CONTRAST, 'error messages on the form surface'],
  ['error', 'bg', MIN_TEXT_CONTRAST, 'error messages on the page background'],
  ['accent', 'surface', MIN_UI_CONTRAST, 'focus rings and selected chips on the form surface'],
  ['accent', 'bg', MIN_UI_CONTRAST, 'focus rings on the page background'],
  ['fieldBorder', 'field', MIN_UI_CONTRAST, 'input outlines'],
]

/** Contrast failures for a resolved token set, as readable messages. */
export function contrastErrors(t: ThemeTokens): string[] {
  const errors: string[] = []
  for (const [fg, bg, min, what] of CONTRAST_PAIRS) {
    const a = t[fg] as string
    const b = t[bg] as string
    if (!HEX_RE.test(a) || !HEX_RE.test(b)) continue // reported as a bad hex instead
    const ratio = contrastRatio(a, b)
    if (ratio < min) {
      errors.push(`theme: ${fg} ${a} on ${bg} ${b} is ${ratio.toFixed(2)}:1, below ${min}:1 (${what})`)
    }
  }
  return errors
}

export type ConfigValidation = { ok: boolean; errors: string[] }

function blank(s: unknown): boolean {
  return typeof s !== 'string' || s.trim() === ''
}

function checkOptions(where: string, options: unknown, errors: string[]) {
  if (!Array.isArray(options)) {
    errors.push(`${where}: options must be a list`)
    return
  }
  if (options.length < 2 || options.length > 12) {
    errors.push(`${where}: needs 2 to 12 options, has ${options.length}`)
  }
  const seen = new Set<string>()
  for (const opt of options) {
    if (blank(opt)) errors.push(`${where}: options must be non-empty text`)
    else if ([...(opt as string)].length > DETAILS_VALUE_MAX) {
      errors.push(`${where}: option "${(opt as string).slice(0, 30)}…" is longer than ${DETAILS_VALUE_MAX} characters`)
    } else if (seen.has(opt as string)) errors.push(`${where}: option "${opt}" is listed twice`)
    seen.add(opt as string)
  }
}

/**
 * Checks a FormConfig against the rules in spec 003. Returns every problem as
 * a readable message (prefixed with the slug) so a bad config fails its test
 * with something a person can fix.
 */
export function validateFormConfig(config: FormConfig): ConfigValidation {
  const errors: string[] = []

  if (blank(config.slug) || !SLUG_RE.test(config.slug)) {
    errors.push(`slug "${config.slug}" must be lowercase letters, digits and single dashes`)
  }
  if (blank(config.sourceKey)) errors.push('sourceKey is required (sources.public_key on the server)')
  if (blank(config.studio?.name)) errors.push('studio.name is required')
  if (blank(config.studio?.area)) errors.push('studio.area is required')
  if (normalizeIndianMobile(config.studio?.whatsappFallback ?? '') === null) {
    errors.push(`studio.whatsappFallback "${config.studio?.whatsappFallback}" is not a valid Indian (+91) mobile number`)
  }
  if (!LAYOUTS.includes(config.layout)) {
    errors.push(`layout "${config.layout}" is not one of ${LAYOUTS.join(', ')}`)
  }
  if (blank(config.copy?.headline)) errors.push('copy.headline is required')
  if (blank(config.copy?.intro)) errors.push('copy.intro is required')

  // Theme
  const preset = config.theme?.preset
  const knownPreset = Object.prototype.hasOwnProperty.call(THEMES, preset)
  if (!knownPreset) {
    errors.push(`theme.preset "${preset}" is not one of ${Object.keys(THEMES).join(', ')}`)
  }
  let badHex = false
  for (const [key, value] of Object.entries(config.theme?.overrides ?? {})) {
    if (!OVERRIDE_KEYS.includes(key)) {
      errors.push(`theme.overrides.${key} is not overridable (use ${OVERRIDE_KEYS.join(', ')})`)
    } else if (typeof value !== 'string' || !HEX_RE.test(value)) {
      errors.push(`theme.overrides.${key} "${value}" is not a hex colour like #1F5A50`)
      badHex = true
    }
  }
  if (knownPreset && !badHex) errors.push(...contrastErrors(resolveTheme(config.theme)))

  // Fields
  const fields = Array.isArray(config.fields) ? config.fields : []
  const keys = new Set<string>()
  let customCount = 0
  for (const [i, field] of fields.entries()) {
    const key = fieldKey(field)
    const where = `fields[${i}] (${key})`
    if (keys.has(key)) errors.push(`${where}: field key "${key}" is used more than once`)
    keys.add(key)

    if (isCustomField(field)) {
      customCount++
      if (!DETAILS_KEY_RE.test(field.key)) {
        errors.push(`${where}: custom key "${field.key}" must match ^[a-z][a-z0-9_]{0,31}$`)
      }
      if ((RESERVED_KEYS as readonly string[]).includes(field.key)) {
        errors.push(`${where}: custom key "${field.key}" clashes with a built-in field`)
      }
      if (blank(field.label)) errors.push(`${where}: label is required`)
      if (field.kind === 'chips' || field.kind === 'select') checkOptions(where, field.options, errors)
      if (field.kind === 'text' && field.maxLength !== undefined) {
        if (!Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > DETAILS_VALUE_MAX) {
          errors.push(`${where}: maxLength must be a whole number from 1 to ${DETAILS_VALUE_MAX}`)
        }
      }
    } else if (field.kind === 'bhk') {
      if (field.options !== undefined) {
        if (field.options.length === 0) errors.push(`${where}: options must not be empty`)
        const unknown = field.options.filter((o) => !(BHK_OPTIONS as readonly string[]).includes(o))
        if (unknown.length > 0) {
          errors.push(`${where}: options ${unknown.map((o) => `"${o}"`).join(', ')} are not in the server's list (${BHK_OPTIONS.join(', ')})`)
        }
        if (new Set(field.options).size !== field.options.length) errors.push(`${where}: options repeat`)
      }
    } else if (field.kind === 'possession_month') {
      const n = field.monthsAhead
      if (n !== undefined && (!Number.isInteger(n) || n < 1 || n > 60)) {
        errors.push(`${where}: monthsAhead must be a whole number from 1 to 60`)
      }
    } else if (!(CORE_KEYS as readonly string[]).includes(key)) {
      errors.push(`${where}: unknown field kind`)
    }
  }
  if (customCount > MAX_CUSTOM_FIELDS) {
    errors.push(`fields: at most ${MAX_CUSTOM_FIELDS} custom questions, found ${customCount}`)
  }
  for (const required of ['name', 'phone']) {
    if (!keys.has(required)) errors.push(`fields: must include the ${required} field`)
  }

  const prefix = blank(config.slug) ? 'config' : config.slug
  return { ok: errors.length === 0, errors: errors.map((e) => `${prefix}: ${e}`) }
}
