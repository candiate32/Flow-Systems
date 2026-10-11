# 002: Phase 1 demo slice

Roadmap Phase 1. One fictional client, **Demo Interiors, Sarjapur Road**, clearly labelled as a demo. Prajin uses it in sales meetings: he fills the form on his phone and the WhatsApp reply arrives in under 60 seconds.

The real WhatsApp provider is chosen in the Phase 0 spike (spec 001), so this slice talks to WhatsApp through a provider interface. The `fake` provider records sends in the database; the real adapter is one new file after the spike.

## The bar (what the reviewer grades against)

The slice passes when all of these are true on a fresh clone:

1. `npm ci && npm run typecheck && npm run lint && npm test && npm run build` pass.
2. `deno check` and `deno test` pass for everything under `supabase/functions`.
3. `supabase db reset` applies all migrations and the seed cleanly; `supabase test db` passes, including a test proving a member of org A cannot read org B's leads, messages or events, and an anonymous user can read nothing.
4. **End to end, run for real:** with `supabase start` and `supabase functions serve`, a POST of the demo form to `ingest-form` returns 200 and, in the database, creates exactly one lead with the phone in `+91XXXXXXXXXX` form, one outbound `template` message `enquiry_ack` to the lead, one outbound `template` message `owner_alert` per owner phone, `first_auto_reply_at` set, and an `events` row for each step. Total handling time under 2 seconds locally.
5. Posting the same phone again within 24 hours returns 200 with `duplicate: true` and sends nothing new.
6. Bad input (missing consent, invalid phone, unknown source key) returns 400 with field errors and writes no lead.
7. The web app's `/` page renders the form (name, phone, BHK, possession month, consent checkbox), submits it to `ingest-form`, shows a success state, and on failure shows a "Chat on WhatsApp" fallback link. `/admin` lists leads with their reply time for a signed-in org member.

Max 3 review rounds. Formatting and naming are not grounds for rejection; behaviour, tests, security and the items above are.

## Data model (migrations, owned by the schema slice)

All tables in `public`, RLS on every table. Times are `timestamptz` (UTC). Writes happen only from Edge Functions using the service role, so tables get **select** policies for org members and no insert/update/delete policies.

- `orgs`: `id uuid pk default gen_random_uuid()`, `name text not null`, `slug text unique not null`, `timezone text not null default 'Asia/Kolkata'`, `owner_alert_phones text[] not null default '{}'` (E.164), `whatsapp_fallback_phone text` (E.164, shown on the form if submit fails), `is_demo boolean not null default false`, `created_at timestamptz not null default now()`.
- `org_members`: `org_id uuid references orgs on delete cascade`, `user_id uuid references auth.users on delete cascade`, `role text not null check (role in ('owner','staff','admin'))`, `created_at`, primary key `(org_id, user_id)`.
- `sources`: `id uuid pk`, `org_id uuid not null references orgs on delete cascade`, `kind text not null check (kind in ('web_form','whatsapp_inbound'))`, `name text not null`, `public_key text unique not null` (sent by the form; not a secret), `created_at`.
- `leads`: `id uuid pk`, `org_id uuid not null references orgs on delete cascade`, `source_id uuid references sources on delete set null`, `name text not null`, `phone_e164 text not null`, `bhk text`, `possession_month text` (`YYYY-MM`), `consent_at timestamptz not null`, `status text not null default 'new' check (status in ('new','contacted','consult_booked','site_measured','quote_sent','signed','lost'))`, `last_enquiry_at timestamptz not null default now()`, `first_auto_reply_at timestamptz`, `first_human_reply_at timestamptz`, `last_inbound_at timestamptz`, `created_at`. Unique `(org_id, phone_e164)`.
- `messages`: `id uuid pk`, `org_id uuid not null references orgs on delete cascade`, `lead_id uuid references leads on delete cascade` (null for owner alerts), `to_phone text`, `direction text not null check (direction in ('outbound','inbound','echo'))`, `kind text not null check (kind in ('template','session'))`, `template_name text`, `body text`, `provider text not null`, `provider_message_id text`, `status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed'))`, `error text`, `created_at`, `sent_at timestamptz`. Unique `(provider, provider_message_id)` where not null.
- `events`: `id bigint generated always as identity pk`, `org_id uuid not null references orgs on delete cascade`, `lead_id uuid references leads on delete cascade`, `type text not null`, `payload jsonb not null default '{}'`, `created_at`. Index on `(org_id, created_at desc)`.
- `webhook_events`: `id bigint identity pk`, `provider text not null`, `provider_event_id text not null`, `payload jsonb not null`, `received_at default now()`, `processed_at timestamptz`, unique `(provider, provider_event_id)`. RLS on, no policies (service role only).

