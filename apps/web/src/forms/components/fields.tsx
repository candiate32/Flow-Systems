import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { controlClass, focusRing, hintClass, labelClass } from './ui'

/** ids for a field's control, label, hint and error, all under one per-form prefix. */
export type FieldIds = { control: string; label: string; hint: string; error: string }

type ShellProps = {
  ids: FieldIds
  label: string
  required: boolean
  hint?: string
  error?: string
  /** Use a plain element instead of <label> for groups (chips, month picker). */
  group?: boolean
  children: ReactNode
}

function describedBy(ids: FieldIds, hint?: string, error?: string): string | undefined {
  const parts = [hint ? ids.hint : null, error ? ids.error : null].filter(Boolean)
  return parts.length > 0 ? parts.join(' ') : undefined
}

function OptionalTag({ required }: { required: boolean }) {
  if (required) return null
  return <span className="ml-1.5 text-sm font-normal text-[var(--ff-muted)]">(optional)</span>
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-sm font-medium leading-snug text-[var(--ff-error)]">
      <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 size-3.5 shrink-0 fill-current">
        <path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Zm0 3.25a.9.9 0 0 0-.9.9v3.4a.9.9 0 1 0 1.8 0v-3.4a.9.9 0 0 0-.9-.9Zm0 6.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
      </svg>
      <span>{message}</span>
    </p>
  )
}

function FieldShell({ ids, label, required, hint, error, group, children }: ShellProps) {
  return (
    <div>
      {group ? (
        <span id={ids.label} className={labelClass}>
          {label}
          <OptionalTag required={required} />
        </span>
      ) : (
        <label id={ids.label} htmlFor={ids.control} className={labelClass}>
          {label}
          <OptionalTag required={required} />
        </label>
      )}
      {hint && (
        <p id={ids.hint} className={hintClass}>
          {hint}
        </p>
      )}
      {children}
      <FieldError id={ids.error} message={error} />
    </div>
  )
}

type TextFieldProps = {
  ids: FieldIds
  label: string
  value: string
  onChange: (v: string) => void
  required: boolean
  hint?: string
  error?: string
  placeholder?: string
  maxLength?: number
  type?: 'text' | 'tel'
  autoComplete?: string
}

export function TextField(props: TextFieldProps) {
  const { ids, label, value, onChange, required, hint, error, placeholder, maxLength, type = 'text', autoComplete } = props
  return (
    <FieldShell ids={ids} label={label} required={required} hint={hint} error={error}>
      <input
        id={ids.control}
        name={ids.control}
        type={type}
        inputMode={type === 'tel' ? 'tel' : undefined}
        autoComplete={autoComplete}
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(ids, hint, error)}
        className={controlClass}
      />
    </FieldShell>
  )
}

function Chevron() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 fill-none stroke-[var(--ff-muted)] stroke-2"
    >
      <path d="m5 7.5 5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type NativeSelectProps = {
  id: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  options: { value: string; label: string }[]
  required: boolean
  invalid: boolean
  describedBy?: string
  labelledBy?: string
  className?: string
}

function NativeSelect(p: NativeSelectProps) {
  return (
    <div className={`relative ${p.className ?? ''}`}>
      <select
        id={p.id}
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
        aria-required={p.required || undefined}
        aria-invalid={p.invalid || undefined}
        aria-describedby={p.describedBy}
        aria-labelledby={p.labelledBy}
        className={`${controlClass} appearance-none pr-10 ${p.value ? '' : 'text-[var(--ff-muted)]'}`}
      >
        <option value="">{p.placeholder}</option>
        {p.options.map((o) => (
          <option key={o.value} value={o.value} className="text-[var(--ff-text)]">
            {o.label}
          </option>
        ))}
      </select>
      <Chevron />
    </div>
  )
}

type SelectFieldProps = {
  ids: FieldIds
  label: string
  options: string[]
  value: string
  onChange: (v: string) => void
  required: boolean
  error?: string
}

export function SelectField({ ids, label, options, value, onChange, required, error }: SelectFieldProps) {
  return (
    <FieldShell ids={ids} label={label} required={required} error={error}>
      <NativeSelect
        id={ids.control}
        value={value}
        onChange={onChange}
        placeholder="Choose…"
        options={options.map((o) => ({ value: o, label: o }))}
        required={required}
        invalid={!!error}
        describedBy={describedBy(ids, undefined, error)}
      />
    </FieldShell>
  )
}

type ChipsFieldProps = {
  ids: FieldIds
  label: string
  options: readonly string[]
  value: string
  onChange: (v: string) => void
  required: boolean
  hint?: string
  error?: string
}

/**
 * A radio group drawn as pills (WAI-ARIA radio group pattern): Tab enters the
 * group on the selected chip, arrow keys / Home / End move and select, Space
 * or Enter selects. Clicking the selected chip of an optional group clears it.
 */
