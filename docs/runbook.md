# Runbook: the lead engine

What to do when something goes wrong, and how to set up a hosted project. Spec 004, "E. Operations".

SQL below runs in the Supabase dashboard's **SQL Editor** for the project. The editor runs as `postgres` and bypasses row-level security, so check the `where` clause before you run anything that changes rows. Times in the database are UTC; India is UTC+5:30.

Contents:

1. [Hosted setup](#1-hosted-setup)
2. [Onboarding a studio](#2-onboarding-a-studio)
3. [Sends fail](#3-sends-fail)
4. [The WhatsApp provider is down](#4-the-whatsapp-provider-is-down)
5. [A template is rejected](#5-a-template-is-rejected)
6. [A job goes dead](#6-a-job-goes-dead)
7. [The canary alerts](#7-the-canary-alerts)
8. [A client asks for data deletion](#8-a-client-asks-for-data-deletion)

Ops alerts arrive on WhatsApp at `OPS_ALERT_PHONE` as the `ops_alert` template with four values: the job kind, the job id, the attempt count and the error. Errors from the Edge Functions also go to Sentry when `SENTRY_DSN` is set.

## 1. Hosted setup

Do this once per Supabase project (`flow-dev`, then production). `<ref>` is the project ref, the part before `.supabase.co`.

### 1.1 Deploy

```
npx supabase link --project-ref <ref>
npx supabase db push
npx supabase functions deploy
```

### 1.2 Function secrets

Set these with `npx supabase secrets set NAME=value --project-ref <ref>`. Both functions see all of them.

| Secret | Needed | What it is |
|---|---|---|
| `RUN_JOBS_SECRET` | yes | A long random value: `openssl rand -hex 32`. `run-jobs` answers 401 to any call without it in the `x-run-jobs-secret` header. Vault's `run_jobs_secret` (1.3) must be the same value. |
| `OPS_ALERT_PHONE` | yes | The ops phone (Mourya's) for `ops_alert` messages, for example `+919845012345`. When it is unset or invalid, alerts are only written to `events` as `ops_alert_skipped`. |
| `INGEST_FORM_URL` | for the canary | `https://<ref>.supabase.co/functions/v1/ingest-form` |
| `CANARY_SECRET` | when Turnstile is on | At least 24 random characters (`openssl rand -hex 32`). The canary can't solve a Turnstile challenge, so it sends `canary:<CANARY_SECRET>` as its token and ingest-form lets it through. Without it the canary fails the spam check whenever `TURNSTILE_SECRET` is set. |
| `CANARY_PHONE` | with a real provider | A WhatsApp number ops own that agreed to receive the canary's acknowledgement every hour. Without it the canary uses a made-up number, which it only does with the fake provider. |
| `WHATSAPP_PROVIDER` | after the spike | Unset or `fake` uses the fake provider, which sends nothing. |
| `TURNSTILE_SECRET` | for real traffic | Cloudflare Turnstile secret. Unset skips the spam check, which is only allowed with the fake provider. |
| `SENTRY_DSN` | optional | The Sentry project's DSN. Unset means errors are not reported anywhere but the function logs. |
| `SENTRY_ENVIRONMENT` | optional | `production` or `flow-dev`, to tell the two apart in Sentry. |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions by Supabase. Don't set them.

### 1.3 Vault secrets for the job runner

`pg_cron` calls `run-jobs` every minute through `pg_net`. It reads the URL and the secret from Vault. In the SQL Editor:

```sql
select vault.create_secret('https://<ref>.supabase.co/functions/v1/run-jobs', 'run_jobs_url');
select vault.create_secret('<the RUN_JOBS_SECRET value>', 'run_jobs_secret');
```

Until both exist, the cron job runs every minute and does nothing.

To change one later (for example when rotating the secret, change both places, Vault first):

```sql
select vault.update_secret(id, '<new value>') from vault.secrets where name = 'run_jobs_secret';
```

then `npx supabase secrets set RUN_JOBS_SECRET=<new value>`. Calls in the minute between the two changes get a 401 and are retried by the next minute's call.

### 1.4 Check the job runner works

Wait two minutes, then:

```sql
-- Did cron run? (status should be 'succeeded')
select start_time, status, return_message
  from cron.job_run_details order by start_time desc limit 5;

-- What did run-jobs answer? (status_code should be 200)
select created, status_code, left(content::text, 200) as body
  from net._http_response order by created desc limit 5;
```

A 401 means Vault's `run_jobs_secret` and the `RUN_JOBS_SECRET` function secret differ. A 404 means `run_jobs_url` is wrong or `run-jobs` isn't deployed.

### 1.5 The canary

The canary is one org (at most one) with `is_canary = true`. Every hour a `canary` job posts a fake enquiry to its form through `INGEST_FORM_URL` and checks that the auto-reply was recorded within 60 seconds. If not, or if the post fails, ops get an alert. It deletes its own leads after 7 days.

1. Write `onboarding/canary.json`: `"is_canary": true`, one `web_form` source, and `"owner_alert_phones": []` so nobody gets an owner alert every hour.
2. Run `deno run -A scripts/onboard-org.ts onboarding/canary.json` (section 2). Marking the org as the canary queues the first canary job straight away.
3. Set `INGEST_FORM_URL`, and `CANARY_SECRET` / `CANARY_PHONE` as the table in 1.2 says.
4. After a minute or two:

   ```sql
   select created_at, type, payload from events
    where type like 'canary_%' order by created_at desc limit 5;
   ```

   You want `canary_passed`, with `seconds_to_auto_reply`.

To stop the canary, set `"is_canary": false` and run onboard-org again. The next canary job cancels itself and queues no more.

### 1.6 Sentry

1. Create a Sentry project (platform: Deno) and copy its DSN.
2. `npx supabase secrets set SENTRY_DSN=<dsn> SENTRY_ENVIRONMENT=production`.

Reported: `ingest-form` internal errors (the lead saw "Something went wrong"), a `run-jobs` run that failed, a job whose outcome couldn't be recorded, and every dead job. Indian mobile numbers are removed from events before they leave, but don't add lead details to the context anyway: lead data stays in India and Sentry isn't.

## 2. Onboarding a studio

1. Copy `onboarding/demo-interiors.json` to `onboarding/<slug>.json` and fill it in:
   - `slug`: lowercase words joined by hyphens, unique, for example `lime-and-lattice`. Leave out `id`: only the seeded demo org has a fixed one.
   - `owner_alert_phones`: the people who get an alert for every enquiry. Any common Indian format works; they are stored as `+91…`.
   - `sources`: the studio's web form (and later its WhatsApp number). `public_key` is what the studio's form sends as `source_key`, so it can't change once the form is live.
   - `templates`: the WhatsApp templates in the studio's name. `name` must be one the engine sends: `enquiry_ack`, `owner_alert`, `followup_1`, `followup_2`, `followup_3`, `weekly_summary`, `ops_alert`.
2. Check it against production without writing anything:

   ```
   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service role key> \
     deno run -A scripts/onboard-org.ts --dry-run onboarding/<slug>.json
   ```

   Errors name the line and column of the problem. Fix them and run again.
3. Run it without `--dry-run`. It prints each change; each is also an `audit_log` row (`actor = 'system'`, `details.via = 'onboard-org'`).
4. Running it again prints "up to date". To change something later, edit the file and run it again: only the differences are written.

Take the service role key from the dashboard (Project Settings, API keys) for the one command, and don't save it in a file or your shell history.

The command never deletes. A source or template removed from the file stays in the database; delete it by hand if it must go. Template `status` and `provider_template_id` are only changed when the file sets them, because the provider's review moves them on (section 5).

## 3. Sends fail

**Signs:** `send_failed` events; `messages` rows with `status = 'failed'`; ops alerts for dead `send_message` jobs; a studio says a lead got no reply.

1. See what is failing and why:

   ```sql
   select date_trunc('hour', created_at) as hour, payload->>'template' as template,
          left(payload->>'error', 120) as error, count(*)
     from events
    where type = 'send_failed' and created_at > now() - interval '24 hours'
    group by 1, 2, 3 order by 1 desc, 4 desc;
   ```

2. Decide which case it is:
   - **Every send fails, for every org:** the provider is down or our credentials are wrong. Go to section 4.
   - **Only one template fails:** the template is missing, paused or rejected at the provider. Go to section 5.
   - **Only one org fails:** its WhatsApp number or its templates at the provider. Check the org's templates (section 5) and the number's status in the provider console.
   - **Only some recipients fail:** usually the number isn't on WhatsApp. The lead was saved; the studio should call them. Nothing to fix in the engine.
3. Failed acknowledgements are retried on their own: ingest-form queues a `send_message` job that retries after 1, 5, 25 and 120 minutes. Check them:

   ```sql
   select status, count(*) from jobs
    where kind = 'send_message' and created_at > now() - interval '24 hours'
    group by status;
   ```

   `queued` jobs will be retried. `dead` ones need section 6 once the cause is fixed.
4. If leads waited, tell the studio which ones, so they can call them first:

   ```sql
   select l.name, l.created_at at time zone 'Asia/Kolkata' as enquired_ist
     from leads l
    where l.org_id = '<org id>' and l.first_auto_reply_at is null
      and l.created_at > now() - interval '24 hours';
   ```

## 4. The WhatsApp provider is down

**Signs:** sends fail for every org at once; the canary alerts; the provider's status page shows an incident.

1. Confirm it on the provider's status page or support channel. If they show no incident, check our credentials (function secrets) before anything else: an expired key looks the same from our side.
2. Leave the engine running. Leads are still saved and studios still see them in `/admin`. Every failed acknowledgement is queued and retried after 1, 5, 25 and 120 minutes, about 2.5 hours in all, and a retry never sends twice.
3. Tell the studios: enquiries are being saved, WhatsApp replies are delayed, and they should call new leads.
4. If the outage lasts longer than about 2.5 hours, the retries run out and the jobs go `dead`, with an ops alert each. That is expected. Once the provider is back, requeue them all (section 6, "Requeue many").
5. Watch the queue empty:

   ```sql
   select status, count(*) from jobs where updated_at > now() - interval '6 hours' group by status;
   ```

Don't switch providers in the middle of an outage. Messages already accepted by the old provider would be sent again by the new one.

## 5. A template is rejected

**Signs:** the provider emails or shows a rejection; sends of that template fail with a "template not found / not approved" error; `templates.status` should be `rejected`.

1. Find the reason in the provider's console. Common ones:
   - promotional wording in a `utility` template ("offer", "discount", "best price");
   - a placeholder at the very start or end of the body (onboard-org already refuses these);
   - missing or poor sample values for the placeholders.
2. Record the rejection in the studio's onboarding file, on the template: `"status": "rejected"`. Run onboard-org (section 2), so the database shows it.
3. Fix the `body` in the same file. Keep the placeholders and `param_names` as they are: the engine fills `{{1}}`, `{{2}}`… in that order.
4. Resubmit the template in the provider console with the new text. Set `"status": "submitted"` and run onboard-org again.
5. When it is approved, set `"status": "approved"` and `"provider_template_id": "<id from the provider>"`, and run onboard-org once more.
6. Sends that failed while the template was rejected end as dead jobs. Requeue them (section 6) after approval.

Until a replacement for `enquiry_ack` is approved, the studio's leads get no acknowledgement. Tell the studio to call new leads in the meantime.

## 6. A job goes dead

A job is `dead` when it failed `max_attempts` times (5 by default), or at once when retrying can't help (a bad payload, for example). Each dead job writes a `job_dead` event, sends an ops alert and is reported to Sentry.

### Find dead jobs

```sql
select id, org_id, lead_id, kind, attempts, max_attempts, updated_at, left(last_error, 200) as last_error
  from jobs where status = 'dead' order by updated_at desc limit 50;
```

The history of one job (`<job id>` from the alert):

```sql
select created_at, type, payload from events
 where payload->>'job_id' = '<job id>' order by created_at;
```

### Decide

Fix the cause first: sections 3 to 5. Then:

- **`send_message`** is safe to requeue. If an earlier attempt did reach the provider, the job finds its `sent` message and doesn't send again. It also won't send to a lead who has been deleted or who never gave consent.
- **`followup`** and **`weekly_report`**: requeue only if the message is still useful today. A follow-up from last week is better skipped.
- **`canary`**: don't requeue an old canary; it would post a stale check. Restart the chain if it stopped (section 7).
- **A dead job with an error like "invalid payload", "no handler" or "not recorded, not retrying"**: don't requeue it. It needs a code fix, or a person to check whether the message actually went out. "Not recorded, not retrying" means the provider accepted the message but we couldn't save that fact; requeueing would send it twice.

### Requeue one

```sql
update jobs
   set status = 'queued', attempts = 0, run_at = now(), last_error = null
 where id = '<job id>' and status = 'dead'
returning id, kind, run_at;
```

The `status = 'dead'` condition means a job that has already been requeued, or that is running, is left alone. The runner picks it up within a minute. Check it went through:

```sql
select status, attempts, last_error from jobs where id = '<job id>';
```

### Requeue many (after an outage)

Check the list first, then requeue with the same conditions:

```sql
select id, kind, left(last_error, 120) from jobs
 where status = 'dead' and kind = 'send_message'
   and updated_at between '<outage start, UTC>' and '<outage end, UTC>'
   and last_error not like '%not recorded%';

update jobs
   set status = 'queued', attempts = 0, run_at = now(), last_error = null
 where status = 'dead' and kind = 'send_message'
   and updated_at between '<outage start, UTC>' and '<outage end, UTC>'
   and last_error not like '%not recorded%'
returning id;
```

The runner takes them 10 at a time, for up to 40 seconds each minute.

## 7. The canary alerts

The alert's error starts with `canary:`. Each failure is also a `canary_failed` event:

```sql
select created_at, payload->>'reason' as reason, payload->>'lead_id' as lead_id
  from events where type in ('canary_failed', 'canary_passed') order by created_at desc limit 10;
```

| Reason | Meaning | What to do |
|---|---|---|
| `no auto-reply recorded within 60 s` | The enquiry was saved but the acknowledgement didn't go out in time. Real leads are affected. | Section 3. |
| `auto-reply took N s, over 60 s` | The acknowledgement went out, late (usually on a retry). | Section 3; check the provider's latency. |
| `post to ingest-form failed: …` or `ingest-form returned 5xx` | ingest-form is down or erroring. Real enquiries are failing too. | Check the function's logs in the dashboard (Edge Functions, ingest-form, Logs) and Sentry. Redeploy if a bad deploy caused it. |
| `ingest-form returned 403` | The canary failed the spam check. | Set `CANARY_SECRET` (1.2), at least 24 characters. |
| `ingest-form returned 400: … source_key …` | The canary org's form key is wrong. | Check the canary's onboarding file. |
| `INGEST_FORM_URL is not set` | Setup. | Set it (1.2). |
| `CANARY_PHONE must be set …` | A real provider is configured. | Set `CANARY_PHONE` (1.2). |
| `the canary enquiry was treated as a duplicate` | Should not happen: the canary deletes its earlier lead first. | Look at the lead in the event; report it as a bug. |

If canary checks stop altogether (no `canary_*` event for over an hour), the chain broke, usually because a canary job went dead. Restart it:

```sql
select private.start_canary(id) from orgs where is_canary;
```

## 8. A client asks for data deletion

A lead (or the studio on the lead's behalf) asks us to delete their data. Lead data lives only in the Supabase project in Mumbai.

1. **Check the request is genuine.** It should come from the lead's own WhatsApp number or email, or from the studio. Note who asked, when, and for which studio.
2. **Find the lead.** Write the number as `+91` and 10 digits. A person who enquired with two studios has one lead in each; delete only those the request covers.

   ```sql
   select l.id, o.name as studio, l.name, l.created_at
     from leads l join orgs o on o.id = l.org_id
    where l.phone_e164 = '+91XXXXXXXXXX';
   ```

3. **Delete it** with `delete_lead`, which removes the lead, its messages, its events (including events that mention it only by id) and its jobs, and writes an `audit_log` row:

   ```sql
   select public.delete_lead('<lead id>');
   ```

   `true` means it was deleted; `false` means there was no such lead (already deleted). Only the service role and the SQL Editor can call it.
4. **Delete raw webhook payloads** that contain the number, once the WhatsApp webhook (spec 004, slice C) is live. They are stored without a lead id:

   ```sql
   delete from webhook_events where payload::text like '%XXXXXXXXXX%' returning id;
   ```

   (`XXXXXXXXXX` is the 10-digit number without `+91`.)
5. **Check:**

   ```sql
   select count(*) from leads where phone_e164 = '+91XXXXXXXXXX';  -- 0, for the studios covered
   select at, target, details from audit_log where action = 'lead.deleted' order by at desc limit 1;
   ```

6. **Things outside the database.** Owner alerts were WhatsApp messages to the studio's phones, with the lead's name and number; ask the studio to delete those chats. Supabase backups keep data until they expire; the lead is not restored from them unless the whole database is.
7. **Reply** to whoever asked that the data has been deleted, and when.
