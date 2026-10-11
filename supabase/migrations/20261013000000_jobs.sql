-- Spec 004, slice A: job queue, retries and dead letters, plus the `templates`
-- and `audit_log` tables (docs/specs/004-production-engine.md, "A. Jobs" and
-- "Schema additions"). Writes come only from Edge Functions with the service
-- role; members get select-only policies.

-- jobs ------------------------------------------------------------------------
-- One row per unit of engine work. `dead` rows are the dead-letter record.
-- `attempts` counts claims: claim_jobs increments it before the handler runs,
-- so a runner that crashes mid-job still uses up an attempt.
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  kind text not null check (kind in ('send_message', 'followup', 'weekly_report', 'canary')),
  run_at timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'cancelled', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  last_error text,
  payload jsonb not null default '{}'::jsonb
    constraint jobs_payload_is_object check (jsonb_typeof(payload) = 'object'),
  -- Every enqueue names its key (e.g. ack:<lead_id>:<enquiry iso>), so a retried
  -- request or a re-run never creates the same work twice.
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_idempotency_key_key unique (idempotency_key)
);
-- claim_jobs scans due queued jobs and stale running ones.
create index jobs_queued_run_at_idx on public.jobs (run_at) where status = 'queued';
create index jobs_running_updated_at_idx on public.jobs (updated_at) where status = 'running';
create index jobs_org_id_created_at_idx on public.jobs (org_id, created_at desc);
create index jobs_lead_id_idx on public.jobs (lead_id);

-- Keeps updated_at current unless the writer set it explicitly (the job runner
-- does, from its own clock, so tests can drive time).
create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke execute on function private.touch_updated_at() from public;

create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function private.touch_updated_at();

-- Which job sent a message. A job sends at most one message, so a retry after
-- a crash between "provider accepted" and "job marked done" finds the earlier
-- send instead of sending again.
alter table public.messages
  add column job_id uuid references public.jobs (id) on delete set null;
create unique index messages_job_id_sent_key
  on public.messages (job_id)
  where job_id is not null and status = 'sent';

-- templates -------------------------------------------------------------------
-- WhatsApp templates per org. Body uses {{1}}, {{2}}... with names in param_names.
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9_]{0,63}$'),
  language text not null default 'en',
  category text not null default 'utility' check (category in ('utility')),
  provider_template_id text,
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'approved', 'rejected')),
  body text not null,
  param_names text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint templates_org_id_name_language_key unique (org_id, name, language)
);

create trigger templates_touch_updated_at
  before update on public.templates
  for each row execute function private.touch_updated_at();

-- audit_log -------------------------------------------------------------------
-- Who changed what. actor is a user id or 'system'.
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  actor text not null check (
    actor = 'system'
    or actor ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  action text not null,
  target text,
  details jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index audit_log_org_id_at_idx on public.audit_log (org_id, at desc);

-- Row-level security ----------------------------------------------------------
alter table public.jobs enable row level security;
alter table public.templates enable row level security;
alter table public.audit_log enable row level security;

create policy "members read org jobs" on public.jobs
  for select to authenticated using (private.is_org_member(org_id));
create policy "members read org templates" on public.templates
  for select to authenticated using (private.is_org_member(org_id));
create policy "members read org audit log" on public.audit_log
  for select to authenticated using (private.is_org_member(org_id));

revoke all on public.jobs, public.templates, public.audit_log from anon, authenticated;
grant select on public.jobs, public.templates, public.audit_log to authenticated;
revoke all on sequence public.audit_log_id_seq from anon, authenticated;

-- claim_jobs ------------------------------------------------------------------
-- Returns up to `batch` due jobs and marks them running, counting an attempt.
-- `for update skip locked` means a second claimer running at the same moment
-- skips rows the first has locked instead of waiting for them or taking them,
-- so two claimers never get the same job.
--
-- A job left `running` for 15 minutes (its runner crashed or timed out; Edge
-- Functions stop long before that) is claimed again. If that pushes attempts
-- past max_attempts, the runner dead-letters it without running it.
--
-- `as_of` defaults to now(); the job runner passes its own clock so the
-- failure drill can move time forward.
create function private.claim_jobs(batch integer, as_of timestamptz default now())
returns setof public.jobs
language sql
volatile
set search_path = ''
as $$
  with due as (
    select j.id
      from public.jobs j
     where (j.status = 'queued' and j.run_at <= as_of)
        or (j.status = 'running' and j.updated_at <= as_of - interval '15 minutes')
     order by j.run_at, j.id
     limit greatest(batch, 0)
       for update skip locked
  )
  update public.jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         updated_at = as_of
    from due
   where j.id = due.id
  returning j.*;
$$;
revoke execute on function private.claim_jobs(integer, timestamptz) from public, anon, authenticated;

-- The private schema is not exposed over the Data API, so the run-jobs Edge
-- Function calls this thin wrapper with the service role. Security definer
-- (owned by postgres) so service_role needs no access to `private`; execute is
-- granted to service_role only.
create function public.claim_jobs(batch integer, as_of timestamptz default now())
returns setof public.jobs
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.claim_jobs(batch, as_of);
$$;
revoke execute on function public.claim_jobs(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_jobs(integer, timestamptz) to service_role;
