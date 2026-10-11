# Flow Systems: lead engine

Flow Systems sells the **Lead Leak Fix** to Bangalore interior design studios: every enquiry gets a WhatsApp reply in under 60 seconds, follow-ups on day 1, 3 and 7, owner alerts, response-time metrics and a weekly report. This repo is the code for that product and nothing else.

## Layout

- `apps/web`: React 19 + Vite + TypeScript + Tailwind 4. Demo landing pages, the admin page, later the client portal. Deployed to Cloudflare Pages.
- `supabase/migrations`: the database schema. The schema plus generated types are the contract between the engine and the web app.
- `supabase/functions`: Edge Functions (Deno, TypeScript). The lead engine lives here: ingest, WhatsApp send/receive, follow-ups, reports.
- `supabase/tests/database`: pgTAP tests, run with `supabase test db`.
- `docs/specs`: one short spec per feature, written before the code.

## Commands

```
npm install
npm run dev -w @flow/web        # web app on localhost:5173
npm run typecheck && npm run lint && npm test
npx supabase start              # local stack (needs Docker)
npx supabase test db            # database + RLS tests
deno check supabase/functions/*/index.ts
```

## Rules

- Small PRs. Tests first for engine logic. Mourya reads and merges every PR; CI must be green.
- Every table has `org_id` and row-level security; CI fails if a public table has RLS off. Add a test proving org A can't read org B's rows.
- Secrets (Supabase `service_role`/secret key, WhatsApp provider keys, Resend key) live only in Supabase secrets and GitHub Actions secrets. Anything prefixed `VITE_` ships to the browser.
- Store times in UTC; schedule and display in IST (Asia/Kolkata).
- Phone numbers go through one normalisation function to E.164 (+91…), with tests.
- Webhooks are stored raw and processed once per event ID; providers retry.
- WhatsApp: utility templates outside the 24-hour window, free-form inside it. Only message people who gave consent. No broadcasts.
- Client lead data stays in India (Supabase Mumbai) and is deleted on request.
- No n8n, third-party CRM, custom inbox, AI chat agent or voice agent in the client path for v1.
- Check current library docs (Context7) before using an API you haven't used in this repo.

## How we build: the boss loop

1. **Spec first.** Each feature gets `docs/specs/NNN-name.md` with a concrete bar: the exact things that must run and be true when it's done.
2. **Prototype cheap.** Get the shape right with one agent, or a few workers on separate slices (separate directories, never the same file). No strict review yet.
3. **Polish under the boss.** Run the `boss-reviewer` agent (`.claude/agents/boss-reviewer.md`). It didn't write the code; it runs the thing end to end and grades it against the spec's bar, then returns PASS or a numbered list of specific failures. Workers fix, boss re-checks. **Max 3 rounds**; after that a person decides.
4. Skip the boss for small, well-specified changes and for exploration.
