// The FormConfig contract from docs/specs/003-modular-forms.md. One typed
// config per studio lives in ./configs and drives everything about its form.
import type { BHK_OPTIONS } from '../lib/enquiry'

export type Bhk = (typeof BHK_OPTIONS)[number]

export type ThemePreset = 'atelier' | 'terrazzo' | 'teak'
export type Layout = 'card' | 'split' | 'minimal'

export type CoreField =
  | { kind: 'name'; label?: string; placeholder?: string }
  | { kind: 'phone'; label?: string; hint?: string }
  | { kind: 'bhk'; label?: string; options?: Bhk[]; required?: boolean }
  | { kind: 'possession_month'; label?: string; required?: boolean; monthsAhead?: number }

export type CustomField =
  | { kind: 'chips'; key: string; label: string; options: string[]; required?: boolean }
  | { kind: 'select'; key: string; label: string; options: string[]; required?: boolean }
  | { kind: 'text'; key: string; label: string; placeholder?: string; required?: boolean; maxLength?: number }

export type FormField = CoreField | CustomField

export type ThemeOverrideKey = 'accent' | 'accentText' | 'bg' | 'surface' | 'text'

export type FormConfig = {
  slug: string
  /** sources.public_key on the server. */
  sourceKey: string
  studio: { name: string; area: string; logoText?: string; whatsappFallback: string; isDemo?: boolean }
  theme: { preset: ThemePreset; overrides?: Partial<Record<ThemeOverrideKey, string>> }
  layout: Layout
  copy: {
    headline: string
    intro: string
    submitLabel?: string
    consentLabel?: string
    successTitle?: string
    successBody?: string
    privacy?: string
  }
  /** Order = render order. Name, phone and consent are always present. */
  fields: FormField[]
}

/** Field keys that are not custom questions; custom keys may not reuse them. */
export const CORE_KEYS = ['name', 'phone', 'bhk', 'possession_month'] as const
export const RESERVED_KEYS = [...CORE_KEYS, 'consent', 'source_key', 'turnstile_token', 'details'] as const

export function isCustomField(field: FormField): field is CustomField {
  return field.kind === 'chips' || field.kind === 'select' || field.kind === 'text'
}

/** The key a field's value and error are stored under: the core kind, or the custom key. */
export function fieldKey(field: FormField): string {
  return isCustomField(field) ? field.key : field.kind
}