Helper: `private.is_org_member(org uuid) returns boolean`, `security definer`, `set search_path = ''`, checks `org_members` for `auth.uid()`. The `private` schema is not exposed by the API.

Seed (`supabase/seed.sql`): org `Demo Interiors, Sarjapur Road` (slug `demo-interiors`, `is_demo = true`, owner phone `+919000000001`, fallback `+919000000001`), source `web_form` with public key `demo-web-form`.

## Engine library (`supabase/functions/_shared`, owned by the engine slice)

Pure Deno modules, no network, each with a `*_test.ts` beside it.

- `phone.ts`: `normalizeIndianMobile(input: string): string | null`. Accepts spaces, dashes, brackets, a leading `0`, `91`, `+91` or `0091`. Returns `+91` plus 10 digits starting 6–9, else `null`.
- `enquiry.ts`: `parseEnquiry(body: unknown): { ok: true; value: Enquiry } | { ok: false; errors: Record<string, string> }` where `Enquiry = { sourceKey: string; name: string; phone: string /* E.164 */; bhk: string | null; possessionMonth: string | null; consent: true; turnstileToken: string | null }`. JSON fields: `source_key`, `name` (1–80 chars, trimmed), `phone`, `bhk` (one of `1BHK`,`2BHK`,`3BHK`,`4BHK+`,`Villa`,`Office`, optional), `possession_month` (`YYYY-MM`, optional), `consent` (must be `true`), `turnstile_token` (optional).
- `window.ts`: `isInsideServiceWindow(lastInboundAt: Date | null, now: Date): boolean`, true when the lead messaged us less than 24 hours ago.
- `followups.ts`: `followUpTimes(enquiryAt: Date): Date[]`, three times at 11:00 IST on day 1, 3 and 7 after the enquiry's IST date.
- `dedupe.ts`: `isDuplicateEnquiry(lastEnquiryAt: Date | null, now: Date): boolean`, true within 24 hours.
- `whatsapp.ts`: `interface WhatsAppProvider { name: string; sendTemplate(msg: { to: string; template: 'enquiry_ack' | 'followup' | 'owner_alert'; language: string; params: string[] }): Promise<{ providerMessageId: string }> }`, a `FakeWhatsAppProvider` that returns `fake-<uuid>` ids and keeps a `sent` array, and `getWhatsAppProvider(env: (k: string) => string | undefined): WhatsAppProvider` that returns the fake unless `WHATSAPP_PROVIDER` names a real one (none yet; throw for unknown).
- `http.ts`: `corsHeaders`, `json(status, body)` helper, and `handleOptions(req)`.

## ingest-form (owned by the ingest slice)

`supabase/functions/ingest-form/index.ts` exposes `handler(req, deps)` with `deps = { db: SupabaseClient (service role), provider: WhatsAppProvider, now: () => Date, verifyTurnstile: (token: string | null) => Promise<boolean> }` and wires real deps in `Deno.serve`. `verify_jwt = false` in `config.toml` (the form is public; Turnstile is the spam guard, skipped when `TURNSTILE_SECRET` is unset).

Steps, each logged to `events`: `enquiry_received` → validate (400 on errors) → Turnstile (403 on fail) → look up source by `public_key` (400 unknown) → find lead by `(org_id, phone)`; if `isDuplicateEnquiry` → event `duplicate_enquiry`, update `last_enquiry_at`, return `{ lead_id, duplicate: true }` → upsert lead (`last_enquiry_at = now`, `consent_at = now`) → send `enquiry_ack` (params: lead first name, org name) → insert message, set `first_auto_reply_at` → send `owner_alert` to each owner phone (params: lead name, phone, BHK, possession month) → insert messages → return `{ lead_id, duplicate: false }`. A provider failure is recorded as a `failed` message and an `send_failed` event and still returns 200 with `ack_sent: false` (the lead is saved; Phase 2 adds retries).

## Web (owned by the web slice)

`apps/web`, React Router. `/`: Demo Interiors landing page with a visible "Demo" label, the form, Turnstile widget when `VITE_TURNSTILE_SITE_KEY` is set, success and fallback states, a short privacy notice (who collects the data, why, that Flow Systems processes it for the studio, how to ask for deletion). `/admin`: Supabase email OTP sign-in, then a table of leads (name, phone, BHK, created, seconds to auto-reply) read with the user's session so RLS applies. Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_TURNSTILE_SITE_KEY`, `VITE_DEMO_SOURCE_KEY` (default `demo-web-form`). Mobile-first. Vitest + Testing Library tests for form validation, success, fallback and the admin table rendering from mocked data.
