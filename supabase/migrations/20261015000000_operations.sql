-- Spec 004, slice E: operations. The canary org and its hourly job, and
-- delete_lead for data-deletion requests (docs/specs/004-production-engine.md,
-- "E. Operations"; how to use both is in docs/runbook.md).

-- Canary org --------------------------------------------------------------------
-- The canary org receives a fake enquiry every hour through the real
-- ingest-form URL (run-jobs/canary.ts). At most one org is the canary.
alter table public.orgs
  add column is_canary boolean not null default false;
create unique index orgs_single_canary_idx on public.orgs (is_canary) where is_canary;

comment on column public.orgs.is_canary is
  'The org the hourly canary posts fake enquiries to (spec 004, E.2). At most one.';

-- Idempotency key of the canary job for one org and one UTC hour. run-jobs
-- builds the same key (canaryIdempotencyKey in run-jobs/canary.ts), so the
-- seed below, the trigger and the job chain never queue two canaries in an hour.
create function private.canary_idempotency_key(org uuid, run_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'canary:' || org::text || ':' || to_char(run_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24');
$$;
revoke execute on function private.canary_idempotency_key(uuid, timestamptz) from public, anon, authenticated;

-- Queues a canary job for the org now, unless one is already queued for this
-- hour. Each canary run queues the next one an hour later, so this only starts
-- the chain.
create function private.start_canary(org uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  insert into public.jobs (org_id, kind, run_at, idempotency_key)
  values (org, 'canary', now(), private.canary_idempotency_key(org, now()))
  on conflict (idempotency_key) do nothing;
$$;
revoke execute on function private.start_canary(uuid) from public, anon, authenticated;

-- Marking an org as the canary (onboard-org with "is_canary": true) starts the
-- chain. Unmarking it ends the chain: the next canary job sees the org is no
-- longer the canary, cancels itself and queues nothing. Security definer
-- because onboard-org writes as service_role, which has no access to `private`.
create function private.orgs_start_canary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.start_canary(new.id);
  return new;
end;
$$;
revoke execute on function private.orgs_start_canary() from public, anon, authenticated;

create trigger orgs_start_canary_on_insert
  after insert on public.orgs
  for each row when (new.is_canary)
  execute function private.orgs_start_canary();
create trigger orgs_start_canary_on_update
  after update of is_canary on public.orgs
  for each row when (new.is_canary and not old.is_canary)
  execute function private.orgs_start_canary();

-- Seed the first canary job if a canary org already exists.
select private.start_canary(o.id) from public.orgs o where o.is_canary;

-- delete_lead -------------------------------------------------------------------
-- Removes a lead with its messages, events and jobs, and writes an audit_log
-- row (counts only, no personal data). For data-deletion requests and canary
-- cleanup. Returns false when there is no such lead, so it is safe to re-run.
--
-- Also removes events about the lead that carry its id only in the payload
-- (owner alerts, job events written without a lead_id). Owner-alert messages
-- have no lead_id and store no lead details (body is null), so they stay.
--
-- Security invoker: only service_role may execute it, and service_role
-- already has delete rights on these tables.
create function public.delete_lead(lead uuid)
returns boolean
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_org uuid;
  v_messages integer;
  v_events integer;
  v_jobs integer;
begin
  select l.org_id into v_org from public.leads l where l.id = delete_lead.lead for update;
  if v_org is null then
    return false;
  end if;

  delete from public.messages m where m.lead_id = delete_lead.lead;
  get diagnostics v_messages = row_count;

  delete from public.events e
   where e.lead_id = delete_lead.lead
      or (e.org_id = v_org and e.payload ->> 'lead_id' = delete_lead.lead::text);
  get diagnostics v_events = row_count;

  delete from public.jobs j where j.lead_id = delete_lead.lead;
  get diagnostics v_jobs = row_count;

  delete from public.leads l where l.id = delete_lead.lead;

  insert into public.audit_log (org_id, actor, action, target, details)
  values (v_org, 'system', 'lead.deleted', 'lead:' || delete_lead.lead::text,
          jsonb_build_object('messages', v_messages, 'events', v_events, 'jobs', v_jobs));
  return true;
end;
$$;
revoke execute on function public.delete_lead(uuid) from public, anon, authenticated;
grant execute on function public.delete_lead(uuid) to service_role;
