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
