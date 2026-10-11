# Flow Systems

Lead engine for the Lead Leak Fix: answers every enquiry a studio gets on WhatsApp within 60 seconds, follows up, alerts the owner and measures response time.

See [CLAUDE.md](CLAUDE.md) for the layout, commands and rules, and `docs/specs/` for feature specs.

## Quick start

Needs Node 22+ and, for the database, Docker.

```
npm install
npm run dev -w @flow/web
npx supabase start
npx supabase test db
```

## Admin access

`/admin` signs in with a 6-digit email code and shows only the leads of orgs the user belongs to. Sign-ups are closed from the page, so add a person by hand:

1. Supabase dashboard (or Studio locally) > Authentication > Add user, with their email.
2. SQL: `insert into org_members (org_id, user_id, role) values ('<org id>', '<user id>', 'owner');` The demo org's id is `00000000-0000-4000-8000-000000000001`.

On the hosted project, paste `supabase/templates/magic_link.html` into Auth > Email Templates > Magic Link so the email carries the code, and add `<site>/admin` to the allowed redirect URLs.

## End-to-end check

With the stack running (`npx supabase start`, `npx supabase functions serve`): `scripts/e2e-ingest.sh` posts the demo form and checks the lead, messages and events in the database. CI runs it on every PR.
