-- Spec 004, slice A: jobs, templates, audit_log, claim_jobs and the run-jobs schedule.
--
-- About concurrency: a pgTAP file runs in one session, and a session never
-- blocks on its own row locks, so a true two-claimer race can't be staged here
-- (dblink would need a second login, which the local stack only allows
-- without a password, and Postgres refuses that to non-superusers). This file
-- proves what one session can: claimed jobs leave the queue, so back-to-back
-- claims are disjoint, and the claim query uses FOR UPDATE SKIP LOCKED. The
-- actual race, a claim held open in one connection while a second connection
-- claims, is in supabase/functions/run-jobs/claim_test.ts.
begin;
select plan(49);

-- Schema ----------------------------------------------------------------------
select columns_are('public', 'jobs',
  array['id', 'org_id', 'lead_id', 'kind', 'run_at', 'status', 'attempts', 'max_attempts', 'last_error',
        'payload', 'idempotency_key', 'created_at', 'updated_at']);
select columns_are('public', 'templates',
  array['id', 'org_id', 'name', 'language', 'category', 'provider_template_id', 'status', 'body',
        'param_names', 'created_at', 'updated_at']);
select columns_are('public', 'audit_log', array['id', 'org_id', 'actor', 'action', 'target', 'details', 'at']);

select col_default_is('public', 'jobs', 'status', 'queued'::text, 'jobs.status defaults to queued');
select col_default_is('public', 'jobs', 'attempts', 0, 'jobs.attempts defaults to 0');
select col_default_is('public', 'jobs', 'max_attempts', 5, 'jobs.max_attempts defaults to 5');
select col_type_is('public', 'jobs', 'payload', 'jsonb', 'jobs.payload is jsonb');
select col_type_is('public', 'jobs', 'run_at', 'timestamp with time zone', 'jobs.run_at is timestamptz');
select col_is_unique('public', 'jobs', 'idempotency_key', 'jobs.idempotency_key is unique');
select col_is_null('public', 'jobs', 'lead_id', 'jobs.lead_id is nullable');
select col_is_unique('public', 'templates', array['org_id', 'name', 'language'],
  'templates (org_id, name, language) is unique');
select col_type_is('public', 'templates', 'param_names', 'text[]', 'templates.param_names is text[]');
select col_default_is('public', 'templates', 'status', 'draft'::text, 'templates.status defaults to draft');
select col_default_is('public', 'templates', 'category', 'utility'::text, 'templates.category defaults to utility');
select fk_ok('public', 'messages', 'job_id', 'public', 'jobs', 'id');

-- Fixtures (as postgres, RLS bypassed) ------------------------------------------
insert into public.orgs (id, name, slug)
values ('20000000-0000-4000-8000-000000000001', 'Jobs Org', 'jobs-org');
insert into public.leads (id, org_id, name, phone_e164, consent_at)
values ('20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
        'Job Lead', '+919811111199', now());

-- Constraints -----------------------------------------------------------------
select throws_ok(
  $$ insert into public.jobs (org_id, kind, idempotency_key)
     values ('20000000-0000-4000-8000-000000000001', 'mystery', 'k-kind') $$,
  '23514', null, 'jobs.kind rejects unknown kinds');
select throws_ok(
  $$ insert into public.jobs (org_id, kind, status, idempotency_key)
     values ('20000000-0000-4000-8000-000000000001', 'send_message', 'lost', 'k-status') $$,
  '23514', null, 'jobs.status rejects unknown statuses');
select throws_ok(
  $$ insert into public.jobs (org_id, kind, payload, idempotency_key)
     values ('20000000-0000-4000-8000-000000000001', 'send_message', '[]', 'k-payload') $$,
  '23514', null, 'jobs.payload must be an object');
select throws_ok(
  $$ insert into public.jobs (org_id, kind) values ('20000000-0000-4000-8000-000000000001', 'send_message') $$,
  '23502', null, 'jobs.idempotency_key is required');
select lives_ok(
  $$ insert into public.jobs (org_id, kind, idempotency_key)
     values ('20000000-0000-4000-8000-000000000001', 'send_message', 'k-dup') $$,
  'a job with defaults inserts');
select throws_ok(
  $$ insert into public.jobs (org_id, kind, idempotency_key)
     values ('20000000-0000-4000-8000-000000000001', 'canary', 'k-dup') $$,
  '23505', null, 'the same idempotency key cannot be enqueued twice');
