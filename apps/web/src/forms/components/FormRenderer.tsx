import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { turnstileSiteKey } from '../../lib/config'
import { normalizeIndianMobile, submitEnquiry, type FieldErrors } from '../../lib/enquiry'
import { Turnstile } from '../../lib/Turnstile'
import {
  bhkOptions,
  defaultLabel,
  errorOrder,
  isRequired,
  maskPhone,
  possessionYears,
  resolveFields,
  textMaxLength,
  toEnquiryForm,
  validateValues,
  whatsappLink,
  type FormValues,
} from '../formModel'
import { loadThemeFonts, resolveTheme, themeStyle } from '../themes'
import { fieldKey, type FormConfig, type FormField } from '../types'
import { ChipsField, ConsentField, MonthYearPicker, SelectField, TextField, type FieldIds } from './fields'
import { FormLayout } from './layouts'
import { FailureAction, PreviewNote, SubmitButton, SuccessState } from './states'

type Props = {
  config: FormConfig
  /** Renders and validates fully but never submits; says so on the form. */
  preview?: boolean
  /**
   * The form is the page's main content: headings start at h1 and the root
   * grows to fill a flex-column parent (FormPage, Showcase).
   */
  fullPage?: boolean
}

function without(errors: FieldErrors, key: string): FieldErrors {
  const next = { ...errors }
  delete next[key]
  return next
}

type Status = 'idle' | 'submitting' | 'success' | 'failed'
type Outcome = { duplicate: boolean; ackSent: boolean }

