// Shared class strings. Every colour, radius and font is a --ff-* variable set
// on the form root by themeStyle(), never a literal, so themes stay swappable.

export const focusRing =
  // Not outline-none: in Tailwind 4 it sets --tw-outline-style: none, which would cancel the ring below.
  'focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[var(--ff-accent)]'

export const labelClass = 'block text-[0.9375rem] font-semibold leading-snug text-[var(--ff-text)]'

export const hintClass = 'mt-1 text-sm leading-snug text-[var(--ff-muted)]'

export const controlClass = [
  'mt-2 block min-h-12 w-full rounded-[var(--ff-radius)] border border-[var(--ff-field-border)]',
  'bg-[var(--ff-field)] px-3.5 py-2.5 text-base text-[var(--ff-text)] placeholder:text-[var(--ff-muted)]',
  'transition-colors hover:border-[var(--ff-accent)] focus-visible:border-[var(--ff-accent)]',
  'aria-[invalid=true]:border-[var(--ff-error)] aria-[invalid=true]:shadow-[inset_0_0_0_1px_var(--ff-error)]',
  focusRing,
].join(' ')

export const displayClass =
  'font-[family-name:var(--ff-font-display)] [font-weight:var(--ff-display-weight)] tracking-[var(--ff-display-tracking)]'

export const primaryButtonClass = [
  'inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--ff-radius)] px-5 py-3',
  'bg-[var(--ff-accent)] text-base font-semibold text-[var(--ff-accent-text)] no-underline',
  'transition-[filter] hover:brightness-110 active:brightness-95 disabled:cursor-progress',
  focusRing,
].join(' ')