export function ChipsField({ ids, label, options, value, onChange, required, hint, error }: ChipsFieldProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = options.indexOf(value)
  const tabStop = selected === -1 ? 0 : selected

  function move(to: number) {
    const n = options.length
    const i = ((to % n) + n) % n
    onChange(options[i])
    refs.current[i]?.focus()
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const keys: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowDown: i + 1,
      ArrowLeft: i - 1,
      ArrowUp: i - 1,
      Home: 0,
      End: options.length - 1,
    }
    if (e.key in keys) {
      e.preventDefault()
      move(keys[e.key])
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onChange(options[i])
    }
  }

  return (
    <FieldShell ids={ids} label={label} required={required} hint={hint} error={error} group>
      <div
        id={ids.control}
        role="radiogroup"
        aria-labelledby={ids.label}
        aria-describedby={describedBy(ids, hint, error)}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        className="mt-2.5 flex flex-wrap gap-2"
      >
        {options.map((option, i) => {
          const checked = i === selected
          return (
            <button
              key={option}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={i === tabStop ? 0 : -1}
              onClick={() => onChange(checked && !required ? '' : option)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={[
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-[0.9375rem] font-medium',
                'transition-colors',
                checked
                  ? 'border-[var(--ff-accent)] bg-[var(--ff-accent)] text-[var(--ff-accent-text)]'
                  : 'border-[var(--ff-field-border)] bg-[var(--ff-field)] text-[var(--ff-text)] hover:border-[var(--ff-accent)]',
                error && !checked ? 'border-[var(--ff-error)]' : '',
                focusRing,
              ].join(' ')}
            >
              {checked && (
                <svg aria-hidden="true" viewBox="0 0 16 16" className="-ml-1 size-3.5 fill-none stroke-current stroke-2">
                  <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
              {option}
            </button>
          )
        })}
      </div>
    </FieldShell>
  )
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

type MonthYearProps = {
  ids: FieldIds
  label: string
  /** "YYYY-MM" when complete; "YYYY-" or "-MM" while half chosen; "" when empty. */
  value: string
  onChange: (v: string) => void
  years: number[]
  required: boolean
  error?: string
}

/** Month and year as two labelled selects, so there is never a raw "---- --" placeholder. */
export function MonthYearPicker({ ids, label, value, onChange, years, required, error }: MonthYearProps) {
  const [year = '', month = ''] = value.split('-')
  const yearOptions = years.map(String)
  if (year && !yearOptions.includes(year)) yearOptions.unshift(year)

  function set(nextYear: string, nextMonth: string) {
    onChange(nextYear || nextMonth ? `${nextYear}-${nextMonth}` : '')
  }

  const desc = describedBy(ids, undefined, error)
  return (
    <FieldShell ids={ids} label={label} required={required} error={error} group>
      <div role="group" aria-labelledby={ids.label} aria-describedby={desc} className="grid grid-cols-[3fr_2fr] gap-2.5">
        <div>
          <label htmlFor={ids.control} className="sr-only">
            Month
          </label>
          <NativeSelect
            id={ids.control}
            value={month}
            onChange={(m) => set(year, m)}
            placeholder="Month"
            options={MONTHS.map((name, i) => ({ value: String(i + 1).padStart(2, '0'), label: name }))}
            required={required}
            invalid={!!error && !month}
            describedBy={desc}
          />
        </div>
        <div>
          <label htmlFor={`${ids.control}-year`} className="sr-only">
            Year
          </label>
          <NativeSelect
            id={`${ids.control}-year`}
            value={year}
            onChange={(y) => set(y, month)}
            placeholder="Year"
            options={yearOptions.map((y) => ({ value: y, label: y }))}
            required={required}
            invalid={!!error && !year}
            describedBy={desc}
          />
        </div>
      </div>
    </FieldShell>
  )
}

type ConsentProps = { id: string; errorId: string; label: string; checked: boolean; onChange: (v: boolean) => void; error?: string }

export function ConsentField({ id, errorId, label, checked, onChange, error }: ConsentProps) {
  return (
    <div>
      <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-[0.9375rem] leading-snug">
        <span className="relative mt-px flex size-5 shrink-0">
          <input
            id={id}
            type="checkbox"
            checked={checked}
            onChange={(e) => onChange(e.target.checked)}
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className={[
              'peer size-5 cursor-pointer appearance-none rounded-[min(var(--ff-radius),5px)] border-[1.5px]',
              'border-[var(--ff-field-border)] bg-[var(--ff-field)] transition-colors',
              'checked:border-[var(--ff-accent)] checked:bg-[var(--ff-accent)] hover:border-[var(--ff-accent)]',
              'aria-[invalid=true]:border-[var(--ff-error)]',
              focusRing,
            ].join(' ')}
          />
          <svg
            aria-hidden="true"
            viewBox="0 0 16 16"
            className="pointer-events-none absolute inset-0 m-auto hidden size-3.5 fill-none stroke-[var(--ff-accent-text)] stroke-[2.25] peer-checked:block"
          >
            <path d="m3.5 8.5 3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span>{label}</span>
      </label>
      <FieldError id={errorId} message={error} />
    </div>
  )
}
