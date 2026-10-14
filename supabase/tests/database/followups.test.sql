-- Spec 004, slice B: leads.opted_out_at, cancel_followups, schedule_followups
-- and record_opt_out (supabase/migrations/20261014120000_followups.sql).
begin;
select plan(40);

-- Schema and privileges -------------------------------------------------------
select has_column('public', 'leads', 'opted_out_at', 'leads has opted_out_at');
select col_type_is('public', 'leads', 'opted_out_at', 'timestamp with time zone', 'leads.opted_out_at is timestamptz');
select col_is_null('public', 'leads', 'opted_out_at', 'leads.opted_out_at is nullable');

select has_function('private', 'cancel_followups', array['uuid', 'text', 'timestamp with time zone', 'text[]']);
select has_function('private', 'schedule_followups', array['uuid', 'jsonb', 'text', 'timestamp with time zone']);
select has_function('private', 'record_opt_out', array['uuid', 'timestamp with time zone']);
select is_definer('public', 'cancel_followups', array['uuid', 'text', 'timestamp with time zone']);
select is_definer('public', 'schedule_followups', array['uuid', 'jsonb', 'text', 'timestamp with time zone']);
select is_definer('public', 'record_opt_out', array['uuid', 'timestamp with time zone']);

select function_privs_are('public', 'cancel_followups', array['uuid', 'text', 'timestamp with time zone'], 'anon', '{}');
select function_privs_are('public', 'cancel_followups', array['uuid', 'text', 'timestamp with time zone'], 'authenticated', '{}');
select function_privs_are('public', 'cancel_followups', array['uuid', 'text', 'timestamp with time zone'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'schedule_followups', array['uuid', 'jsonb', 'text', 'timestamp with time zone'], 'anon', '{}');
select function_privs_are('public', 'schedule_followups', array['uuid', 'jsonb', 'text', 'timestamp with time zone'], 'authenticated', '{}');
select function_privs_are('public', 'schedule_followups', array['uuid', 'jsonb', 'text', 'timestamp with time zone'], 'service_role', array['EXECUTE']);
select function_privs_are('public', 'record_opt_out', array['uuid', 'timestamp with time zone'], 'anon', '{}');
select function_privs_are('public', 'record_opt_out', array['uuid', 'timestamp with time zone'], 'authenticated', '{}');
select function_privs_are('public', 'record_opt_out', array['uuid', 'timestamp with time zone'], 'service_role', array['EXECUTE']);
select function_privs_are('private', 'cancel_followups', array['uuid', 'text', 'timestamp with time zone', 'text[]'], 'service_role', '{}');

-- Fixtures (as postgres, RLS bypassed) ------------------------------------------
insert into public.orgs (id, name, slug)
values ('30000000-0000-4000-8000-000000000001', 'Follow-up Org', 'followup-org');
insert into public.leads (id, org_id, name, phone_e164, consent_at)
values ('30000000-0000-4000-8000-000000000a01', '30000000-0000-4000-8000-000000000001', 'Lead A', '+919811110001', now()),
       ('30000000-0000-4000-8000-000000000a02', '30000000-0000-4000-8000-000000000001', 'Lead B', '+919811110002', now());

insert into public.jobs (id, org_id, lead_id, kind, run_at, status, idempotency_key, payload)
values
  -- Lead A: three queued follow-ups, one running, one queued send_message.
  ('30000000-0000-4000-8000-000000000f01', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000a01', 'followup', '2030-01-02T05:30:00Z', 'queued', 'f-a-1', '{"n":1}'),
  ('30000000-0000-4000-8000-000000000f02', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000a01', 'followup', '2030-01-04T05:30:00Z', 'queued', 'f-a-2', '{"n":2}'),
  ('30000000-0000-4000-8000-000000000f03', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000a01', 'followup', '2030-01-08T05:30:00Z', 'queued', 'f-a-3', '{"n":3}'),
  ('30000000-0000-4000-8000-000000000f04', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000a01', 'followup', '2030-01-01T05:30:00Z', 'running', 'f-a-0', '{"n":1}'),
  ('30000000-0000-4000-8000-000000000f05', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000a01', 'send_message', '2030-01-01T00:00:00Z', 'queued', 's-a-1', '{}'),
  -- Lead B: one queued follow-up.
  ('30000000-0000-4000-8000-000000000f06', '30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000a02', 'followup', '2030-01-02T05:30:00Z', 'queued', 'f-b-1', '{"n":1}');

-- cancel_followups --------------------------------------------------------------
select set_eq(
  $$ select * from public.cancel_followups('30000000-0000-4000-8000-000000000a01', 'lead replied', '2030-01-01T10:00:00Z') $$,
  array['30000000-0000-4000-8000-000000000f01', '30000000-0000-4000-8000-000000000f02', '30000000-0000-4000-8000-000000000f03']::uuid[],
  'cancel_followups returns the lead''s queued follow-ups');
select results_eq(
  $$ select id::text, status from public.jobs where org_id = '30000000-0000-4000-8000-000000000001' order by id $$,
  $$ values ('30000000-0000-4000-8000-000000000f01', 'cancelled'), ('30000000-0000-4000-8000-000000000f02', 'cancelled'),
            ('30000000-0000-4000-8000-000000000f03', 'cancelled'), ('30000000-0000-4000-8000-000000000f04', 'running'),
            ('30000000-0000-4000-8000-000000000f05', 'queued'), ('30000000-0000-4000-8000-000000000f06', 'queued') $$,
  'only queued follow-ups of that lead are cancelled: not running ones, other kinds or other leads');
select is((select updated_at from public.jobs where id = '30000000-0000-4000-8000-000000000f01'),
  '2030-01-01T10:00:00Z'::timestamptz, 'updated_at is the as_of time');
select results_eq(
  $$ select payload->>'job_id', payload->>'kind', payload->>'reason', lead_id::text, created_at
       from public.events where type = 'job_cancelled' and org_id = '30000000-0000-4000-8000-000000000001'
      order by payload->>'job_id' $$,
  $$ values ('30000000-0000-4000-8000-000000000f01', 'followup', 'lead replied', '30000000-0000-4000-8000-000000000a01', '2030-01-01T10:00:00Z'::timestamptz),
            ('30000000-0000-4000-8000-000000000f02', 'followup', 'lead replied', '30000000-0000-4000-8000-000000000a01', '2030-01-01T10:00:00Z'::timestamptz),
            ('30000000-0000-4000-8000-000000000f03', 'followup', 'lead replied', '30000000-0000-4000-8000-000000000a01', '2030-01-01T10:00:00Z'::timestamptz) $$,
  'one job_cancelled event per cancelled job, with the reason');
select is_empty(
  $$ select * from public.cancel_followups('30000000-0000-4000-8000-000000000a01', 'again') $$,
  'a second cancel finds nothing');
select is((select count(*)::int from public.events where type = 'job_cancelled' and org_id = '30000000-0000-4000-8000-000000000001'), 3,
  'and writes no events');

-- schedule_followups ------------------------------------------------------------
select is(
  public.schedule_followups('30000000-0000-4000-8000-000000000a02',
    '[{"run_at":"2030-02-02T05:30:00Z","idempotency_key":"f-b2-1","payload":{"n":1}},
      {"run_at":"2030-02-04T05:30:00Z","idempotency_key":"f-b2-2","payload":{"n":2}},
      {"run_at":"2030-02-08T05:30:00Z","idempotency_key":"f-b2-3","payload":{"n":3}}]',
    'superseded', '2030-02-01T08:00:00Z')->'cancelled',
  '["30000000-0000-4000-8000-000000000f06"]'::jsonb,
  'schedule_followups cancels the older queued set');
select results_eq(
  $$ select idempotency_key, kind, status, run_at, payload, org_id::text
       from public.jobs where lead_id = '30000000-0000-4000-8000-000000000a02' and idempotency_key like 'f-b2-%' order by run_at $$,
  $$ values ('f-b2-1', 'followup', 'queued', '2030-02-02T05:30:00Z'::timestamptz, '{"n":1}'::jsonb, '30000000-0000-4000-8000-000000000001'),
            ('f-b2-2', 'followup', 'queued', '2030-02-04T05:30:00Z'::timestamptz, '{"n":2}'::jsonb, '30000000-0000-4000-8000-000000000001'),
            ('f-b2-3', 'followup', 'queued', '2030-02-08T05:30:00Z'::timestamptz, '{"n":3}'::jsonb, '30000000-0000-4000-8000-000000000001') $$,
  'and enqueues the new set as queued followup jobs in the lead''s org');
select is((select payload->>'reason' from public.events where payload->>'job_id' = '30000000-0000-4000-8000-000000000f06'),
  'superseded', 'the old job''s cancel event names the reason');
select is(
  public.schedule_followups('30000000-0000-4000-8000-000000000a02',
    '[{"run_at":"2030-02-02T05:30:00Z","idempotency_key":"f-b2-1","payload":{"n":1}},
      {"run_at":"2030-02-04T05:30:00Z","idempotency_key":"f-b2-2","payload":{"n":2}},
      {"run_at":"2030-02-08T05:30:00Z","idempotency_key":"f-b2-3","payload":{"n":3}}]',
    'superseded', '2030-02-01T08:00:00Z'),
  '{"enqueued":[],"cancelled":[]}'::jsonb,
  'a replay of the same schedule enqueues and cancels nothing');
select is((select count(*)::int from public.jobs where lead_id = '30000000-0000-4000-8000-000000000a02' and status = 'queued'), 3,
  'still exactly three queued follow-ups');
select is(
  public.schedule_followups('30000000-0000-4000-8000-0000000000ff', '[]', 'x'), null,
  'schedule_followups returns null for an unknown lead');
select throws_ok(
  $$ select public.schedule_followups('30000000-0000-4000-8000-000000000a02', '{}', 'x') $$,
  '22023', null, 'p_jobs must be an array');

-- record_opt_out ----------------------------------------------------------------
select is(
  cardinality(public.record_opt_out('30000000-0000-4000-8000-000000000a02', '2030-02-03T10:00:00Z')), 3,
  'record_opt_out cancels the lead''s queued follow-ups');
select is((select opted_out_at from public.leads where id = '30000000-0000-4000-8000-000000000a02'),
  '2030-02-03T10:00:00Z'::timestamptz, 'and sets opted_out_at');
select is((select count(*)::int from public.jobs where lead_id = '30000000-0000-4000-8000-000000000a02' and status = 'queued'), 0,
  'nothing left queued for the lead');
select is((select payload->>'reason' from public.events where payload->>'job_id' =
            (select id::text from public.jobs where idempotency_key = 'f-b2-3')),
  'lead opted out', 'the cancel events say the lead opted out');
select is(public.record_opt_out('30000000-0000-4000-8000-000000000a02', '2030-03-01T00:00:00Z'), '{}'::uuid[],
  'a second opt-out cancels nothing');
select is((select opted_out_at from public.leads where id = '30000000-0000-4000-8000-000000000a02'),
  '2030-02-03T10:00:00Z'::timestamptz, 'and keeps the first opted_out_at');
select is((select count(*)::int from public.events where type = 'lead_opted_out' and lead_id = '30000000-0000-4000-8000-000000000a02'), 2,
  'each opt-out message is logged');
select is(public.record_opt_out('30000000-0000-4000-8000-0000000000ff'), null, 'record_opt_out returns null for an unknown lead');

select * from finish();
rollback;