select throws_ok(
  $$ insert into public.templates (org_id, name, body, category)
     values ('20000000-0000-4000-8000-000000000001', 'enquiry_ack', 'Hi {{1}}', 'marketing') $$,
  '23514', null, 'templates.category is utility only');
select lives_ok(
  $$ insert into public.templates (org_id, name, body, param_names)
     values ('20000000-0000-4000-8000-000000000001', 'enquiry_ack', 'Hi {{1}}', '{first_name}') $$,
  'a template inserts');
select throws_ok(
  $$ insert into public.templates (org_id, name, body)
     values ('20000000-0000-4000-8000-000000000001', 'enquiry_ack', 'Hello {{1}}') $$,
  '23505', null, 'one template per (org, name, language)');
select throws_ok(
  $$ insert into public.audit_log (org_id, actor, action)
     values ('20000000-0000-4000-8000-000000000001', 'mallory', 'x') $$,
  '23514', null, 'audit_log.actor is a user id or system');
select lives_ok(
  $$ insert into public.audit_log (org_id, actor, action, target)
     values ('20000000-0000-4000-8000-000000000001', 'system', 'template.approved', 'enquiry_ack') $$,
  'audit_log accepts system as actor');

-- One message per job, whatever its status (a delivered send still counts).
insert into public.jobs (id, org_id, kind, idempotency_key)
values ('20000000-0000-4000-8000-0000000000aa', '20000000-0000-4000-8000-000000000001', 'send_message', 'k-msg');
select throws_ok(
  $$ insert into public.messages (org_id, direction, kind, provider, status, job_id)
     values ('20000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', 'delivered', '20000000-0000-4000-8000-0000000000aa'),
            ('20000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', 'sent', '20000000-0000-4000-8000-0000000000aa') $$,
  '23505', null, 'a job records at most one message, in any status');
select lives_ok(
  $$ insert into public.messages (org_id, direction, kind, provider, status, job_id)
     values ('20000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', 'sent', null),
            ('20000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', 'sent', null) $$,
  'messages without a job are not limited');

-- updated_at is touched on update unless set explicitly.
update public.jobs set updated_at = '2001-01-01T00:00:00Z' where idempotency_key = 'k-msg';
select is((select updated_at from public.jobs where idempotency_key = 'k-msg'), '2001-01-01T00:00:00Z'::timestamptz,
  'an explicit updated_at is kept');
update public.jobs set last_error = 'x' where idempotency_key = 'k-msg';
select ok((select updated_at > '2001-01-01T00:00:00Z' from public.jobs where idempotency_key = 'k-msg'),
  'updated_at moves on an update that does not set it');

