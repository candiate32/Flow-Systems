-- Spec 004, slice D, item 2: the weekly report
-- (docs/specs/004-production-engine.md, "D. Metrics and report").
--
-- pg_cron runs private.enqueue_weekly_reports() on Mondays at 03:30 UTC
-- (09:00 IST). It queues one `weekly_report` job per org for the week that
-- just ended (Monday to Sunday, IST), with idempotency key
-- weekly:<org_id>:<iso-week>, so running it again for the same week queues
-- nothing. run-jobs picks the jobs up on its next minute
-- (run-jobs/weekly_report.ts): it reads public.weekly_report_data and sends
-- the `weekly_summary` template to each owner phone, plus an email through
-- Resend when RESEND_API_KEY is set.

-- Monday (IST) of the week before the one `p_as_of` falls in: the week that
-- has just ended when the cron runs on Monday morning.
create function private.report_week_start(p_as_of timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (date_trunc('week', p_as_of at time zone 'Asia/Kolkata'))::date - 7;
$$;
revoke execute on function private.report_week_start(timestamptz) from public, anon, authenticated;

-- Queues the weekly_report job of every org (or only p_org_id), due at
-- p_as_of, with payload { week_start: 'YYYY-MM-DD', iso_week: 'IYYY-Www' }.
-- An org whose job for that week exists already is skipped. Returns the ids
-- of the jobs it queued.
create function private.enqueue_weekly_reports(p_as_of timestamptz default now(), p_org_id uuid default null)
returns setof uuid
language sql
volatile
set search_path = ''
as $$
  with wk as (
    select private.report_week_start(p_as_of) as week_start
  ), named as (
    select wk.week_start, to_char(wk.week_start, 'IYYY-"W"IW') as iso_week from wk
  )
  insert into public.jobs (org_id, kind, run_at, idempotency_key, payload)
  select o.id, 'weekly_report', p_as_of,
         'weekly:' || o.id::text || ':' || n.iso_week,
         jsonb_build_object('week_start', n.week_start, 'iso_week', n.iso_week)
    from public.orgs o
   cross join named n
   where p_org_id is null or o.id = p_org_id
   order by o.id
  on conflict (idempotency_key) do nothing
  returning id;
$$;
revoke execute on function private.enqueue_weekly_reports(timestamptz, uuid) from public, anon, authenticated;

-- Everything the weekly_report job needs for one org and week, in one call:
--   { org_name, owner_alert_phones: [...], owner_emails: [...],
--     metrics: the org's lead_response_weekly row for the week, or null }
-- owner_emails are the sign-in emails of the org's members with role
-- `owner` (they read auth.users, hence service role only). Null when the org
-- does not exist.
create function private.weekly_report_data(p_org_id uuid, p_week_start date)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'org_name', o.name,
    'owner_alert_phones', to_jsonb(o.owner_alert_phones),
    'owner_emails', coalesce((
      select jsonb_agg(distinct u.email)
        from public.org_members m
        join auth.users u on u.id = m.user_id
       where m.org_id = o.id
         and m.role = 'owner'
         and coalesce(u.email, '') <> ''
    ), '[]'::jsonb),
    'metrics', (
      select to_jsonb(w)
        from public.lead_response_weekly w
       where w.org_id = o.id and w.week_start = p_week_start
    )
  )
    from public.orgs o
   where o.id = p_org_id;
$$;
revoke execute on function private.weekly_report_data(uuid, date) from public, anon, authenticated;

-- Public wrappers for the Edge Functions and tests (service_role only), as
-- with claim_jobs. Security definer, so service_role needs no access to
-- `private` or auth.users.
create function public.enqueue_weekly_reports(p_as_of timestamptz default now(), p_org_id uuid default null)
returns setof uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.enqueue_weekly_reports(p_as_of, p_org_id);
$$;
revoke execute on function public.enqueue_weekly_reports(timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_weekly_reports(timestamptz, uuid) to service_role;

create function public.weekly_report_data(p_org_id uuid, p_week_start date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.weekly_report_data(p_org_id, p_week_start);
$$;
revoke execute on function public.weekly_report_data(uuid, date) from public, anon, authenticated;
grant execute on function public.weekly_report_data(uuid, date) to service_role;

-- pg_cron runs in UTC: 03:30 UTC on Monday is 09:00 IST.
select cron.schedule('weekly-report', '30 3 * * 1', 'select private.enqueue_weekly_reports()');
