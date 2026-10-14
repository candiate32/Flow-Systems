-- Spec 004, D.1: lead_response_metrics (per lead) and lead_response_weekly
-- (per org per ISO week, IST), with fixed timestamps.
--
-- Org M's week of Monday 2026-10-05 (IST) has five leads with auto-replies
-- after 5, 10, 20, 40 and 100 seconds and first human replies after 60 s,
-- 30 min, exactly 1 hour, 1 hour + 1 s, and none.
--   median auto-reply   = 20
--   p90 auto-reply      = 40 + 0.6 * (100 - 40) = 76   (percentile_cont)
--   median human reply = (1800 + 3600) / 2 = 2700      (4 replies)
--   within 1 hour       = 3 of 5 leads (3600 s counts) = 60.0 %
begin;
select plan(29);

insert into public.orgs (id, name, slug)
values ('dddddddd-0000-4000-8000-000000000001', 'Metrics Org', 'metrics-org');

-- Enquiry times are 10:00 IST (04:30 UTC) on Tuesday 2026-10-06.
insert into public.leads (id, org_id, name, phone_e164, consent_at, created_at, last_enquiry_at,
                          first_auto_reply_at, first_human_reply_at, last_inbound_at)
values
  ('dddddddd-0000-4000-8000-0000000000a1', 'dddddddd-0000-4000-8000-000000000001', 'L1', '+919700000001',
   '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z',
   '2026-10-06T04:30:05Z', '2026-10-06T04:31:00Z', '2026-10-06T05:00:00Z'),
  ('dddddddd-0000-4000-8000-0000000000a2', 'dddddddd-0000-4000-8000-000000000001', 'L2', '+919700000002',
   '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z',
   '2026-10-06T04:30:10Z', '2026-10-06T05:00:00Z', null),
  ('dddddddd-0000-4000-8000-0000000000a3', 'dddddddd-0000-4000-8000-000000000001', 'L3', '+919700000003',
   '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z',
   '2026-10-06T04:30:20Z', '2026-10-06T05:30:00Z', null),
  ('dddddddd-0000-4000-8000-0000000000a4', 'dddddddd-0000-4000-8000-000000000001', 'L4', '+919700000004',
   '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z',
   '2026-10-06T04:30:40Z', '2026-10-06T05:30:01Z', null),
  -- A repeat enquiry moved last_enquiry_at to Thursday; the lead still counts
  -- from its first enquiry (created_at), in this week.
  ('dddddddd-0000-4000-8000-0000000000a5', 'dddddddd-0000-4000-8000-000000000001', 'L5', '+919700000005',
   '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-08T04:30:00Z',
   '2026-10-06T04:31:40Z', null, null);

-- Week boundary: Sunday 2026-10-11 23:59:59 IST is 18:29:59 UTC and belongs to
-- the week of 5 Oct; Monday 2026-10-12 00:00:00 IST is 18:30:00 UTC, still
-- Sunday in UTC, and starts the week of 12 Oct.
insert into public.leads (id, org_id, name, phone_e164, consent_at, created_at, last_enquiry_at)
values
  ('dddddddd-0000-4000-8000-0000000000b1', 'dddddddd-0000-4000-8000-000000000001', 'Sunday', '+919700000011',
   '2026-10-11T18:29:59Z', '2026-10-11T18:29:59Z', '2026-10-11T18:29:59Z'),
  ('dddddddd-0000-4000-8000-0000000000b2', 'dddddddd-0000-4000-8000-000000000001', 'Monday', '+919700000012',
   '2026-10-11T18:30:00Z', '2026-10-11T18:30:00Z', '2026-10-11T18:30:00Z');

-- A lead who wrote first on WhatsApp: the webhook created the row 3 s after
-- the message (created_at), with last_enquiry_at = last_inbound_at = the
-- message time. Its enquiry is the message time and it has not replied.
-- A staff message recorded before the enquiry is not a reply to it.
insert into public.leads (id, org_id, name, phone_e164, consent_at, created_at, last_enquiry_at,
                          first_auto_reply_at, first_human_reply_at, last_inbound_at)
values
  ('dddddddd-0000-4000-8000-0000000000c1', 'dddddddd-0000-4000-8000-000000000001', 'Inbound', '+919700000021',
   '2026-10-13T04:30:00Z', '2026-10-13T04:30:03Z', '2026-10-13T04:30:00Z',
   '2026-10-13T04:30:04Z', '2026-10-13T04:00:00Z', '2026-10-13T04:30:00Z');

-- Per lead -------------------------------------------------------------------
select results_eq(
  $$ select seconds_to_auto_reply, seconds_to_first_human_reply, replied_by_lead
       from public.lead_response_metrics
      where lead_id = 'dddddddd-0000-4000-8000-0000000000a1' $$,
  $$ values (5::numeric, 60::numeric, true) $$,
  'per lead: seconds to auto-reply, to first human reply, and replied by lead');
