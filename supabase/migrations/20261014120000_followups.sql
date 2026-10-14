-- Spec 004, slice B: follow-ups and opt-outs (docs/specs/004-production-engine.md,
-- "B. Follow-ups and window" and "Schema additions").
--
-- - leads.opted_out_at: set when the lead sends STOP or UNSUBSCRIBE. Nothing
--   is sent to the lead after it (B.4).
-- - private.cancel_followups: cancels a lead's queued follow-ups and logs why,
--   in one statement. The WhatsApp webhook calls it, from its own SQL function
--   when it must share a transaction with recording the reply (B.3).
-- - private.schedule_followups: enqueues an enquiry's follow-ups and cancels
--   the lead's older ones in one transaction (a re-enquiry replaces the set).
-- - private.record_opt_out: sets opted_out_at and cancels follow-ups together.
--
-- Each has a public security-definer wrapper for the Edge Functions, executable
-- by service_role only, as with claim_jobs.

alter table public.leads add column opted_out_at timestamptz;

comment on column public.leads.opted_out_at is
  'When the lead opted out (STOP/UNSUBSCRIBE). Nothing further is sent to the lead (spec 004, B.4).';

-- Follow-up jobs are looked up by lead and status on every cancel.
create index jobs_lead_id_kind_queued_idx on public.jobs (lead_id) where kind = 'followup' and status = 'queued';

-- cancel_followups ------------------------------------------------------------
-- Sets the lead's queued `followup` jobs to cancelled and writes one
-- `job_cancelled` event per job (payload { job_id, kind, reason }, as run-jobs
-- writes for a handler's cancel). Jobs whose idempotency key is in `p_keep_keys`
-- are left alone. Running jobs are left alone too; the follow-up handler
-- re-checks the lead before sending. Returns the cancelled job ids.
create function private.cancel_followups(
  p_lead_id uuid,
  p_reason text,
  p_as_of timestamptz default now(),
  p_keep_keys text[] default '{}'
)
returns setof uuid
language sql
volatile
set search_path = ''
as $$
  with cancelled as (
    update public.jobs j
       set status = 'cancelled',
           updated_at = p_as_of
     where j.lead_id = p_lead_id
       and j.kind = 'followup'
       and j.status = 'queued'
       and j.idempotency_key <> all (coalesce(p_keep_keys, '{}'))
    returning j.id, j.org_id, j.lead_id, j.kind
  ), logged as (
    insert into public.events (org_id, lead_id, type, payload, created_at)
    select c.org_id, c.lead_id, 'job_cancelled',
           jsonb_build_object('job_id', c.id, 'kind', c.kind, 'reason', p_reason), p_as_of
      from cancelled c
  )
  select c.id from cancelled c;
$$;
revoke execute on function private.cancel_followups(uuid, text, timestamptz, text[]) from public, anon, authenticated;

-- schedule_followups ----------------------------------------------------------
-- p_jobs: [{ run_at, idempotency_key, payload }], built by followUpJobs() in
-- supabase/functions/_shared/followups.ts. Inserts them as `followup` jobs for
-- the lead's org (an existing key is skipped, so a replay changes nothing) and
-- cancels every other queued follow-up of the lead with p_reason.
-- Returns { enqueued: [ids], cancelled: [ids] }, or null if the lead is gone.
create function private.schedule_followups(
  p_lead_id uuid,
  p_jobs jsonb,
  p_reason text,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_org uuid;
  v_keys text[];
  v_cancelled uuid[];
  v_enqueued uuid[];
begin
  if jsonb_typeof(p_jobs) is distinct from 'array' then
    raise exception 'p_jobs must be a JSON array' using errcode = '22023';
  end if;
  select l.org_id into v_org from public.leads l where l.id = p_lead_id;
  if v_org is null then
    return null;
  end if;

  select coalesce(array_agg(x.idempotency_key), '{}')
    into v_keys
    from jsonb_to_recordset(p_jobs) as x (idempotency_key text);

  select coalesce(array_agg(c), '{}')
    into v_cancelled
    from private.cancel_followups(p_lead_id, p_reason, p_as_of, v_keys) as c;

  with inserted as (
    insert into public.jobs (org_id, lead_id, kind, run_at, idempotency_key, payload)
    select v_org, p_lead_id, 'followup', x.run_at, x.idempotency_key, coalesce(x.payload, '{}')
      from jsonb_to_recordset(p_jobs) as x (run_at timestamptz, idempotency_key text, payload jsonb)
    on conflict (idempotency_key) do nothing
    returning id
  )
  select coalesce(array_agg(i.id), '{}') into v_enqueued from inserted i;

  return jsonb_build_object('enqueued', to_jsonb(v_enqueued), 'cancelled', to_jsonb(v_cancelled));
end;
$$;
revoke execute on function private.schedule_followups(uuid, jsonb, text, timestamptz) from public, anon, authenticated;

-- record_opt_out --------------------------------------------------------------
-- Sets opted_out_at (the first opt-out wins), logs `lead_opted_out` and cancels
-- the lead's queued follow-ups. Returns the cancelled job ids, or null if the
-- lead does not exist.
create function private.record_opt_out(p_lead_id uuid, p_at timestamptz default now())
returns uuid[]
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_org uuid;
  v_first timestamptz;
  v_cancelled uuid[];
begin
  update public.leads l
     set opted_out_at = coalesce(l.opted_out_at, p_at)
   where l.id = p_lead_id
  returning l.org_id, l.opted_out_at into v_org, v_first;
  if v_org is null then
    return null;
  end if;

  select coalesce(array_agg(c), '{}')
    into v_cancelled
    from private.cancel_followups(p_lead_id, 'lead opted out', p_at) as c;

  insert into public.events (org_id, lead_id, type, payload, created_at)
  values (v_org, p_lead_id, 'lead_opted_out',
          jsonb_build_object('opted_out_at', v_first, 'cancelled_jobs', to_jsonb(v_cancelled)), p_at);
  return v_cancelled;
end;
$$;
revoke execute on function private.record_opt_out(uuid, timestamptz) from public, anon, authenticated;

-- Public wrappers for the Edge Functions (service_role only) -----------------
create function public.cancel_followups(p_lead_id uuid, p_reason text, p_as_of timestamptz default now())
returns setof uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.cancel_followups(p_lead_id, p_reason, p_as_of);
$$;
revoke execute on function public.cancel_followups(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.cancel_followups(uuid, text, timestamptz) to service_role;

create function public.schedule_followups(p_lead_id uuid, p_jobs jsonb, p_reason text, p_as_of timestamptz default now())
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.schedule_followups(p_lead_id, p_jobs, p_reason, p_as_of);
$$;
revoke execute on function public.schedule_followups(uuid, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.schedule_followups(uuid, jsonb, text, timestamptz) to service_role;

create function public.record_opt_out(p_lead_id uuid, p_at timestamptz default now())
returns uuid[]
language sql
volatile
security definer
set search_path = ''
as $$
  select private.record_opt_out(p_lead_id, p_at);
$$;
revoke execute on function public.record_opt_out(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.record_opt_out(uuid, timestamptz) to service_role;
