import { describe, expect, it } from 'vitest'
import { maskPhone, possessionYears, resolveFields, toEnquiryForm, validateValues, whatsappLink } from './formModel'
import type { FormConfig, FormField } from './types'

describe('maskPhone', () => {
  it('shows the first two and last three digits', () => {
    expect(maskPhone('+919876543345')).toBe('+91 98•••••345')
  })
  it('leaves anything that is not +91 and ten digits alone', () => {
    expect(maskPhone('12345')).toBe('12345')
  })
})

describe('whatsappLink', () => {
  it('normalises the fallback number and encodes the message', () => {
    expect(whatsappLink('+91 90000 00001', 'Hi there & hello')).toBe('https://wa.me/919000000001?text=Hi%20there%20%26%20hello')
  })
})

describe('possessionYears', () => {
  it('runs from this IST year to the last year within monthsAhead', () => {
    // 2026-12-31 20:00 UTC is already January 2027 in IST.
    expect(possessionYears(new Date('2026-12-31T20:00:00Z'), 12)).toEqual([2027, 2028])
    expect(possessionYears(new Date('2026-10-11T00:00:00Z'), 18)).toEqual([2026, 2027, 2028])
    expect(possessionYears(new Date('2026-10-11T00:00:00Z'), 2)).toEqual([2026])
  })
})

describe('form model', () => {
  const fields: FormField[] = [
    { kind: 'name' },
    { kind: 'phone' },
    { kind: 'bhk', required: true, options: ['2BHK', '3BHK'] },
    { kind: 'text', key: 'notes', label: 'Notes', maxLength: 5 },
  ]

  it('always includes name and phone', () => {
    const config = { fields: [{ kind: 'bhk' }] } as FormConfig
    expect(resolveFields(config).map((f) => f.kind)).toEqual(['name', 'phone', 'bhk'])
  })

  it('validates required and configured options', () => {
    expect(validateValues(fields, { name: 'A', phone: '9876543210' }, true)).toEqual({ bhk: 'Choose your home type.' })
    expect(validateValues(fields, { name: 'A', phone: '9876543210', bhk: 'Villa' }, true)).toEqual({
      bhk: 'Choose one of the options.',
    })
    expect(validateValues(fields, { name: 'A', phone: '9876543210', bhk: '2BHK', notes: 'too long' }, true)).toEqual({
      notes: 'Keep this under 5 characters.',
    })
  })

  it('maps custom answers into details', () => {
    expect(toEnquiryForm(fields, { name: 'A', phone: '1', bhk: '2BHK', notes: ' hi ' }, true)).toEqual({
      name: 'A',
      phone: '1',
      bhk: '2BHK',
      possessionMonth: '',
      consent: true,
      details: { notes: 'hi' },
    })
  })
})