select results_eq(
  $$ select seconds_to_auto_reply, seconds_to_first_human_reply, replied_by_lead
       from public.lead_response_metrics
      where lead_id = 'dddddddd-0000-4000-8000-0000000000a5' $$,
  $$ values (100::numeric, null::numeric, false) $$,
  'a lead without a human reply has null seconds and counts from its first enquiry');
select is(
  (select enquiry_at from public.lead_response_metrics where lead_id = 'dddddddd-0000-4000-8000-0000000000a5'),
  '2026-10-06T04:30:00Z'::timestamptz,
  'enquiry_at is the first enquiry, not a later repeat');
select results_eq(
  $$ select enquiry_at, seconds_to_auto_reply, replied_by_lead
       from public.lead_response_metrics
      where lead_id = 'dddddddd-0000-4000-8000-0000000000c1' $$,
  $$ values ('2026-10-13T04:30:00Z'::timestamptz, 4::numeric, false) $$,
  'a WhatsApp-first lead counts from its message; that message is not a reply');
select is(
  (select seconds_to_first_human_reply from public.lead_response_metrics
    where lead_id = 'dddddddd-0000-4000-8000-0000000000c1'),
  null::numeric,
  'a staff message from before the enquiry is ignored, not a negative time');
select is(
  (select seconds_to_auto_reply from public.lead_response_metrics
    where lead_id = 'dddddddd-0000-4000-8000-0000000000a1'),
  5::numeric, 'seconds are exact');

-- IST week boundaries ------------------------------------------------------------
select results_eq(
  $$ select week_start, iso_week from public.lead_response_metrics
      where lead_id = 'dddddddd-0000-4000-8000-0000000000b1' $$,
  $$ values ('2026-10-05'::date, '2026-W41') $$,
  'Sunday 23:59:59 IST belongs to the week that is ending');
select results_eq(
  $$ select week_start, iso_week from public.lead_response_metrics
      where lead_id = 'dddddddd-0000-4000-8000-0000000000b2' $$,
  $$ values ('2026-10-12'::date, '2026-W42') $$,
  'Monday 00:00 IST starts the next week, though it is still Sunday in UTC');

-- Per org per week -----------------------------------------------------------------
select results_eq(
  $$ select week_end, iso_week, lead_count, auto_replied_count, human_replied_count,
            human_reply_within_1h_count, replied_by_lead_count
       from public.lead_response_weekly
      where org_id = 'dddddddd-0000-4000-8000-000000000001' and week_start = '2026-10-05' $$,
  $$ values ('2026-10-11'::date, '2026-W41', 6, 5, 4, 3, 1) $$,
  'week of 5 Oct: six leads (five plus the Sunday 23:59 one), counts');
select is(
  (select median_seconds_to_auto_reply from public.lead_response_weekly
    where org_id = 'dddddddd-0000-4000-8000-000000000001' and week_start = '2026-10-05'),
  20::numeric, 'median seconds to auto-reply');
select is(
  (select p90_seconds_to_auto_reply from public.lead_response_weekly
    where org_id = 'dddddddd-0000-4000-8000-000000000001' and week_start = '2026-10-05'),
  76::numeric, 'p90 seconds to auto-reply (linear interpolation)');
select is(
  (select median_seconds_to_first_human_reply from public.lead_response_weekly
    where org_id = 'dddddddd-0000-4000-8000-000000000001' and week_start = '2026-10-05'),
  2700::numeric, 'median seconds to first human reply, over the leads that got one');
select is(
  (select pct_human_reply_within_1h from public.lead_response_weekly
    where org_id = 'dddddddd-0000-4000-8000-000000000001' and week_start = '2026-10-05'),
  50.0::numeric, '% with a human reply within 1 hour: 3 of 6 leads (exactly 3600 s counts, 3601 s does not)');

select results_eq(
  $$ select lead_count, auto_replied_count, median_seconds_to_auto_reply, p90_seconds_to_auto_reply,
            median_seconds_to_first_human_reply, pct_human_reply_within_1h
       from public.lead_response_weekly
      where org_id = 'dddddddd-0000-4000-8000-000000000001' and week_start = '2026-10-12' $$,
  $$ values (2, 1, 4::numeric, 4::numeric, null::numeric, 0.0::numeric) $$,
  'week of 12 Oct: the Monday 00:00 lead and the WhatsApp-first lead');

-- Without the boundary leads, the five-lead week gives 60 %.
delete from public.leads where id = 'dddddddd-0000-4000-8000-0000000000b1';
select results_eq(
  $$ select lead_count, median_seconds_to_auto_reply, p90_seconds_to_auto_reply,
            median_seconds_to_first_human_reply, pct_human_reply_within_1h
       from public.lead_response_weekly
      where org_id = 'dddddddd-0000-4000-8000-000000000001' and week_start = '2026-10-05' $$,
  $$ values (5, 20::numeric, 76::numeric, 2700::numeric, 60.0::numeric) $$,
  'five leads: median 20 s, p90 76 s, human median 2700 s, 60 % within an hour');

