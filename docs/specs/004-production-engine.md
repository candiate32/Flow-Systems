# 004: Production engine v1

Roadmap Phase 2. This turns the demo slice into an engine a paying studio can rely on:
- follow-ups that stop when someone replies;
- correct use of WhatsApp's 24-hour window;
- inbound messages and staff replies tracked;
- retries that never send twice;
- response-time numbers and a weekly report;
- one-command client onboarding.

Everything except the real provider adapter is built and tested against the fake provider, so work does not wait on the WhatsApp spike (001). The adapter is slice F, one file plus its tests, once a provider passes the spike.

## Slices (one PR each, in this order)

| Slice | What | Depends on |
|---|---|---|
| A | Job queue, scheduler, retries, dead letters | none |
| B | Follow-ups and the 24-hour window | A |
| C | WhatsApp webhook: inbound, echoes, delivery status | A |
| D | Response-time metrics, weekly report, admin numbers | B, C |
| E | `onboard-org`, canary, runbook, Sentry | A |
| F | Real provider adapter + integration run on `flow-dev` | spike passed |

B and C can be built in parallel once A is merged. They touch separate files, except for the shared migration list. E can run alongside B/C.

## The bar (what the reviewer grades against)

Every slice must leave all earlier bars passing (specs 002, 003), plus:
- `npm run typecheck && npm run lint && npm test && npm run build`;
- `deno check` and `deno test -A supabase/functions`;
- `supabase db reset` and `supabase test db`;
- `scripts/e2e-ingest.sh`.

New tables get RLS, plus a test that org A can't read org B's rows.

**A. Jobs**
1. Table `jobs` has these columns:
   - `id`, `org_id`, `lead_id` (nullable);
   - `kind` (`send_message` | `followup` | `weekly_report` | `canary`);
   - `run_at`;
   - `status` (`queued` | `running` | `done` | `cancelled` | `dead`);
   - `attempts`, `max_attempts` (default 5), `last_error`, `payload jsonb`;
   - `idempotency_key text unique`;
   - `created_at`, `updated_at`.

   A `dead` row is the dead-letter record. Members can read their org's jobs.
2. `private.claim_jobs(batch int)` returns due `queued` jobs and marks them `running` using `for update skip locked`. Two concurrent claimers never get the same job (pgTAP test).
3. The `run-jobs` Edge Function runs claimed jobs through a handler per `kind`. It is called every minute by `pg_cron` through `pg_net`, with a shared secret header. It rejects calls without the secret (401).
4. A thrown handler error sets `last_error` and re-queues with backoff of 1, 5, 25 and 120 minutes. After `max_attempts` the job is `dead`, an `events` row `job_dead` is written, and an ops alert is sent to `OPS_ALERT_PHONE`.
5. `ingest-form` still sends the acknowledgement inline (the 60-second promise), but a failed send now enqueues a `send_message` job instead of only logging.
6. **Failure drill (deno test against the local DB):**
   - the provider fails for the first N calls, then recovers;
   - every message is eventually sent exactly once;
   - nothing is lost;
   - attempts and backoff match item 4.
7. **Burst:** 100 enquiries posted in under 60 seconds to `ingest-form` all return 200. There are 100 leads and 100 acknowledgements, and no duplicates (script `scripts/burst.sh`).

**B. Follow-ups and window**
1. A new (non-duplicate) enquiry enqueues three `followup` jobs at `followUpTimes()` (11:00 IST on day 1, 3 and 7). Each has idempotency key `followup:<lead_id>:<n>:<enquiry_at>`.
2. When a follow-up runs, it is skipped if the lead has replied or staff have replied since the enquiry; this is recorded as `cancelled`.
   - Otherwise it sends the `followup_<n>` template if outside the 24-hour window, and a session message with the same text if inside.
   - The choice is made by `isInsideServiceWindow`, with unit tests at 23:59 and 24:01.
3. An inbound or echo message for a lead cancels its queued follow-ups in the same transaction.
4. Follow-ups never go to a lead without `consent_at`, or after an opt-out. An opt-out is an inbound "STOP", case- and space-insensitive. It sets `leads.opted_out_at` and sends nothing further.

**C. Webhook**
1. Adapter interface in `whatsapp.ts`:
   - `verifyWebhook(req): Promise<boolean>`;
   - `parseWebhook(body): NormalizedEvent[]`, where each event has `kind`: `inbound` | `echo` | `status`, plus `providerEventId`, `phone`, `text`, `at` and `providerMessageId`;
   - `sendSession(to, text)`.

   The fake adapter implements all three.
2. `whatsapp-webhook` (`verify_jwt = false`):
   - returns 401 on a bad signature;
   - stores the raw payload in `webhook_events` before anything else;
   - processes each event once, keyed on `(provider, provider_event_id)`. A replayed delivery returns 200 and changes nothing (test).
3. Inbound from a known lead sets `last_inbound_at` and stores a `messages` row (`inbound`, `session`).
4. Inbound from an unknown number creates a lead from the org's `whatsapp_inbound` source and replies within the window with a session acknowledgement. The `consent_at` is the inbound time, since the person messaged first. It also alerts the owner, as with the form.
5. An echo sets `first_human_reply_at` if empty and stores an `echo` message.
6. A status event updates `messages.status` (`sent` → `delivered` → `read`, never backwards) or marks it `failed`.

