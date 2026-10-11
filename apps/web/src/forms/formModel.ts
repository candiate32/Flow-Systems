// Pure logic that turns a FormConfig plus the visitor's answers into errors and
// the ingest-form payload. Core-field rules come from lib/enquiry (the client
// mirror of the server's parseEnquiry); this adds what the config asks for.
import { BHK_OPTIONS, normalizeIndianMobile, validateEnquiry, type EnquiryForm, type FieldErrors } from '../lib/enquiry'
import { DETAILS_VALUE_MAX } from './validateConfig'
import { fieldKey, isCustomField, type Bhk, type FormConfig, type FormField } from './types'

export type FormValues = Record<string, string>

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/
export const DEFAULT_MONTHS_AHEAD = 18

/** The config's fields with name and phone guaranteed (they are mandatory even if a config forgets them). */
export function resolveFields(config: FormConfig): FormField[] {
  const fields = [...config.fields]
  if (!fields.some((f) => f.kind === 'phone')) fields.unshift({ kind: 'phone' })
  if (!fields.some((f) => f.kind === 'name')) fields.unshift({ kind: 'name' })
  return fields
}

export function bhkOptions(field: Extract<FormField, { kind: 'bhk' }>): readonly Bhk[] {
  return field.options && field.options.length > 0 ? field.options : BHK_OPTIONS
}

export function defaultLabel(field: FormField): string {
  switch (field.kind) {
    case 'name':
      return field.label ?? 'Name'
    case 'phone':
      return field.label ?? 'WhatsApp number'
    case 'bhk':
      return field.label ?? 'Home type'
    case 'possession_month':
      return field.label ?? 'Possession month'
    default:
      return field.label
  }
}

export function isRequired(field: FormField): boolean {
  if (field.kind === 'name' || field.kind === 'phone') return true
  if (field.kind === 'bhk' || field.kind === 'possession_month') return field.required === true
  return field.required === true
}

export function textMaxLength(field: Extract<FormField, { kind: 'text' }>): number {
  return Math.min(field.maxLength ?? DETAILS_VALUE_MAX, DETAILS_VALUE_MAX)
}

/** Maps the visitor's answers to the shape lib/enquiry posts; custom answers go in details. */
export function toEnquiryForm(fields: FormField[], values: FormValues, consent: boolean): EnquiryForm {
  const details: Record<string, string> = {}
  for (const field of fields) {
    if (!isCustomField(field)) continue
    const v = (values[field.key] ?? '').trim()
    if (v) details[field.key] = v
  }
  const month = values.possession_month ?? ''
  return {
    name: values.name ?? '',
    phone: values.phone ?? '',
    bhk: fields.some((f) => f.kind === 'bhk') ? (values.bhk ?? '') : '',
    possessionMonth: MONTH_RE.test(month) ? month : '',
    consent,
    details,
  }
}

/** Client-side errors for this config, keyed like the server's (core JSON names, or custom keys). */
export function validateValues(fields: FormField[], values: FormValues, consent: boolean): FieldErrors {
  const month = values.possession_month ?? ''
  const errors = validateEnquiry({ ...toEnquiryForm(fields, values, consent), possessionMonth: month })
  for (const field of fields) {
    const key = fieldKey(field)
    const value = (values[key] ?? '').trim()
    if (field.kind === 'bhk') {
      if (value && !bhkOptions(field).includes(value as Bhk)) errors.bhk = 'Choose one of the options.'
      else if (!value && field.required) errors.bhk = 'Choose your home type.'
    } else if (field.kind === 'possession_month') {
      if (value && !MONTH_RE.test(value)) errors.possession_month = 'Choose both a month and a year.'
      else if (!value && field.required) errors.possession_month = 'Choose a month and year.'
    } else if (isCustomField(field)) {
      if (!value) {
        if (field.required) errors[key] = field.kind === 'text' ? 'Please fill this in.' : 'Choose one of the options.'
      } else if (field.kind !== 'text' && !field.options.includes(value)) {
        errors[key] = 'Choose one of the options.'
      } else if (field.kind === 'text' && [...value].length > textMaxLength(field)) {
        errors[key] = `Keep this under ${textMaxLength(field)} characters.`
      }
    }
  }
  return errors
}

/** Error keys in the order they appear on screen, so focus goes to the first one. */
export function errorOrder(fields: FormField[]): string[] {
  return [...fields.map(fieldKey), 'consent']
}

/** "+919876543345" → "+91 98•••••345". */
export function maskPhone(e164: string): string {
  const digits = e164.replace(/^\+91/, '')
  if (!/^\d{10}$/.test(digits)) return e164
  return `+91 ${digits.slice(0, 2)}•••••${digits.slice(7)}`
}

/** wa.me link to the studio's fallback number, with a friendly prefilled message. */
export function whatsappLink(fallback: string, text: string): string {
  const e164 = normalizeIndianMobile(fallback)
  const digits = (e164 ?? fallback).replace(/\D/g, '')
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

/** Today's year and month in IST (the studio's calendar). */
export function istYearMonth(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit' })
    .formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')?.value)
  const month = Number(parts.find((p) => p.type === 'month')?.value)
  return { year, month }
}

/** Years offered by the possession picker: this year (IST) through the last one within monthsAhead. */
export function possessionYears(now: Date, monthsAhead: number = DEFAULT_MONTHS_AHEAD): number[] {
  const { year, month } = istYearMonth(now)
  const last = year + Math.floor((month - 1 + monthsAhead) / 12)
  const years: number[] = []
  for (let y = year; y <= last; y++) years.push(y)
  return years
}