export function FormRenderer({ config, preview = false, fullPage = false }: Props) {
  const uid = useId()
  const fields = useMemo(() => resolveFields(config), [config])
  const theme = useMemo(() => resolveTheme(config.theme), [config.theme])
  const [values, setValues] = useState<FormValues>({})
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<Status>('idle')
  const [outcome, setOutcome] = useState<Outcome>({ duplicate: false, ackSent: true })
  const [token, setToken] = useState<string | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null)
  const inFlight = useRef(false)
  const [today] = useState(() => new Date())
  const siteKey = preview ? '' : turnstileSiteKey()
  const { studio, copy } = config

  useEffect(() => loadThemeFonts(theme.fontHref), [theme.fontHref])

  const ids = (key: string): FieldIds => ({
    control: `${uid}-${key}`,
    label: `${uid}-${key}-label`,
    hint: `${uid}-${key}-hint`,
    error: `${uid}-${key}-error`,
  })

  // Move focus to the first invalid field once its error has rendered.
  useEffect(() => {
    if (!focusRequest) return
    const el = document.getElementById(`${uid}-${focusRequest.key}`)
    const target = el?.matches('input, select, textarea, button')
      ? el
      : el?.querySelector<HTMLElement>('[tabindex="0"], input, select, button')
    target?.focus()
  }, [focusRequest, uid])

  function setValue(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }))
    if (errors[key]) setErrors((errs) => without(errs, key))
  }

  function focusFirstError(errs: FieldErrors) {
    const first = errorOrder(fields).find((k) => errs[k])
    if (first) setFocusRequest({ key: first })
    return !!first
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (inFlight.current) return
    const clientErrors = validateValues(fields, values, consent)
    setErrors(clientErrors)
    if (focusFirstError(clientErrors)) return
    if (preview) {
      setOutcome({ duplicate: false, ackSent: true })
      setStatus('success')
      return
    }
    inFlight.current = true
    setStatus('submitting')
    const result = await submitEnquiry(toEnquiryForm(fields, values, consent), siteKey ? token : null, config.sourceKey)
    inFlight.current = false
    if (result.kind === 'success') {
      setOutcome({ duplicate: result.duplicate, ackSent: result.ackSent })
      setStatus('success')
    } else if (result.kind === 'invalid') {
      setErrors(result.errors)
      setStatus('idle')
      focusFirstError(result.errors)
    } else {
      setStatus('failed')
    }
  }

  function resetPreview() {
    setValues({})
    setConsent(false)
    setErrors({})
    setStatus('idle')
  }

  function renderField(field: FormField) {
    const key = fieldKey(field)
    const common = {
      ids: ids(key),
      label: defaultLabel(field),
      value: values[key] ?? '',
      onChange: (v: string) => setValue(key, v),
      required: isRequired(field),
      error: errors[key],
    }
    switch (field.kind) {
      case 'name':
        return <TextField {...common} autoComplete="name" maxLength={80} placeholder={field.placeholder} />
      case 'phone':
        return <TextField {...common} type="tel" autoComplete="tel" placeholder="98765 43210" hint={field.hint} />
      case 'bhk':
        return <ChipsField {...common} options={bhkOptions(field)} />
      case 'possession_month':
        return <MonthYearPicker {...common} years={possessionYears(today, field.monthsAhead)} />
      case 'chips':
        return <ChipsField {...common} options={field.options} />
      case 'select':
        return <SelectField {...common} options={field.options} />
      case 'text':
        return <TextField {...common} maxLength={textMaxLength(field)} placeholder={field.placeholder} />
    }
  }

  const known = new Set([...errorOrder(fields)])
  const otherErrors = Object.entries(errors).filter(([k, msg]) => !known.has(k) && msg)
  const e164 = normalizeIndianMobile(values.phone ?? '')
  const firstName = (values.name ?? '').trim().split(/\s+/)[0]
  const fallbackText = `Hi ${studio.name}, I'd like to talk about interiors for my ${values.bhk || 'home'}.${firstName ? ` (${firstName})` : ''}`
  const privacy =
    copy.privacy ??
    `${studio.name} collects your name, WhatsApp number and your answers on this form only to reply to your enquiry and follow up about your interiors. Flow Systems processes this data on the studio's behalf and stores it in India. To have your data deleted, message the studio on WhatsApp and ask; we will remove it.`

  let success: { title: string; body: string } | null = null
  if (status === 'success') {
    if (outcome.duplicate) {
      success = {
        title: 'We already have your enquiry',
        body: `${studio.name} will be in touch on WhatsApp, so there's no need to send it again.`,
      }
    } else if (!outcome.ackSent) {
      success = {
        title: "Thanks, we've got your details",
        body: `${studio.name} will message you on WhatsApp shortly.`,
      }
    } else {
      success = {
        title: copy.successTitle ?? "We've sent you a WhatsApp",
        body:
          copy.successBody ??
          `Open WhatsApp to see our message. ${studio.name} will follow up there to find a time to talk about your home.`,
      }
    }
  }

  return (
    <div
      style={themeStyle(theme)}
      data-ff-preset={config.theme.preset}
      data-ff-layout={config.layout}
      className={`@container bg-[var(--ff-bg)] font-[family-name:var(--ff-font-body)] text-[var(--ff-text)] antialiased ${fullPage ? 'flex-1' : ''}`}
    >
      <FormLayout config={config} privacy={privacy} nested={!fullPage}>
        {success ? (
          <SuccessState
            title={success.title}
            body={success.body}
            maskedPhone={maskPhone(e164 ?? values.phone ?? '')}
            preview={preview}
            onReset={resetPreview}
          />
        ) : (
          <form
            noValidate
            onSubmit={onSubmit}
            aria-busy={status === 'submitting' || undefined}
            aria-label={`Enquiry form for ${studio.name}`}
            className="space-y-6"
          >
            {preview && <PreviewNote />}
            {fields.map((field) => (
              <div key={fieldKey(field)}>{renderField(field)}</div>
            ))}
            <div className="space-y-5 border-t border-[var(--ff-border)] pt-5">
              <ConsentField
                id={ids('consent').control}
                errorId={ids('consent').error}
                label={copy.consentLabel ?? 'I agree to be contacted on WhatsApp about this enquiry'}
                checked={consent}
                onChange={(v) => {
                  setConsent(v)
                  if (errors.consent) setErrors((errs) => without(errs, 'consent'))
                }}
                error={errors.consent}
              />
              {siteKey && <Turnstile siteKey={siteKey} onToken={setToken} />}
              {otherErrors.map(([k, msg]) => (
                <p key={k} role="alert" className="text-sm font-medium text-[var(--ff-error)]">
                  {msg}
                </p>
              ))}
              {status === 'failed' ? (
                <FailureAction href={whatsappLink(studio.whatsappFallback, fallbackText)} studioName={studio.name} />
              ) : (
                <SubmitButton label={copy.submitLabel ?? 'Get a WhatsApp reply'} busy={status === 'submitting'} />
              )}
            </div>
          </form>
        )}
      </FormLayout>
    </div>
  )
}