Built as (slice C):
- The webhook adapter is in `_shared/whatsapp_webhook.ts` (sending stays in `whatsapp.ts`). Its header maps Meta's payload, including `smb_message_echoes`, onto `NormalizedEvent`.
- Routing: each org's number posts to `whatsapp-webhook?source=<public_key>` of its `whatsapp_inbound` source. The demo org's key is `demo-whatsapp-inbound`. An unknown source gets 404 after the events are stored, so the provider retries once it is fixed.
- One SQL function, `process_whatsapp_event`, applies an event and sets `processed_at` in one transaction. That includes the follow-up cancel or opt-out (B.3).
- A failed event is recorded (`attempts`, counted in SQL, and `processing_error`) and the delivery gets 500, so the provider resends it. Processed events come back as duplicates. After 3 failed attempts the event is a dead letter (`webhook_event_failed`), ops get an `ops_alert`, and the delivery gets 200.
- A lead created by its first message gets an acknowledgement. Inside the 24-hour window of that message (measured from when it was sent, not when the webhook arrived) it is the session text; outside, it is the `enquiry_ack` template. `first_auto_reply_at` is set either way. It gets no day 1/3/7 follow-ups (Mourya, 14 Oct 2026): it never ticked a consent box, and follow-ups are templates it didn't ask for. A `followups_skipped` event records this. If the person later submits the form, follow-ups start as usual. An opt-out sends nothing, not even a confirmation.
- Every echo moves `leads.last_human_reply_at` forward, and follow-ups are skipped when it is after their enquiry. `first_human_reply_at` stays set-once for metrics.
- `failed` replaces `sent`; a later `delivered` or `read` wins over `failed` and clears its error.
- Deleting a lead redacts the webhook rows routed to it. It also redacts rows that carry its phone but no lead, in its org or not routed to any org. Rows not yet processed are closed as processed (outcome `deleted`), so a provider retry is a duplicate and can't recreate the lead.
- A dead letter is reported once. Only the delivery whose atomic attempt count reaches 3 writes `webhook_event_failed` and alerts ops; later deliveries just get 200.
- A late-delivered old message only answers enquiries up to its own time. An inbound or echo cancels only follow-ups whose `enquiry_at` is at or before the message time. An echo older than the lead's first enquiry sets no reply time. A late STOP is still honoured whatever its time, to err on the side of consent.

Left for slice F (real provider):
- One malformed event makes the whole delivery invalid: it is stored as one `invalid` row and none of its events are processed.
- `webhook_events.payload` is the event's own JSON, not the delivery envelope (Meta's `metadata`, `contacts`).
- A `failed` status that arrives before its outbound message row exists is ignored.
- The welcome (acknowledgement, owner alerts, follow-ups) runs after the event's transaction commits, so a crash in between loses it.

**D. Metrics and report**
1. The view `lead_response_metrics` (`security_invoker`) gives per lead:
   - seconds to auto-reply;
   - seconds to first human reply;
   - replied by lead (yes/no).

   It also gives per org per ISO week (IST):
   - lead count;
   - median and p90 seconds to auto-reply;
   - median seconds to first human reply;
   - % of leads with a human reply within 1 hour.

   Unit-tested in pgTAP with fixed timestamps.
2. A `weekly_report` job per org runs Mondays at 09:00 IST (pg_cron at 03:30 UTC). It sends a `weekly_summary` template to each owner phone, plus an email through Resend when `RESEND_API_KEY` is set. An email failure doesn't block the WhatsApp send. Re-running the same week sends nothing (idempotency key `weekly:<org>:<iso-week>`).
3. `/admin` shows this week's numbers above the lead list, and each lead's time to first human reply.

