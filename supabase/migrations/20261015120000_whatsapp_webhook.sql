-- Spec 004, slice C: the WhatsApp webhook (docs/specs/004-production-engine.md,
-- "C. Webhook").
--
-- - webhook_events gets what processing needs: the event kind, the org and
--   lead it was routed to, how many times processing was tried, the last
--   processing error and the outcome. Still service-role only (no policies):
--   it holds raw provider payloads.
-- - private.process_whatsapp_event records one webhook event in one
--   transaction: the message, the lead's timestamps, cancelling follow-ups or
--   recording an opt-out (B.3, B.4), the events trail, and processed_at. It
--   locks the webhook_events row first and does nothing for a processed one,
--   so each provider event is processed at most once, even when the provider
--   delivers it twice at the same moment.
-- - Deleting a lead redacts the raw payloads routed to it (client lead data
--   is deleted on request) but keeps the rows, so a late provider retry of the
--   same event is still recognised as processed and does not recreate the lead.

-- webhook_events ----------------------------------------------------------------
alter table public.webhook_events
  add column kind text check (kind in ('inbound', 'echo', 'status', 'invalid')),
  add column org_id uuid references public.orgs (id) on delete cascade,
  -- No foreign key: the before-delete trigger on leads clears it and redacts
  -- the payload (a foreign key's own action would run first and hide the rows).
  add column lead_id uuid,
  add column attempts integer not null default 0 check (attempts >= 0),
  add column processing_error text,
  add column result jsonb;

comment on column public.webhook_events.attempts is
  'Processing attempts. The webhook stops asking the provider to redeliver after 3 (whatsapp-webhook/index.ts).';
comment on column public.webhook_events.processing_error is
  'Why the last processing attempt failed; null once processed.';

create index webhook_events_unprocessed_idx on public.webhook_events (received_at) where processed_at is null;
create index webhook_events_org_id_idx on public.webhook_events (org_id);
create index webhook_events_lead_id_idx on public.webhook_events (lead_id);

create function private.redact_lead_webhook_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.webhook_events w
     set payload = jsonb_build_object('redacted', true),
         result = null,
         lead_id = null
   where w.lead_id = old.id
     -- When the whole org is being deleted its webhook events go with it;
     -- updating them here would trip their org foreign key.
     and exists (select 1 from public.orgs o where o.id = w.org_id);
  return old;
end;
$$;
revoke execute on function private.redact_lead_webhook_events() from public, anon, authenticated;

create trigger leads_redact_webhook_events
  before delete on public.leads
  for each row execute function private.redact_lead_webhook_events();

-- Status order ----------------------------------------------------------------------
-- A status only moves forward: queued < sent < failed < delivered < read.
-- `failed` replaces queued or sent; a delivered or read receipt is proof the
-- message arrived and wins over an earlier failed. Nothing moves back.
create function private.message_status_rank(p_status text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'queued' then 0
    when 'sent' then 1
    when 'failed' then 2
    when 'delivered' then 3
    when 'read' then 4
  end;
$$;
revoke execute on function private.message_status_rank(text) from public, anon, authenticated;

-- process_whatsapp_event ---------------------------------------------------------
-- p_event (built by whatsapp-webhook/index.ts from a NormalizedEvent):
--   { kind: 'inbound' | 'echo' | 'status', phone, text, at, provider_message_id,
--     status, error, profile_name, opt_out }
-- p_source_id: the org's whatsapp_inbound source the delivery was routed to.
--
-- inbound  The lead is found by (org, phone), or created from the source with
--          consent_at = last_enquiry_at = the inbound time (the person wrote
--          first). Stores an inbound session message, moves last_inbound_at
--          forward, and either records an opt-out (STOP/UNSUBSCRIBE: sets
--          opted_out_at, cancels follow-ups) or cancels queued follow-ups.
-- echo     Staff replied from the WhatsApp Business app. For a known lead:
--          stores an echo message, sets first_human_reply_at if empty, cancels
--          queued follow-ups. An echo to a number that is not a lead is not
--          stored (no consent, nothing to attach it to).
-- status   Moves messages.status forward by (provider, provider_message_id)
--          within the org; `failed` also stores the error.
--
-- Returns { outcome: 'processed' | 'duplicate' | 'ignored', kind, lead_id,
-- created_lead, opted_out, message_id, cancelled_jobs, status_applied, reason }.
-- Raises on an unknown event, a source that is not whatsapp_inbound or a bad
-- event; the caller records the error and the transaction leaves nothing behind.
create function private.process_whatsapp_event(
  p_webhook_event_id bigint,
  p_source_id uuid,
  p_event jsonb,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_row public.webhook_events;
  v_org uuid;
  v_kind text := p_event->>'kind';
  v_phone text := nullif(p_event->>'phone', '');
  v_text text := p_event->>'text';
  v_at timestamptz := (p_event->>'at')::timestamptz;
  v_pmid text := nullif(p_event->>'provider_message_id', '');
  v_status text := p_event->>'status';
  v_opt_out boolean := coalesce((p_event->>'opt_out')::boolean, false);
  v_name text := coalesce(nullif(btrim(p_event->>'profile_name'), ''), 'WhatsApp enquiry');
  v_lead uuid;
  v_created boolean := false;
  v_message uuid;
  v_cancelled uuid[] := '{}';
  v_applied boolean := false;
  v_result jsonb;
begin
  select * into v_row from public.webhook_events w where w.id = p_webhook_event_id for update;
  if not found then
    raise exception 'webhook event % does not exist', p_webhook_event_id using errcode = 'P0002';
  end if;
  if v_row.processed_at is not null then
    return jsonb_build_object('outcome', 'duplicate', 'kind', v_row.kind, 'lead_id', v_row.lead_id);
  end if;

  select s.org_id into v_org from public.sources s where s.id = p_source_id and s.kind = 'whatsapp_inbound';
  if v_org is null then
    raise exception 'source % is not a whatsapp_inbound source', p_source_id using errcode = '22023';
  end if;
  if v_kind is null or v_kind not in ('inbound', 'echo', 'status') then
    raise exception 'unknown event kind %', coalesce(v_kind, 'null') using errcode = '22023';
  end if;
  if v_at is null or v_pmid is null then
    raise exception 'event needs at and provider_message_id' using errcode = '22023';
  end if;

  if v_kind = 'status' then
    if private.message_status_rank(v_status) is null or v_status = 'queued' then
      raise exception 'unknown status %', coalesce(v_status, 'null') using errcode = '22023';
    end if;
    update public.messages m
       set status = v_status,
           error = case when v_status = 'failed' then coalesce(p_event->>'error', 'failed') else m.error end
     where m.org_id = v_org
       and m.provider = v_row.provider
       and m.provider_message_id = v_pmid
       and private.message_status_rank(v_status) > private.message_status_rank(m.status)
    returning m.id, m.lead_id into v_message, v_lead;
    v_applied := found;
    if not v_applied then
      select m.id, m.lead_id into v_message, v_lead
        from public.messages m
       where m.org_id = v_org and m.provider = v_row.provider and m.provider_message_id = v_pmid;
    end if;
    v_result := jsonb_build_object(
      'outcome', case when v_message is null then 'ignored' else 'processed' end,
      'reason', case when v_message is null then 'no message with this provider id'
                     when not v_applied then 'status is not newer than the message''s' end,
      'message_id', v_message, 'status_applied', v_applied);

  elsif v_phone is null then
    v_result := jsonb_build_object('outcome', 'ignored', 'reason', 'phone is not a supported mobile number');

  elsif v_kind = 'inbound' then
    select l.id into v_lead from public.leads l where l.org_id = v_org and l.phone_e164 = v_phone;
    if v_lead is null then
      insert into public.leads (org_id, source_id, name, phone_e164, consent_at, last_enquiry_at, last_inbound_at)
      values (v_org, p_source_id, left(v_name, 200), v_phone, v_at, v_at, v_at)
      on conflict (org_id, phone_e164) do nothing
      returning id into v_lead;
      v_created := v_lead is not null;
      if not v_created then
        -- Created a moment ago by a concurrent delivery for the same number.
        select l.id into v_lead from public.leads l where l.org_id = v_org and l.phone_e164 = v_phone;
      end if;
    end if;

    insert into public.messages (org_id, lead_id, direction, kind, body, provider, provider_message_id, status, sent_at)
    values (v_org, v_lead, 'inbound', 'session', v_text, v_row.provider, v_pmid, 'delivered', v_at)
    on conflict (provider, provider_message_id) where provider_message_id is not null do nothing
    returning id into v_message;

    -- greatest() skips nulls; a late delivery of an older message moves nothing back.
    update public.leads l set last_inbound_at = greatest(l.last_inbound_at, v_at) where l.id = v_lead;

    if v_opt_out then
      v_cancelled := coalesce(private.record_opt_out(v_lead, v_at), '{}');
    else
      select coalesce(array_agg(c), '{}') into v_cancelled
        from private.cancel_followups(v_lead, 'lead replied', v_at) as c;
    end if;

    if v_created then
      insert into public.events (org_id, lead_id, type, payload)
      values (v_org, v_lead, 'lead_created',
              jsonb_build_object('source_id', p_source_id, 'via', 'whatsapp_inbound', 'webhook_event_id', p_webhook_event_id));
    end if;
    insert into public.events (org_id, lead_id, type, payload)
    values (v_org, v_lead, 'inbound_received',
            jsonb_build_object('message_id', v_message, 'webhook_event_id', p_webhook_event_id,
                               'opt_out', v_opt_out, 'cancelled_jobs', to_jsonb(v_cancelled)));
    v_result := jsonb_build_object('outcome', 'processed', 'created_lead', v_created, 'opted_out', v_opt_out,
                                   'message_id', v_message, 'cancelled_jobs', to_jsonb(v_cancelled));

  else -- echo
    select l.id into v_lead from public.leads l where l.org_id = v_org and l.phone_e164 = v_phone;
    if v_lead is null then
      v_result := jsonb_build_object('outcome', 'ignored', 'reason', 'echo to a number that is not a lead');
    else
      insert into public.messages (org_id, lead_id, to_phone, direction, kind, body, provider, provider_message_id, status, sent_at)
      values (v_org, v_lead, v_phone, 'echo', 'session', v_text, v_row.provider, v_pmid, 'sent', v_at)
      on conflict (provider, provider_message_id) where provider_message_id is not null do nothing
      returning id into v_message;

      update public.leads l set first_human_reply_at = coalesce(l.first_human_reply_at, v_at) where l.id = v_lead;
      select coalesce(array_agg(c), '{}') into v_cancelled
        from private.cancel_followups(v_lead, 'staff replied', v_at) as c;

      insert into public.events (org_id, lead_id, type, payload)
      values (v_org, v_lead, 'echo_received',
              jsonb_build_object('message_id', v_message, 'webhook_event_id', p_webhook_event_id,
                                 'cancelled_jobs', to_jsonb(v_cancelled)));
      v_result := jsonb_build_object('outcome', 'processed', 'message_id', v_message,
                                     'cancelled_jobs', to_jsonb(v_cancelled));
    end if;
  end if;

  v_result := jsonb_strip_nulls(v_result || jsonb_build_object('kind', v_kind, 'lead_id', v_lead));
  update public.webhook_events w
     set processed_at = p_as_of,
         org_id = v_org,
         lead_id = v_lead,
         kind = v_kind,
         attempts = w.attempts + 1,
         processing_error = null,
         result = v_result
   where w.id = p_webhook_event_id;
  return v_result;
end;
$$;
revoke execute on function private.process_whatsapp_event(bigint, uuid, jsonb, timestamptz) from public, anon, authenticated;

-- Public wrapper for the Edge Function (service_role only), as with claim_jobs.
create function public.process_whatsapp_event(
  p_webhook_event_id bigint,
  p_source_id uuid,
  p_event jsonb,
  p_as_of timestamptz default now()
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.process_whatsapp_event(p_webhook_event_id, p_source_id, p_event, p_as_of);
$$;
revoke execute on function public.process_whatsapp_event(bigint, uuid, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.process_whatsapp_event(bigint, uuid, jsonb, timestamptz) to service_role;
