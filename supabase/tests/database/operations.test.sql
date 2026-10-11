-- Spec 004, slice E: delete_lead and the canary org.
begin;
select plan(27);

-- Fixtures (as postgres, RLS bypassed) ------------------------------------------
insert into public.orgs (id, name, slug)
values ('e0000000-0000-4000-8000-000000000001', 'Ops Org', 'ops-org'),
       ('e0000000-0000-4000-8000-000000000002', 'Other Org', 'ops-other-org');
insert into public.leads (id, org_id, name, phone_e164, consent_at)
values ('e0000000-0000-4000-8000-0000000000a1', 'e0000000-0000-4000-8000-000000000001', 'Gone', '+919811100001', now()),
       ('e0000000-0000-4000-8000-0000000000a2', 'e0000000-0000-4000-8000-000000000001', 'Stays', '+919811100002', now());
insert into public.jobs (id, org_id, lead_id, kind, idempotency_key)
values ('e0000000-0000-4000-8000-0000000000b1', 'e0000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-0000000000a1', 'send_message', 'ops-test-job-1'),
       ('e0000000-0000-4000-8000-0000000000b2', 'e0000000-0000-4000-8000-000000000001',
        'e0000000-0000-4000-8000-0000000000a2', 'send_message', 'ops-test-job-2');
insert into public.messages (org_id, lead_id, job_id, direction, kind, provider, status)
values ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000a1',
        'e0000000-0000-4000-8000-0000000000b1', 'outbound', 'template', 'fake', 'sent'),
       ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000a1',
        null, 'inbound', 'session', 'fake', 'delivered'),
       ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000a2',
        null, 'outbound', 'template', 'fake', 'sent');
insert into public.events (org_id, lead_id, type, payload)
values ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000a1', 'lead_created', '{}'),
       ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000a1', 'ack_sent', '{}'),
       -- About the lead, but with its id only in the payload.
       ('e0000000-0000-4000-8000-000000000001', null, 'owner_alert_sent',
        '{"lead_id": "e0000000-0000-4000-8000-0000000000a1"}'),
       ('e0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000a2', 'lead_created', '{}');

-- delete_lead: who may call it ----------------------------------------------------
select has_function('public', 'delete_lead', array['uuid']);
select ok(not has_function_privilege('anon', 'public.delete_lead(uuid)', 'execute'), 'anon cannot execute delete_lead');
select ok(not has_function_privilege('authenticated', 'public.delete_lead(uuid)', 'execute'),
  'authenticated cannot execute delete_lead');
select ok(has_function_privilege('service_role', 'public.delete_lead(uuid)', 'execute'),
  'service_role can execute delete_lead');