Built as (slice D):
- Two views, both `security_invoker`: `lead_response_metrics` (per lead) and `lead_response_weekly` (per org per ISO week, Monday 00:00 to Sunday 23:59:59 IST, with `week_start`, `week_end` and `iso_week` like `2026-W41`). A separate view, not a function, so `/admin` and the job read it the same way. Members can select both; anon can't.
- A lead's enquiry time is its first enquiry, `least(created_at, last_enquiry_at)`. That keeps a form lead's first enquiry after a repeat, and uses the message time for a lead who wrote first on WhatsApp. A lead counts in the week of its first enquiry only, since the reply times are set once per lead.
- A reply recorded before the enquiry (a late or earlier echo) is ignored: its seconds are null, not negative or zero. "Replied by lead" means `last_inbound_at` strictly after the enquiry, so a WhatsApp-first lead's own message is not a reply.
- Medians and p90 use `percentile_cont` (linear interpolation), rounded to 0.1 s, over the leads that got that reply. The 1-hour % is over all of the week's leads, and exactly 3600 s counts.
- Cron `weekly-report` (`30 3 * * 1`) calls `private.enqueue_weekly_reports()`. It queues one `weekly_report` job per org, except the canary org (`is_canary`), for the week before the current IST week, so a late run still reports the right week. Payload: `{ week_start, iso_week }`.
- The job reads `public.weekly_report_data` (service role only) and queues one `send_message` job per owner phone with `weekly_summary`, keyed `weekly:<org>:<iso-week>:whatsapp:<phone>`. The sends go through the existing exactly-once path, with retries, dead letters and the owner-phone check. run-jobs now claims until a round comes back empty, so they go out in the same run.
- The first run stores the org name and the week's numbers on the job's payload (`report`). Retries render the WhatsApp params and the email from that snapshot, so a late reply can't change what is sent under the same keys.
- Each member with role `owner` gets their own email at their sign-in address, so owners never see each other's addresses. It is sent only when `RESEND_API_KEY` is set, from `RESEND_FROM`, which defaults to Resend's `onboarding@resend.dev` and must be a verified-domain address in production. Each carries `Idempotency-Key: weekly:<org>:<iso-week>:email:<user_id>`, and an owner with a `weekly_email_sent` event for the week is skipped.
- The WhatsApp jobs are queued before any email is tried, so an email failure never blocks them. If one owner's email fails, the others are still sent, then the report job fails: 429, 5xx or a network error retries with backoff, and the retry emails only the owners still missing. If every failure is another 4xx, the job is dead-lettered and ops are alerted. A 409 from Resend (key already used or in progress) is logged and recorded as `weekly_email_sent` with `already_sent`: no retry, no alert. A retry queues no new WhatsApp sends.
- A week without enquiries still sends, with zeros and "n/a".
- `/admin` reads the current IST week's row and the member's orgs with the user's session (RLS). An org without enquiries this week shows zeros. Org names show only when the member has more than one org. In the lead list, "Enquiry (IST)", "Auto-reply" and the new "Team reply" column use the view's rules: time from the first enquiry, and nothing for a reply recorded before it.
- `scripts/e2e-weekly.sh` (CI, after the webhook check) runs the cron function and run-jobs end to end.

Left for later:
- Owner emails come from `org_members` with role `owner`. If studios want reports at addresses that never sign in, that needs an `orgs.report_emails` column, set by onboard-org.

**E. Operations**
1. `deno run -A scripts/onboard-org.ts <config.json>` creates or updates an org, its sources, templates and owner contacts. It is idempotent (run twice = same rows) and validated with clear errors. There is a sample `onboarding/demo-interiors.json`.
2. Canary:
   - an hourly `canary` job posts a fake enquiry for the canary org through the real `ingest-form` URL;
   - it alerts ops if the auto-reply isn't recorded within 60 seconds;
   - canary leads are deleted after 7 days.
3. `docs/runbook.md` says what to do when:
   - sends fail;
   - the provider is down;
   - a template is rejected;
   - a job goes dead;
   - a client asks for data deletion. This links to a `delete-lead` SQL function that removes a lead and its messages, events and jobs, with a test.
4. Sentry is wired into functions and web behind `SENTRY_DSN` / `VITE_SENTRY_DSN`; it's a no-op when unset.

**F. Real provider** (after the spike): an adapter for the chosen provider, with recorded-fixture tests for `parseWebhook` and `verifyWebhook`. An integration run on `flow-dev` passes the spike's four checks through our engine. Then the roadmap's 20-submission test.

Max 3 review rounds per slice. Behaviour, the items above, security (secrets, RLS, signature checks, idempotency) and consent rules are grounds for rejection; naming and formatting are not.

## Schema additions

- `jobs` (above).
- `templates`: `org_id`, `name`, `language`, `category` (`utility`), `provider_template_id`, `status` (`draft` | `submitted` | `approved` | `rejected`), `body` (text with `{{1}}` params), `param_names text[]`. Unique `(org_id, name, language)`.
- `audit_log`: `org_id`, `actor` (user id or `system`), `action`, `target`, `details jsonb`, `at`. Written by `onboard-org`, `delete-lead` and status changes.
- `leads.opted_out_at timestamptz`.
- Templates referenced by the engine: `enquiry_ack`, `owner_alert`, `followup_1`, `followup_2`, `followup_3`, `weekly_summary`, `ops_alert`.

## Defaults picked (change any before or during review)

- **Scheduler.** `pg_cron` + `pg_net` calling `run-jobs`, rather than Supabase Queues/pgmq. A plain table is easier to inspect, test and dead-letter.
- **Ops alerts.** Ops alerts go to `OPS_ALERT_PHONE` (Mourya) as an `ops_alert` template, and are also recorded as `events`. Email ops alerts wait for Resend.
- **Follow-up timing.** Follow-up send time is 11:00 IST, as in the demo slice. No sends between 21:00 and 09:00 IST: a job due in that window moves to 09:00.
- **Opt-out.** Opt-out keywords are `STOP` and `UNSUBSCRIBE`. An opt-out holds against everything the engine sends on its own: follow-ups, retries and any other queued message. Only a fresh form submission with the consent box ticked (a new enquiry, not a duplicate within 24 hours) counts as opting back in. It clears `opted_out_at` and logs `lead_opted_in` with `previous_opted_out_at`, and then the acknowledgement and follow-ups run as usual.