-- claim_jobs ------------------------------------------------------------------
-- Clear the queue so only these fixtures are claimable at the fixed as_of.
delete from public.jobs;
insert into public.jobs (id, org_id, lead_id, kind, run_at, status, attempts, idempotency_key, updated_at)
values
  ('20000000-0000-4000-8000-000000000011', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2030-01-01T00:00:00Z', 'queued', 0, 'c-1', '2030-01-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000012', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2030-01-01T00:01:00Z', 'queued', 2, 'c-2', '2030-01-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000013', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2030-01-01T00:02:00Z', 'queued', 0, 'c-3', '2030-01-01T00:00:00Z'),
  -- not due yet
  ('20000000-0000-4000-8000-000000000014', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2030-01-01T01:00:00Z', 'queued', 0, 'c-4', '2030-01-01T00:00:00Z'),
  -- finished states are never claimed
  ('20000000-0000-4000-8000-000000000015', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2029-01-01T00:00:00Z', 'done', 1, 'c-5', '2029-01-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000016', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2029-01-01T00:00:00Z', 'dead', 5, 'c-6', '2029-01-01T00:00:00Z'),
  ('20000000-0000-4000-8000-000000000017', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2029-01-01T00:00:00Z', 'cancelled', 0, 'c-7', '2029-01-01T00:00:00Z'),
  -- running, claimed 5 minutes ago: still leased
  ('20000000-0000-4000-8000-000000000018', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2029-01-01T00:00:00Z', 'running', 1, 'c-8', '2030-01-01T00:05:00Z'),
  -- running, claimed 20 minutes ago: the lease expired, so it is claimable again
  ('20000000-0000-4000-8000-000000000019', '20000000-0000-4000-8000-000000000001', null, 'send_message', '2030-01-01T00:03:00Z', 'running', 1, 'c-9', '2029-12-31T23:50:00Z');

create temp table first_claim as
  select * from private.claim_jobs(2, '2030-01-01T00:10:00Z');
select results_eq(
  $$ select id from first_claim order by run_at $$,
  $$ values ('20000000-0000-4000-8000-000000000011'::uuid), ('20000000-0000-4000-8000-000000000012'::uuid) $$,
  'claim_jobs returns the oldest due jobs, up to batch');
select results_eq(
  $$ select status, attempts, updated_at from public.jobs where id in (select id from first_claim) order by run_at $$,
  $$ values ('running'::text, 1, '2030-01-01T00:10:00Z'::timestamptz), ('running'::text, 3, '2030-01-01T00:10:00Z'::timestamptz) $$,
  'claimed jobs are running, attempts incremented, updated_at = as_of');

create temp table second_claim as
  select * from private.claim_jobs(10, '2030-01-01T00:10:00Z');
select results_eq(
  $$ select id from second_claim order by run_at $$,
  $$ values ('20000000-0000-4000-8000-000000000013'::uuid), ('20000000-0000-4000-8000-000000000019'::uuid) $$,
  'a second claim gets the rest: due queued jobs and the expired lease, nothing already claimed');
select is_empty(
  $$ select id from first_claim intersect select id from second_claim $$,
  'back-to-back claims never return the same job');
select is((select attempts from public.jobs where id = '20000000-0000-4000-8000-000000000019'), 2,
  'reclaiming an expired lease counts another attempt');
select is_empty($$ select * from private.claim_jobs(10, '2030-01-01T00:10:00Z') $$,
  'nothing is left to claim: not-due, leased and finished jobs stay put');
select is((select count(*)::int from public.jobs where status in ('done', 'dead', 'cancelled')), 3,
  'finished jobs are untouched');
select is((select count(*)::int from private.claim_jobs(0, '2031-01-01T00:00:00Z')), 0, 'batch 0 claims nothing');
select ok(
  pg_get_functiondef('private.claim_jobs(integer, timestamptz)'::regprocedure) ~* 'for\s+update\s+skip\s+locked',
  'claim_jobs locks with FOR UPDATE SKIP LOCKED');

-- Who may claim ----------------------------------------------------------------
select ok(has_function_privilege('service_role', 'public.claim_jobs(integer, timestamptz)', 'execute'),
  'service_role can call public.claim_jobs');
select ok(not has_function_privilege('anon', 'public.claim_jobs(integer, timestamptz)', 'execute'),
  'anon cannot call public.claim_jobs');
select ok(not has_function_privilege('authenticated', 'public.claim_jobs(integer, timestamptz)', 'execute'),
  'authenticated cannot call public.claim_jobs');
select ok(not has_function_privilege('authenticated', 'private.claim_jobs(integer, timestamptz)', 'execute'),
  'authenticated cannot call private.claim_jobs');
select ok(not has_function_privilege('anon', 'private.invoke_run_jobs()', 'execute')
      and not has_function_privilege('authenticated', 'private.invoke_run_jobs()', 'execute'),
  'only the owner can call private.invoke_run_jobs');
select is_definer('public', 'claim_jobs', array['integer', 'timestamp with time zone']);

-- Schedule --------------------------------------------------------------------
select results_eq(
  $$ select schedule, command from cron.job where jobname = 'run-jobs' $$,
  $$ values ('* * * * *'::text, 'select private.invoke_run_jobs()'::text) $$,
  'pg_cron runs run-jobs every minute');

delete from vault.secrets where name in ('run_jobs_url', 'run_jobs_secret');
select is(private.invoke_run_jobs(), null, 'without Vault secrets the cron command does nothing');
select vault.create_secret('http://127.0.0.1:9/functions/v1/run-jobs', 'run_jobs_url');
select is(private.invoke_run_jobs(), null, 'with only the URL it still does nothing');
select vault.create_secret('test-secret', 'run_jobs_secret');
create temp table req as select private.invoke_run_jobs() as id;
select results_eq(
  $$ select q.url, q.method::text, q.headers->>'x-run-jobs-secret'
       from net.http_request_queue q join req on q.id = req.id $$,
  $$ values ('http://127.0.0.1:9/functions/v1/run-jobs'::text, 'POST'::text, 'test-secret'::text) $$,
  'with both secrets it posts to the URL with the secret header');

select * from finish();
rollback;