set local role anon;
select throws_ok($$ select public.delete_lead('e0000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'anon calling delete_lead is refused');
reset role;
set local role authenticated;
select throws_ok($$ select public.delete_lead('e0000000-0000-4000-8000-0000000000a1') $$,
  '42501', null, 'authenticated calling delete_lead is refused');
reset role;
select is((select count(*) from public.leads where id = 'e0000000-0000-4000-8000-0000000000a1'), 1::bigint,
  'the refused calls deleted nothing');

-- delete_lead: what it removes ----------------------------------------------------
set local role service_role;
select is(public.delete_lead('e0000000-0000-4000-8000-0000000000a1'), true, 'delete_lead returns true for a lead it deleted');
reset role;

select is((select count(*) from public.leads where id = 'e0000000-0000-4000-8000-0000000000a1'), 0::bigint, 'lead is gone');
select is((select count(*) from public.messages where lead_id = 'e0000000-0000-4000-8000-0000000000a1'), 0::bigint,
  'its messages are gone');
select is((select count(*) from public.events where lead_id = 'e0000000-0000-4000-8000-0000000000a1'
             or payload ->> 'lead_id' = 'e0000000-0000-4000-8000-0000000000a1'), 0::bigint,
  'its events are gone, including ones that name it only in the payload');
select is((select count(*) from public.jobs where id = 'e0000000-0000-4000-8000-0000000000b1'), 0::bigint, 'its jobs are gone');

select is((select count(*) from public.leads where id = 'e0000000-0000-4000-8000-0000000000a2'), 1::bigint,
  'another lead in the same org is untouched');
select is((select count(*) from public.messages where lead_id = 'e0000000-0000-4000-8000-0000000000a2'), 1::bigint,
  'its messages are untouched');
select is((select count(*) from public.events where lead_id = 'e0000000-0000-4000-8000-0000000000a2'), 1::bigint,
  'its events are untouched');
select is((select count(*) from public.jobs where id = 'e0000000-0000-4000-8000-0000000000b2'), 1::bigint,
  'its jobs are untouched');

select results_eq(
  $$ select org_id, actor, action, target, details from public.audit_log
      where target = 'lead:e0000000-0000-4000-8000-0000000000a1' $$,
  $$ values ('e0000000-0000-4000-8000-000000000001'::uuid, 'system'::text, 'lead.deleted'::text,
             'lead:e0000000-0000-4000-8000-0000000000a1'::text,
             '{"messages": 2, "events": 3, "jobs": 1}'::jsonb) $$,
  'one audit_log row with counts and no personal data');

set local role service_role;
select is(public.delete_lead('e0000000-0000-4000-8000-0000000000a1'), false, 'deleting it again returns false');
reset role;
select is((select count(*) from public.audit_log where target = 'lead:e0000000-0000-4000-8000-0000000000a1'), 1::bigint,
  'a repeat call writes no second audit row');

-- Canary org ------------------------------------------------------------------------
select col_default_is('public', 'orgs', 'is_canary', 'false', 'orgs.is_canary defaults to false');

-- Clear any canary a developer marked locally, so this test controls the only one.
update public.orgs set is_canary = false where is_canary;

update public.orgs set is_canary = true where id = 'e0000000-0000-4000-8000-000000000001';
select results_eq(
  $$ select kind, status, idempotency_key from public.jobs
      where org_id = 'e0000000-0000-4000-8000-000000000001' and kind = 'canary' $$,
  $$ values ('canary'::text, 'queued'::text,
             'canary:e0000000-0000-4000-8000-000000000001:' || to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24')) $$,
  'marking an org as the canary queues its first canary job, keyed by the hour');
select ok((select run_at <= now() from public.jobs
            where org_id = 'e0000000-0000-4000-8000-000000000001' and kind = 'canary'),
  'the first canary job is due now');

update public.orgs set is_canary = true, name = 'Ops Org Renamed' where id = 'e0000000-0000-4000-8000-000000000001';
update public.orgs set is_canary = false where id = 'e0000000-0000-4000-8000-000000000001';
update public.orgs set is_canary = true where id = 'e0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.jobs where org_id = 'e0000000-0000-4000-8000-000000000001' and kind = 'canary'),
  1::bigint, 're-marking within the hour queues no second canary job');

select throws_ok(
  $$ update public.orgs set is_canary = true where id = 'e0000000-0000-4000-8000-000000000002' $$,
  '23505', null, 'a second canary org is refused');
select throws_ok(
  $$ insert into public.orgs (name, slug, is_canary) values ('Third', 'ops-third-org', true) $$,
  '23505', null, 'inserting a second canary org is refused');

update public.orgs set is_canary = false where id = 'e0000000-0000-4000-8000-000000000001';
insert into public.orgs (id, name, slug, is_canary)
values ('e0000000-0000-4000-8000-000000000003', 'New Canary', 'ops-new-canary', true);
select is((select count(*) from public.jobs where org_id = 'e0000000-0000-4000-8000-000000000003' and kind = 'canary'),
  1::bigint, 'inserting an org as the canary queues its first canary job');

set local role service_role;
select lives_ok(
  $$ update public.orgs set is_canary = false where id = 'e0000000-0000-4000-8000-000000000003';
     update public.orgs set is_canary = true where id = 'e0000000-0000-4000-8000-000000000002' $$,
  'service_role (onboard-org) can mark an org as the canary');
reset role;

select * from finish();
rollback;