-- Both views run with the caller's rights ------------------------------------------
select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c
    where c.oid = 'public.lead_response_metrics'::regclass),
  'lead_response_metrics is security_invoker');
select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c
    where c.oid = 'public.lead_response_weekly'::regclass),
  'lead_response_weekly is security_invoker');

-- RLS: org A's member sees only org A's numbers ------------------------------------
insert into auth.users (id, aud, role, email)
values ('aaaaaaaa-0000-4000-8000-0000000000da', 'authenticated', 'authenticated', 'ma@example.test'),
       ('bbbbbbbb-0000-4000-8000-0000000000db', 'authenticated', 'authenticated', 'mb@example.test');
insert into public.orgs (id, name, slug)
values ('aaaaaaaa-0000-4000-8000-0000000000d1', 'Metrics A', 'metrics-a'),
       ('bbbbbbbb-0000-4000-8000-0000000000d1', 'Metrics B', 'metrics-b');
insert into public.org_members (org_id, user_id, role)
values ('aaaaaaaa-0000-4000-8000-0000000000d1', 'aaaaaaaa-0000-4000-8000-0000000000da', 'owner'),
       ('bbbbbbbb-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000db', 'owner');
insert into public.leads (id, org_id, name, phone_e164, consent_at, created_at, last_enquiry_at, first_auto_reply_at)
values ('aaaaaaaa-0000-4000-8000-0000000000d3', 'aaaaaaaa-0000-4000-8000-0000000000d1', 'A lead', '+919700000031',
        '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:07Z'),
       ('bbbbbbbb-0000-4000-8000-0000000000d3', 'bbbbbbbb-0000-4000-8000-0000000000d1', 'B lead', '+919700000032',
        '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:09Z'),
       ('bbbbbbbb-0000-4000-8000-0000000000d4', 'bbbbbbbb-0000-4000-8000-0000000000d1', 'B lead 2', '+919700000033',
        '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:00Z', '2026-10-06T04:30:11Z');

set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-4000-8000-0000000000da", "role": "authenticated"}';
select results_eq($$ select lead_id from public.lead_response_metrics $$,
  $$ values ('aaaaaaaa-0000-4000-8000-0000000000d3'::uuid) $$,
  'member of A sees only org A leads in lead_response_metrics');
select results_eq($$ select org_id, lead_count, median_seconds_to_auto_reply from public.lead_response_weekly $$,
  $$ values ('aaaaaaaa-0000-4000-8000-0000000000d1'::uuid, 1, 7::numeric) $$,
  'member of A sees only org A numbers in lead_response_weekly, computed from A''s leads only');
select is_empty(
  $$ select 1 from public.lead_response_weekly where org_id = 'bbbbbbbb-0000-4000-8000-0000000000d1' $$,
  'member of A cannot read org B''s weekly numbers even when filtering for them');
select is_empty(
  $$ select 1 from public.lead_response_metrics where org_id <> 'aaaaaaaa-0000-4000-8000-0000000000d1' $$,
  'member of A cannot read any other org''s per-lead numbers');
select throws_ok($$ select private.enqueue_weekly_reports() $$, '42501', null,
  'authenticated cannot enqueue weekly reports');
select throws_ok($$ select public.weekly_report_data('aaaaaaaa-0000-4000-8000-0000000000d1', '2026-10-05') $$,
  '42501', null, 'authenticated cannot call weekly_report_data (it reads owner emails)');

set local request.jwt.claims = '{"sub": "bbbbbbbb-0000-4000-8000-0000000000db", "role": "authenticated"}';
select results_eq($$ select org_id, lead_count, median_seconds_to_auto_reply from public.lead_response_weekly $$,
  $$ values ('bbbbbbbb-0000-4000-8000-0000000000d1'::uuid, 2, 10::numeric) $$,
  'member of B sees only org B numbers');

set local request.jwt.claims = '{"sub": "cccccccc-0000-4000-8000-00000000000c", "role": "authenticated"}';
select is_empty($$ select 1 from public.lead_response_weekly $$, 'a non-member sees no weekly numbers');
select is_empty($$ select 1 from public.lead_response_metrics $$, 'a non-member sees no per-lead numbers');

reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok($$ select * from public.lead_response_metrics $$, '42501', null, 'anon cannot read lead_response_metrics');
select throws_ok($$ select * from public.lead_response_weekly $$, '42501', null, 'anon cannot read lead_response_weekly');

reset role;
select is(
  (select count(*)::int from public.lead_response_weekly where org_id in
     ('aaaaaaaa-0000-4000-8000-0000000000d1', 'bbbbbbbb-0000-4000-8000-0000000000d1')),
  2, 'the service side (RLS bypassed) sees both orgs');

select * from finish();
rollback;
