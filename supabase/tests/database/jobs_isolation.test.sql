-- Spec 004, slice A: a member of org A reads only org A's jobs, templates and
-- audit log; anon reads nothing; nobody but the service role writes.
begin;
select plan(16);

insert into auth.users (id, aud, role, email)
values ('aaaaaaaa-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'a@example.test'),
       ('bbbbbbbb-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', 'b@example.test');

insert into public.orgs (id, name, slug)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'Org A', 'org-a'),
       ('bbbbbbbb-0000-4000-8000-000000000001', 'Org B', 'org-b');

insert into public.org_members (org_id, user_id, role)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'owner'),
       ('bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-00000000000b', 'owner');

insert into public.jobs (id, org_id, kind, idempotency_key)
values ('aaaaaaaa-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000001', 'send_message', 'iso-a'),
       ('bbbbbbbb-0000-4000-8000-0000000000c1', 'bbbbbbbb-0000-4000-8000-000000000001', 'send_message', 'iso-b');
insert into public.templates (id, org_id, name, body)
values ('aaaaaaaa-0000-4000-8000-0000000000c2', 'aaaaaaaa-0000-4000-8000-000000000001', 'enquiry_ack', 'Hi {{1}}'),
       ('bbbbbbbb-0000-4000-8000-0000000000c2', 'bbbbbbbb-0000-4000-8000-000000000001', 'enquiry_ack', 'Hi {{1}}');
insert into public.audit_log (org_id, actor, action)
values ('aaaaaaaa-0000-4000-8000-000000000001', 'system', 'a.action'),
       ('bbbbbbbb-0000-4000-8000-000000000001', 'system', 'b.action');

-- As user A ------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub": "aaaaaaaa-0000-4000-8000-00000000000a", "role": "authenticated"}';

select results_eq($$ select id from public.jobs $$,
  $$ values ('aaaaaaaa-0000-4000-8000-0000000000c1'::uuid) $$, 'member of A sees only org A jobs');
select results_eq($$ select id from public.templates $$,
  $$ values ('aaaaaaaa-0000-4000-8000-0000000000c2'::uuid) $$, 'member of A sees only org A templates');
select results_eq($$ select action from public.audit_log $$,
  $$ values ('a.action'::text) $$, 'member of A sees only org A audit log');
select is_empty($$ select 1 from public.jobs where org_id = 'bbbbbbbb-0000-4000-8000-000000000001' $$,
  'member of A cannot read org B jobs even when filtering for them');

select throws_ok(
  $$ insert into public.jobs (org_id, kind, idempotency_key)
     values ('aaaaaaaa-0000-4000-8000-000000000001', 'send_message', 'sneaky') $$,
  '42501', null, 'authenticated cannot enqueue jobs, even for its own org');
select throws_ok($$ update public.jobs set status = 'done' $$, '42501', null, 'authenticated cannot update jobs');
select throws_ok($$ delete from public.templates $$, '42501', null, 'authenticated cannot delete templates');
select throws_ok(
  $$ insert into public.audit_log (org_id, actor, action) values ('aaaaaaaa-0000-4000-8000-000000000001', 'system', 'x') $$,
  '42501', null, 'authenticated cannot write the audit log');
select throws_ok($$ select * from public.claim_jobs(10) $$, '42501', null,
  'authenticated cannot claim jobs');

-- Authenticated user with no membership sees nothing.
set local request.jwt.claims = '{"sub": "cccccccc-0000-4000-8000-00000000000c", "role": "authenticated"}';
select is_empty($$ select 1 from public.jobs $$, 'non-member sees no jobs');
select is_empty($$ select 1 from public.templates $$, 'non-member sees no templates');
select is_empty($$ select 1 from public.audit_log $$, 'non-member sees no audit log');

-- As anon --------------------------------------------------------------------
reset role;
set local role anon;
set local request.jwt.claims = '{"role": "anon"}';
select throws_ok($$ select * from public.jobs $$, '42501', null, 'anon cannot read jobs');
select throws_ok($$ select * from public.templates $$, '42501', null, 'anon cannot read templates');
select throws_ok($$ select * from public.audit_log $$, '42501', null, 'anon cannot read the audit log');
select throws_ok($$ select * from public.claim_jobs(10) $$, '42501', null, 'anon cannot claim jobs');

select * from finish();
rollback;
