import { supabasePublishableKey, supabaseUrl } from './config'

export const BHK_OPTIONS = ['1BHK', '2BHK', '3BHK', '4BHK+', 'Villa', 'Office'] as const

export type EnquiryForm = {
  name: string
  phone: string
  bhk: string
  possessionMonth: string
  consent: boolean
  /** Custom-question answers, keyed by the config's field key (spec 003). */
  details?: Record<string, string>
}

export type FieldErrors = Partial<Record<string, string>>

/** Mirrors normalizeIndianMobile in supabase/functions/_shared/phone.ts. */
export function normalizeIndianMobile(input: string): string | null {
  let digits = input.replace(/[\s\-().]/g, '')
  if (digits.startsWith('+91')) digits = digits.slice(3)
  else if (digits.startsWith('0091')) digits = digits.slice(4)
  else if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null
}

/** Client-side mirror of parseEnquiry in supabase/functions/_shared/enquiry.ts. */
export function validateEnquiry(form: EnquiryForm): FieldErrors {
  const errors: FieldErrors = {}
  const name = form.name.trim()
  if (name.length < 1) errors.name = 'Please enter your name.'
  else if (name.length > 80) errors.name = 'Name must be 80 characters or fewer.'
  if (!normalizeIndianMobile(form.phone)) errors.phone = 'Enter a valid Indian mobile number.'
  if (form.bhk && !(BHK_OPTIONS as readonly string[]).includes(form.bhk)) {
    errors.bhk = 'Choose a home type from the list.'
  }
  if (form.possessionMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(form.possessionMonth)) {
    errors.possession_month = 'Choose a month.'
  }
  if (!form.consent) errors.consent = 'Please agree to be contacted on WhatsApp.'
  return errors
}

export type SubmitResult =
  | { kind: 'success'; duplicate: boolean; ackSent: boolean }
  | { kind: 'invalid'; errors: FieldErrors }
  | { kind: 'failed' }

/** The JSON body ingest-form expects. Blank optional answers are sent as null / left out. */
export function enquiryBody(form: EnquiryForm, turnstileToken: string | null, sourceKey: string) {
  return {
    source_key: sourceKey,
    name: form.name.trim(),
    phone: form.phone.trim(),
    bhk: form.bhk || null,
    possession_month: form.possessionMonth || null,
    consent: form.consent,
    turnstile_token: turnstileToken,
    details: form.details ?? {},
  }
}

export async function submitEnquiry(
  form: EnquiryForm,
  turnstileToken: string | null,
  sourceKey: string,
): Promise<SubmitResult> {
  const body = enquiryBody(form, turnstileToken, sourceKey)
  let res: Response
  try {
    res = await fetch(`${supabaseUrl()}/functions/v1/ingest-form`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabasePublishableKey(),
      },
      body: JSON.stringify(body),
    })
  } catch {
    return { kind: 'failed' }
  }
  const data: unknown = await res.json().catch(() => null)
  if (res.ok) {
    const flags = (data && typeof data === 'object' ? data : {}) as { duplicate?: unknown; ack_sent?: unknown }
    // ack_sent is false when the lead was saved but the WhatsApp reply could not be sent.
    return { kind: 'success', duplicate: flags.duplicate === true, ackSent: flags.ack_sent !== false }
  }
  if (res.status === 400 && data && typeof data === 'object') {
    const errors = (data as { errors?: unknown }).errors
    if (errors && typeof errors === 'object') {
      const out: FieldErrors = {}
      for (const [k, v] of Object.entries(errors)) if (typeof v === 'string') out[k] = v
      if (Object.keys(out).length > 0) return { kind: 'invalid', errors: out }
    }
  }
  return { kind: 'failed' }
}
