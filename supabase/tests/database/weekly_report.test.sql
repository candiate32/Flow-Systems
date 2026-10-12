-- Spec 004, D.2: the Monday 09:00 IST cron queues one weekly_report job per
-- org for the week that just ended, keyed weekly:<org>:<iso-week>, and
-- running it again for the same week queues nothing.
begin;
select plan(14);

select is(
  (select schedule from cron.job where jobname = 'weekly-report'),
  '30 3 * * 1',
  'pg_cron runs the weekly report Mondays at 03:30 UTC (09:00 IST)');
select is(
  (select command from cron.job where jobname = 'weekly-report'),
  'select private.enqueue_weekly_reports()',
  'and it enqueues the reports');

insert into public.orgs (id, name, slug, owner_alert_phones)
values ('eeeeeeee-0000-4000-8000-000000000001', 'Weekly One', 'weekly-one', array['+919700000101', '+919700000102']),
       ('eeeeeeee-0000-4000-8000-000000000002', 'Weekly Two', 'weekly-two', '{}');

-- report_week_start: Monday of the week that just ended, in IST.
select is(private.report_week_start('2026-10-12T03:30:00Z'), '2026-10-05'::date,
  'Monday 09:00 IST reports the week of Monday 5 Oct');
select is(private.report_week_start('2026-10-11T18:29:59Z'), '2026-09-28'::date,
  'Sunday 23:59:59 IST is still in the week of 5 Oct, so the week that ended is 28 Sep');
select is(private.report_week_start('2026-10-11T18:30:00Z'), '2026-10-05'::date,
  'from Monday 00:00 IST (Sunday 18:30 UTC) the week that ended is 5 Oct');

-- Only these two orgs, so the test doesn't depend on what else is in the database.
create temporary table queued on commit drop as
select q as id from private.enqueue_weekly_reports('2026-10-12T03:30:00Z', 'eeeeeeee-0000-4000-8000-000000000001') q
union all
select * from private.enqueue_weekly_reports('2026-10-12T03:30:00Z', 'eeeeeeee-0000-4000-8000-000000000002');

select is((select count(*)::int from queued), 2, 'one job per org');
select results_eq(
  $$ select j.org_id, j.kind, j.status, j.run_at, j.idempotency_key, j.payload, j.lead_id
       from public.jobs j join queued q on q.id = j.id order by j.idempotency_key $$,
  $$ values
     ('eeeeeeee-0000-4000-8000-000000000001'::uuid, 'weekly_report', 'queued', '2026-10-12T03:30:00Z'::timestamptz,
      'weekly:eeeeeeee-0000-4000-8000-000000000001:2026-W41',
      '{"week_start": "2026-10-05", "iso_week": "2026-W41"}'::jsonb, null::uuid),
     ('eeeeeeee-0000-4000-8000-000000000002'::uuid, 'weekly_report', 'queued', '2026-10-12T03:30:00Z'::timestamptz,
      'weekly:eeeeeeee-0000-4000-8000-000000000002:2026-W41',
      '{"week_start": "2026-10-05", "iso_week": "2026-W41"}'::jsonb, null::uuid) $$,
  'each job is due now, for the week just ended, keyed weekly:<org>:<iso-week>');

select is_empty(
  $$ select * from private.enqueue_weekly_reports('2026-10-12T03:31:00Z', 'eeeeeeee-0000-4000-8000-000000000001') $$,
  're-running for the same week queues nothing');
select is_empty(
  $$ select * from private.enqueue_weekly_reports('2026-10-13T10:00:00Z', 'eeeeeeee-0000-4000-8000-000000000001') $$,
  'a late run on Tuesday is still the same week: nothing new');
select is(
  (select count(*)::int from public.jobs where idempotency_key like 'weekly:eeeeeeee-0000-4000-8000-000000000001:%'),
  1, 'still one job for org one');

select isnt_empty(
  $$ select * from private.enqueue_weekly_reports('2026-10-19T03:30:00Z', 'eeeeeeee-0000-4000-8000-000000000001') $$,
  'the next Monday queues the next week');

select isnt_empty(
  $$ select * from private.enqueue_weekly_reports('2026-10-12T03:30:00Z') $$,
  'without an org it queues every org (the seeded demo org here)');

-- weekly_report_data: what the job sends, for the service role only.
insert into auth.users (id, aud, role, email)
values ('eeeeeeee-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'owner1@example.test'),
       ('eeeeeeee-0000-4000-8000-0000000000a2', 'authenticated', 'authenticated', 'staff1@example.test');
insert into public.org_members (org_id, user_id, role)
values ('eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a1', 'owner'),
       ('eeeeeeee-0000-4000-8000-000000000001', 'eeeeeeee-0000-4000-8000-0000000000a2', 'staff');
insert into public.leads (org_id, name, phone_e164, consent_at, created_at, last_enquiry_at, first_auto_reply_at)
values ('eeeeeeee-0000-4000-8000-000000000001', 'W', '+919700000111',
        '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:06Z');

select is(
  public.weekly_report_data('eeeeeeee-0000-4000-8000-000000000001', '2026-10-05')
    - 'metrics',
  jsonb_build_object(
    'org_name', 'Weekly One',
    'owner_alert_phones', jsonb_build_array('+919700000101', '+919700000102'),
    'owners', jsonb_build_array(jsonb_build_object(
      'user_id', 'eeeeeeee-0000-4000-8000-0000000000a1', 'email', 'owner1@example.test'))),
  'weekly_report_data: org name, owner phones, and each owner (not staff) with their email');
select is(
  public.weekly_report_data('eeeeeeee-0000-4000-8000-000000000001', '2026-10-05')
    -> 'metrics' ->> 'median_seconds_to_auto_reply',
  '6.0',
  'and the week''s numbers from lead_response_weekly');

select * from finish();
rollback;
