# 003: Polished, modular enquiry forms

Every studio we sign gets its own enquiry form. It should look like the studio's own brand rather than a Flow Systems template, and setting one up should take a config file, not new code. Prajin also needs a way to show a prospect "this is what your form would look like" in a meeting.

## The bar (what the reviewer grades against)

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run build`, `deno check` + `deno test -A supabase/functions`, `supabase db reset` + `supabase test db`, and `scripts/e2e-ingest.sh` all pass.
2. **One config drives a form.** A studio's form is a single typed `FormConfig` object in `apps/web/src/forms/configs/<slug>.ts`, registered in one index. Adding a new studio form needs no other code change. Theme, layout, copy, field order, which optional fields show, labels and options, and custom questions all come from the config.
3. `validateFormConfig(config)` rejects bad configs with readable messages, and a test runs it over every registered config: unique field keys, custom keys matching `^[a-z][a-z0-9_]{0,31}$` and not clashing with core keys, at most 6 custom fields, BHK options a subset of the server's list, select/chips fields with 2–12 options, a known theme preset, a valid hex colour for every override, a fallback WhatsApp number that normalises to +91.
4. **Three theme presets and three layouts**, freely combined: presets set colours, radius, display and body fonts (Google Fonts, loaded only when that form renders, with system fallbacks); layouts are `card` (form card over a hero), `split` (copy left, form right on desktop, stacked on phones) and `minimal` (just the form, for embedding). Theme values reach components only through CSS variables on the form's root, so one page can show several themes at once.
5. **Routes:** `/` renders the demo studio's form. `/f/:slug` renders any registered form, and an unknown slug shows a friendly not-found. `/forms` is a gallery: one live preview per registered config in preview mode (it renders fully but submits nothing and says so), so Prajin can show prospects the options.
6. **Custom questions reach the database.** Custom field answers are sent as `details: { key: value }` and stored in a new `leads.details jsonb not null default '{}'` column. The server accepts at most 10 keys matching the key pattern, string values of at most 200 characters, and rejects anything else with a 400 naming `details`. Core-field behaviour from spec 002 is unchanged, and the e2e script still passes. `/admin` shows a lead's details.
7. **Polish, checked in a real browser at 390px and 1280px for every registered config:**
   - no horizontal scroll, and every tap target is at least 44px tall;
   - BHK and other short choices are chips (radio buttons styled as pills, keyboard operable), not a native select;
   - possession month is a month + year picker that never shows a raw "---- --" placeholder;
   - the form uses `noValidate` and shows its own inline errors, each linked to its field with `aria-describedby`, with focus moving to the first invalid field on submit;
   - the submit button shows a loading state and can't double-submit;
   - the success state confirms in the studio's voice ("We've sent you a WhatsApp…") with the number masked (`+91 98•••••345`);
   - the failure state replaces the button area with one clear "Chat on WhatsApp instead" action, not two competing buttons;
   - visible focus rings in the theme's accent colour, and body text contrast of at least 4.5:1 in every preset (the config test computes it).
8. Spec 002's bar still holds (spam check, duplicate handling, admin sign-in).

Max 3 review rounds. Behaviour, polish items above, accessibility and security are grounds for rejection; personal taste in colours is not.

## Config shape (contract)

```ts
type ThemePreset = 'atelier' | 'terrazzo' | 'teak'
type Layout = 'card' | 'split' | 'minimal'

type CoreField =
  | { kind: 'name'; label?: string; placeholder?: string }
  | { kind: 'phone'; label?: string; hint?: string }
  | { kind: 'bhk'; label?: string; options?: Bhk[]; required?: boolean }
  | { kind: 'possession_month'; label?: string; required?: boolean; monthsAhead?: number }

type CustomField =
  | { kind: 'chips'; key: string; label: string; options: string[]; required?: boolean }
  | { kind: 'select'; key: string; label: string; options: string[]; required?: boolean }
  | { kind: 'text'; key: string; label: string; placeholder?: string; required?: boolean; maxLength?: number }

type FormConfig = {
  slug: string
  sourceKey: string                      // sources.public_key on the server
  studio: { name: string; area: string; logoText?: string; whatsappFallback: string; isDemo?: boolean }
  theme: { preset: ThemePreset; overrides?: Partial<Record<'accent' | 'accentText' | 'bg' | 'surface' | 'text', string>> }
  layout: Layout
  copy: { headline: string; intro: string; submitLabel?: string; consentLabel?: string; successTitle?: string; successBody?: string; privacy?: string }
  fields: (CoreField | CustomField)[]    // order = render order; name, phone and consent are always present
}
```

Name, phone and the consent checkbox are mandatory and always rendered (consent is not listed in `fields`; it sits above the submit button). Omitting `bhk` or `possession_month` from `fields` hides it.

Registered configs to ship: `demo-interiors` (Demo Interiors, Sarjapur Road; served at `/`, source `demo-web-form`), plus two more fictional demo studios with different presets, layouts and at least one custom question each (for example budget band, "Which rooms?" chips, preferred call time). They use the demo source key and are labelled as demos.

## Ownership

- Server slice: `supabase/` (new migration for `leads.details`, `_shared/enquiry.ts` details parsing, `ingest-form` storing details, tests, regenerated types).
- Web slice: `apps/web/` (form engine under `src/forms/`, themes, layouts, routes, gallery, admin details display, tests).
