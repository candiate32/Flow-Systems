import { useEffect, useRef } from 'react'
import { displayClass, primaryButtonClass } from './ui'

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
    />
  )
}

export function SubmitButton({ label, busy }: { label: string; busy: boolean }) {
  return (
    <button type="submit" disabled={busy} aria-disabled={busy || undefined} className={`${primaryButtonClass} disabled:brightness-95`}>
      {busy && <Spinner />}
      <span>{busy ? 'Sending…' : label}</span>
    </button>
  )
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5 fill-current">
      <path d="M12 2.2A9.8 9.8 0 0 0 3.6 17l-1.3 4.8 4.9-1.3A9.8 9.8 0 1 0 12 2.2Zm0 17.8a8 8 0 0 1-4.1-1.1l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1 1 12 20Zm4.4-6c-.2-.1-1.4-.7-1.7-.8-.2-.1-.4-.1-.5.1l-.8.9c-.1.2-.3.2-.5.1a6.5 6.5 0 0 1-3.3-2.8c-.2-.4.2-.4.7-1.2.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a.9.9 0 0 0-.6.3 2.7 2.7 0 0 0-.9 2c0 1.2.9 2.4 1 2.5.1.2 1.7 2.7 4.3 3.8 1.6.7 2.2.7 3 .6.5-.1 1.4-.6 1.6-1.1.2-.6.2-1 .1-1.1l-.6-.4Z" />
    </svg>
  )
}

/** Replaces the submit button when sending fails: one clear way forward. */
export function FailureAction({ href, studioName }: { href: string; studioName: string }) {
  return (
    <div role="alert" className="rounded-[var(--ff-radius)] border border-[var(--ff-border)] bg-[var(--ff-bg)] p-4">
      <p className="font-semibold">We couldn't send your enquiry just now.</p>
      <p className="mt-1 text-sm leading-relaxed text-[var(--ff-muted)]">
        Message {studioName} on WhatsApp instead and we'll pick it up from there.
      </p>
      <a href={href} target="_blank" rel="noopener noreferrer" className={`${primaryButtonClass} mt-4`}>
        <WhatsAppIcon />
        Chat on WhatsApp instead
      </a>
    </div>
  )
}

type SuccessProps = {
  title: string
  body: string
  maskedPhone: string
  preview: boolean
  onReset?: () => void
}

/** Shown in place of the form. Takes focus so screen readers announce it. */
export function SuccessState({ title, body, maskedPhone, preview, onReset }: SuccessProps) {
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
  }, [])
  return (
    <section role="status" className="py-2 text-center @md:py-6">
      <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--ff-accent)] text-[var(--ff-accent-text)]">
        <svg aria-hidden="true" viewBox="0 0 24 24" className="size-7 fill-none stroke-current stroke-[2.5]">
          <path d="m5 12.5 4.5 4.5L19 7.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h2 ref={heading} tabIndex={-1} className={`${displayClass} mt-5 text-[calc(1.75rem*var(--ff-display-scale))] leading-tight outline-none`}>
        {title}
      </h2>
      <p className="mt-3 text-[var(--ff-muted)]">
        Sent to <span className="font-semibold whitespace-nowrap text-[var(--ff-text)] tabular-nums">{maskedPhone}</span>
      </p>
      <p className="mx-auto mt-3 max-w-sm leading-relaxed">{body}</p>
      {preview && (
        <div className="mt-6 border-t border-[var(--ff-border)] pt-4">
          <p className="text-sm text-[var(--ff-muted)]">Preview only: nothing was sent.</p>
          <button
            type="button"
            onClick={onReset}
            className="mt-2 min-h-11 rounded-[var(--ff-radius)] px-4 text-sm font-semibold text-[var(--ff-text)] underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-accent)]"
          >
            Reset preview
          </button>
        </div>
      )}
    </section>
  )
}

export function PreviewNote() {
  return (
    <p className="flex items-center gap-2 rounded-[var(--ff-radius)] border border-dashed border-[var(--ff-field-border)] px-3 py-2 text-sm text-[var(--ff-muted)]">
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0 fill-none stroke-current stroke-[1.75]">
        <path d="M1.5 10S4.5 4 10 4s8.5 6 8.5 6-3 6-8.5 6-8.5-6-8.5-6Z" />
        <circle cx="10" cy="10" r="2.5" />
      </svg>
      Preview: this form works but sends nothing.
    </p>
  )
}
