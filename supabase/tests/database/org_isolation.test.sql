-- A member of org A reads only org A's rows; anon reads nothing; nobody but the
-- service role writes.
begin;
select plan(19);

-- Fixtures, as postgres (RLS bypassed).
insert into auth.users (id, aud, role, email)
values ('aaaaaaaa-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'a@example.test'),
       ('bbbbbbbb-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'b@example.test');

insert into public.orgs (id, name, slug)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Org A', 'org-a'),
       ('bbbbbbbb-0000-4000-8000-000000000001', 'Org B', 'org-b');

insert into public.org_members (org_id, user_id, role)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'owner'),
       ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000000b', 'owner');

insert into public.sources (id, org_id, kind, name, public_key)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'web_form', 'A form', 'a-form'),
       ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'web_form', 'B form', 'b-form');

insert into public.leads (id, org_id, source_id, name, phone_e164, consent_at)
values ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000002', 'Lead A', '+919811111111', now()),
       ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000001',
        'bbbbbbbb-0000-4000-8000-000000000002', 'Lead B', '+919822222222', now());

insert into public.messages (org_id, lead_id, to_phone, direction, kind, template_name, provider)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003',
        '+919811111111', 'outbound', 'template', 'enquiry_ack', 'fake'),
       ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000003',
        '+919822222222', 'outbound', 'template', 'enquiry_ack', 'fake');

insert into public.events (org_id, lead_id, type)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000003', 'enquiry_received'),
       ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000003', 'enquiry_received');

insert into public.webhook_events (provider, provider_event_id, payload)
values ('fake', 'evt-1', '{}');

-- As user A ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-4000-8000-00000000000a", "role": "authenticated"}';

select results_eq($$ select id from public.orgs $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
  'member of A sees only org A (orgs)');
select results_eq($$ select org_id from public.org_members $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
  'member of A sees only org A memberships');
select results_eq($$ select id from public.sources $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000002'::uuid) $$,
  'member of A sees only org A sources (not the seeded demo source)');
select results_eq($$ select id from public.leads $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000003'::uuid) $$,
  'member of A sees only org A leads');
select results_eq($$ select distinct org_id from public.messages $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
  'member of A sees only org A messages');
select results_eq($$ select distinct org_id from public.events $$,
  $$ values ('aaaaaaaa-0000-4000-8000-000000000001'::uuid) $$,
  'member of A sees only org A events');
select is_empty($$ select 1 from public.leads where org_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'member of A cannot read org B leads even when filtering for them');
select throws_ok($$ select * from public.webhook_events $$, '42501', null,
  'authenticated cannot read webhook_events');

select throws_ok(
  $$ insert into public.leads (org_id, name, phone_e164, consent_at)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'Sneaky', '+919833333333', now()) $$,
  '42501', null, 'authenticated cannot insert leads, even into its own org');
select throws_ok(
  $$ insert into public.events (org_id, type) values ('aaaaaaaa-0000-4000-8000-000000000001', 'x') $$,
  '42501', null, 'authenticated cannot insert events');
select throws_ok($$ update public.leads set status = 'lost' $$, '42501', null,
  'authenticated cannot update leads');
select throws_ok($$ delete from public.leads $$, '42501', null,
  'authenticated cannot delete leads');

-- Authenticated user with no membership sees nothing.
set local request.jwt.claims = '{"sub": "cccccccc-0000-4000-8000-00000000000c", "role": "authenticated"}';
select is_empty($$ select 1 from public.leads $$, 'non-member sees no leads');
select is_empty($$ select 1 from public.orgs $$, 'non-member sees no orgs');

-- As anon --------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok($$ select * from public.leads $$, '42501', null, 'anon cannot read leads');
select throws_ok($$ select * from public.messages $$, '42501', null, 'anon cannot read messages');
select throws_ok($$ select * from public.events $$, '42501', null, 'anon cannot read events');
select throws_ok($$ select * from public.orgs $$, '42501', null, 'anon cannot read orgs');
select throws_ok($$ select * from public.sources $$, '42501', null, 'anon cannot read sources');

select * from finish();
rollback;
