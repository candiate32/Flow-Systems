-- Spec 004, slice C: webhook_events additions, process_whatsapp_event and the
-- lead-delete redaction (supabase/migrations/20261015120000_whatsapp_webhook.sql).
begin;
select plan(96);

-- Schema and privileges -------------------------------------------------------
select has_function('private', 'process_whatsapp_event', array['bigint', 'uuid', 'jsonb', 'timestamp with time zone']);
select is_definer('public', 'process_whatsapp_event', array['bigint', 'uuid', 'jsonb', 'timestamp with time zone']);
select function_privs_are('public', 'process_whatsapp_event', array['bigint', 'uuid', 'jsonb', 'timestamp with time zone'], 'anon', '{}');
select function_privs_are('public', 'process_whatsapp_event', array['bigint', 'uuid', 'jsonb', 'timestamp with time zone'], 'authenticated', '{}');
select function_privs_are('public', 'process_whatsapp_event', array['bigint', 'uuid', 'jsonb', 'timestamp with time zone'], 'service_role', array['EXECUTE']);
select function_privs_are('private', 'process_whatsapp_event', array['bigint', 'uuid', 'jsonb', 'timestamp with time zone'], 'service_role', '{}');
select col_default_is('public', 'webhook_events', 'attempts', 0, 'webhook_events.attempts defaults to 0');
select has_trigger('public', 'leads', 'leads_redact_webhook_events', 'leads redact their webhook payloads on delete');
select results_eq(
  $$ select org_id, kind from public.sources where public_key = 'demo-whatsapp-inbound' $$,
  $$ values ('00000000-0000-4000-8000-000000000001'::uuid, 'whatsapp_inbound'::text) $$,
  'seed creates the demo whatsapp_inbound source');

-- Fixtures (as postgres, RLS bypassed) ------------------------------------------
insert into public.orgs (id, name, slug)
values ('40000000-0000-4000-8000-000000000001', 'Webhook Org', 'webhook-org'),
       ('40000000-0000-4000-8000-000000000002', 'Other Org', 'webhook-other-org');
insert into public.sources (id, org_id, kind, name, public_key)
values ('40000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-000000000001', 'whatsapp_inbound', 'WA', 'wh-test-wa'),
       ('40000000-0000-4000-8000-0000000000a2', '40000000-0000-4000-8000-000000000001', 'web_form', 'Form', 'wh-test-form'),
       ('40000000-0000-4000-8000-0000000000a3', '40000000-0000-4000-8000-000000000002', 'whatsapp_inbound', 'WA B', 'wh-test-wa-b');
-- A form lead with three queued follow-ups.
insert into public.leads (id, org_id, name, phone_e164, consent_at, last_enquiry_at)
values ('40000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-000000000001', 'Form Lead', '+919811120001',
        '2030-01-01T05:00:00Z', '2030-01-01T05:00:00Z');
insert into public.jobs (org_id, lead_id, kind, run_at, idempotency_key, payload)
select '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-0000000000b1', 'followup',
       '2030-01-02T05:30:00Z'::timestamptz + (n || ' days')::interval, 'wh-f-' || n, jsonb_build_object('n', n)
  from generate_series(1, 3) n;
-- An outbound message to it, for status events.
insert into public.messages (id, org_id, lead_id, to_phone, direction, kind, template_name, provider, provider_message_id, status)
values ('40000000-0000-4000-8000-0000000000c1', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-0000000000b1',
        '+919811120001', 'outbound', 'template', 'enquiry_ack', 'fake', 'wh-out-1', 'sent'),
       ('40000000-0000-4000-8000-0000000000c2', '40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-0000000000b1',
        '+919811120001', 'outbound', 'template', 'followup_1', 'fake', 'wh-out-2', 'sent');

insert into public.webhook_events (id, provider, provider_event_id, payload)
overriding system value
values (900001, 'fake', 'wh-e-new', '{"phone":"+919811120002"}'),
       (900002, 'fake', 'wh-e-known', '{}'),
       (900003, 'fake', 'wh-e-known-old', '{}'),
       (900004, 'fake', 'wh-e-echo', '{}'),
       (900005, 'fake', 'wh-e-echo-2', '{}'),
       (900006, 'fake', 'wh-e-echo-unknown', '{}'),
       (900007, 'fake', 'wh-e-delivered', '{}'),
       (900008, 'fake', 'wh-e-read', '{}'),
       (900009, 'fake', 'wh-e-delivered-late', '{}'),
       (900010, 'fake', 'wh-e-failed-2', '{}'),
       (900011, 'fake', 'wh-e-delivered-2', '{}'),
       (900012, 'fake', 'wh-e-failed-late', '{}'),
       (900013, 'fake', 'wh-e-status-unknown', '{}'),
       (900014, 'fake', 'wh-e-status-other-org', '{}'),
       (900015, 'fake', 'wh-e-stop', '{}'),
       (900016, 'fake', 'wh-e-no-phone', '{}'),
       (900017, 'fake', 'wh-e-bad', '{}');

-- Inbound from an unknown number ---------------------------------------------------
select is(
  public.process_whatsapp_event(900001, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120002","text":"Hi, need a quote","at":"2030-01-05T06:00:00Z",
      "provider_message_id":"wh-in-1","profile_name":"Ravi Kumar","opt_out":false}', '2030-01-05T06:00:01Z')
    - 'lead_id' - 'message_id',
  '{"outcome":"processed","kind":"inbound","created_lead":true,"opted_out":false,"cancelled_jobs":[]}'::jsonb,
  'an inbound from an unknown number creates a lead');
select results_eq(
  $$ select name, source_id::text, consent_at, last_enquiry_at, last_inbound_at, first_auto_reply_at
       from public.leads where org_id = '40000000-0000-4000-8000-000000000001' and phone_e164 = '+919811120002' $$,
  $$ values ('Ravi Kumar'::text, '40000000-0000-4000-8000-0000000000a1'::text, '2030-01-05T06:00:00Z'::timestamptz,
             '2030-01-05T06:00:00Z'::timestamptz, '2030-01-05T06:00:00Z'::timestamptz, null::timestamptz) $$,
  'from the whatsapp_inbound source, with consent, enquiry and inbound at the message time');
select results_eq(
  $$ select direction, kind, body, provider, status, sent_at from public.messages where provider_message_id = 'wh-in-1' $$,
  $$ values ('inbound'::text, 'session'::text, 'Hi, need a quote'::text, 'fake'::text, 'delivered'::text, '2030-01-05T06:00:00Z'::timestamptz) $$,
  'and stores an inbound session message');
select results_eq(
  $$ select type from public.events e join public.leads l on l.id = e.lead_id
      where l.phone_e164 = '+919811120002' and l.org_id = '40000000-0000-4000-8000-000000000001' order by e.id $$,
  $$ values ('lead_created'::text), ('inbound_received'::text) $$,
  'and logs lead_created and inbound_received');
select results_eq(
  $$ select processed_at, kind, org_id::text, attempts, processing_error, lead_id = (select id from public.leads where phone_e164 = '+919811120002')
       from public.webhook_events where id = 900001 $$,
  $$ values ('2030-01-05T06:00:01Z'::timestamptz, 'inbound'::text, '40000000-0000-4000-8000-000000000001'::text, 1, null::text, true) $$,
  'and marks the webhook event processed, routed to the org and lead');

-- Replay ------------------------------------------------------------------------
select is(
  public.process_whatsapp_event(900001, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120002","text":"Hi, need a quote","at":"2030-01-05T06:00:00Z",
      "provider_message_id":"wh-in-1","opt_out":false}', '2030-01-05T07:00:00Z')->>'outcome',
  'duplicate', 'processing the same event again is a duplicate');
select is((select count(*)::int from public.messages where provider_message_id = 'wh-in-1'), 1, 'and stores no second message');
select is((select count(*)::int from public.leads where phone_e164 = '+919811120002'), 1, 'and creates no second lead');
select is((select processed_at from public.webhook_events where id = 900001), '2030-01-05T06:00:01Z'::timestamptz,
  'and leaves the event as it was');

-- Inbound from a known lead -----------------------------------------------------------
select is(
  public.process_whatsapp_event(900002, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120001","text":"Yes please call","at":"2030-01-01T09:00:00Z",
      "provider_message_id":"wh-in-2","opt_out":false}')->'created_lead',
  'false'::jsonb, 'an inbound from a known lead creates no lead');
select is((select last_inbound_at from public.leads where id = '40000000-0000-4000-8000-0000000000b1'),
  '2030-01-01T09:00:00Z'::timestamptz, 'and sets last_inbound_at');
select is((select count(*)::int from public.jobs where lead_id = '40000000-0000-4000-8000-0000000000b1' and status = 'cancelled'), 3,
  'and cancels the queued follow-ups');
select is((select count(*)::int from public.events where lead_id = '40000000-0000-4000-8000-0000000000b1'
             and type = 'job_cancelled' and payload->>'reason' = 'lead replied'), 3,
  'saying the lead replied');
select is((select direction || '/' || kind from public.messages where provider_message_id = 'wh-in-2'), 'inbound/session',
  'and stores an inbound session message');
select ok(public.process_whatsapp_event(900003, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120001","text":"older","at":"2030-01-01T08:00:00Z","provider_message_id":"wh-in-0"}')
    ->>'outcome' = 'processed', 'a late delivery of an older inbound is processed');
select is((select last_inbound_at from public.leads where id = '40000000-0000-4000-8000-0000000000b1'),
  '2030-01-01T09:00:00Z'::timestamptz, 'but does not move last_inbound_at back');

-- Echo --------------------------------------------------------------------------------
update public.jobs set status = 'queued' where idempotency_key like 'wh-f-%';
select is(
  public.process_whatsapp_event(900004, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"echo","phone":"+919811120001","text":"Sure, calling at 4","at":"2030-01-01T10:00:00Z","provider_message_id":"wh-echo-1"}')
    ->'cancelled_jobs' ->> 0 is not null,
  true, 'an echo cancels queued follow-ups');
select is((select first_human_reply_at from public.leads where id = '40000000-0000-4000-8000-0000000000b1'),
  '2030-01-01T10:00:00Z'::timestamptz, 'and sets first_human_reply_at');
select is((select count(*)::int from public.jobs where lead_id = '40000000-0000-4000-8000-0000000000b1' and status = 'queued'), 0,
  'leaving nothing queued');
select results_eq(
  $$ select direction, kind, to_phone, body, status from public.messages where provider_message_id = 'wh-echo-1' $$,
  $$ values ('echo'::text, 'session'::text, '+919811120001'::text, 'Sure, calling at 4'::text, 'sent'::text) $$,
  'and stores an echo message');
select is((select count(*)::int from public.events where type = 'job_cancelled' and payload->>'reason' = 'staff replied'), 3,
  'the cancel events say staff replied');
select ok(public.process_whatsapp_event(900005, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"echo","phone":"+919811120001","text":"Again","at":"2030-01-01T11:00:00Z","provider_message_id":"wh-echo-2"}')
    ->>'outcome' = 'processed', 'a second echo is processed');
select is((select first_human_reply_at from public.leads where id = '40000000-0000-4000-8000-0000000000b1'),
  '2030-01-01T10:00:00Z'::timestamptz, 'but keeps the first human reply time');
select is((select last_human_reply_at from public.leads where id = '40000000-0000-4000-8000-0000000000b1'),
  '2030-01-01T11:00:00Z'::timestamptz, 'and moves last_human_reply_at to the latest echo');
insert into public.webhook_events (id, provider, provider_event_id, payload) overriding system value
values (900018, 'fake', 'wh-e-echo-old', '{}');
select ok(public.process_whatsapp_event(900018, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"echo","phone":"+919811120001","text":"older","at":"2030-01-01T09:30:00Z","provider_message_id":"wh-echo-old"}')
    ->>'outcome' = 'processed', 'a late delivery of an older echo is processed');
select results_eq(
  $$ select first_human_reply_at, last_human_reply_at from public.leads where id = '40000000-0000-4000-8000-0000000000b1' $$,
  $$ values ('2030-01-01T10:00:00Z'::timestamptz, '2030-01-01T11:00:00Z'::timestamptz) $$,
  'but moves neither reply time back');
select is(
  public.process_whatsapp_event(900006, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"echo","phone":"+919811129999","text":"Hi","at":"2030-01-01T11:00:00Z","provider_message_id":"wh-echo-3"}')->>'outcome',
  'ignored', 'an echo to a number that is not a lead is ignored');
select is((select count(*)::int from public.messages where provider_message_id = 'wh-echo-3'), 0, 'and not stored');
select isnt((select processed_at from public.webhook_events where id = 900006), null, 'but its event is processed');

-- Status ------------------------------------------------------------------------------
select is(
  public.process_whatsapp_event(900007, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"status","status":"delivered","at":"2030-01-01T05:01:00Z","provider_message_id":"wh-out-1"}')->'status_applied',
  'true'::jsonb, 'sent -> delivered is applied');
select is((select status from public.messages where id = '40000000-0000-4000-8000-0000000000c1'), 'delivered', 'status is delivered');
select is(
  public.process_whatsapp_event(900008, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"status","status":"read","at":"2030-01-01T05:03:00Z","provider_message_id":"wh-out-1"}')->'status_applied',
  'true'::jsonb, 'delivered -> read is applied');
select is(
  public.process_whatsapp_event(900009, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"status","status":"delivered","at":"2030-01-01T05:02:00Z","provider_message_id":"wh-out-1"}')->'status_applied',
  'false'::jsonb, 'a delivered arriving after read is not applied');
select is((select status from public.messages where id = '40000000-0000-4000-8000-0000000000c1'), 'read', 'status stays read');
select is((select processed_at is not null from public.webhook_events where id = 900009), true, 'the stale status event is still processed');
select is(
  public.process_whatsapp_event(900010, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"status","status":"failed","error":"131047 Re-engagement message","at":"2030-01-01T05:01:00Z","provider_message_id":"wh-out-2"}')->'status_applied',
  'true'::jsonb, 'sent -> failed is applied');
select results_eq($$ select status, error from public.messages where id = '40000000-0000-4000-8000-0000000000c2' $$,
  $$ values ('failed'::text, '131047 Re-engagement message'::text) $$, 'with its error');
select is(
  public.process_whatsapp_event(900011, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"status","status":"delivered","at":"2030-01-01T05:02:00Z","provider_message_id":"wh-out-2"}')->'status_applied',
  'true'::jsonb, 'a delivered receipt after failed is applied (proof of delivery)');
select results_eq($$ select status, error from public.messages where id = '40000000-0000-4000-8000-0000000000c2' $$,
  $$ values ('delivered'::text, null::text) $$, 'and clears the failure''s error');
select is(
  public.process_whatsapp_event(900012, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"status","status":"failed","error":"late","at":"2030-01-01T05:03:00Z","provider_message_id":"wh-out-2"}')->'status_applied',
  'false'::jsonb, 'failed after delivered is not applied');
select is((select status from public.messages where id = '40000000-0000-4000-8000-0000000000c2'), 'delivered', 'status stays delivered');
select is(
  public.process_whatsapp_event(900013, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"status","status":"read","at":"2030-01-01T05:03:00Z","provider_message_id":"wh-nope"}')->>'outcome',
  'ignored', 'a status for an unknown message is ignored');
select is(
  public.process_whatsapp_event(900014, '40000000-0000-4000-8000-0000000000a3',
    '{"kind":"status","status":"failed","at":"2030-01-01T05:03:00Z","provider_message_id":"wh-out-1"}')->>'outcome',
  'ignored', 'a status routed through another org''s number does not touch this org''s message');
select is((select status from public.messages where id = '40000000-0000-4000-8000-0000000000c1'), 'read', 'which stays read');

-- Opt-out -----------------------------------------------------------------------------
update public.jobs set status = 'queued' where idempotency_key like 'wh-f-%';
select is(
  public.process_whatsapp_event(900015, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120001","text":"STOP","at":"2030-01-02T09:00:00Z","provider_message_id":"wh-in-stop","opt_out":true}')
    ->'opted_out',
  'true'::jsonb, 'an opt-out inbound is recorded as an opt-out');
select is((select opted_out_at from public.leads where id = '40000000-0000-4000-8000-0000000000b1'),
  '2030-01-02T09:00:00Z'::timestamptz, 'which sets opted_out_at');
select is((select count(*)::int from public.jobs where lead_id = '40000000-0000-4000-8000-0000000000b1' and status = 'queued'), 0,
  'and cancels the queued follow-ups');
select is((select count(*)::int from public.events where lead_id = '40000000-0000-4000-8000-0000000000b1' and type = 'lead_opted_out'), 1,
  'and logs lead_opted_out');
select is((select body from public.messages where provider_message_id = 'wh-in-stop'), 'STOP', 'the STOP message itself is stored');

-- Bad input ---------------------------------------------------------------------------
select is(
  public.process_whatsapp_event(900016, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":null,"text":"hi","at":"2030-01-02T09:00:00Z","provider_message_id":"wh-in-us"}')->>'outcome',
  'ignored', 'an inbound from a number that is not an Indian mobile is ignored');
select is((select count(*)::int from public.messages where provider_message_id = 'wh-in-us'), 0, 'and nothing is stored for it');
select throws_ok(
  $$ select public.process_whatsapp_event(900017, '40000000-0000-4000-8000-0000000000a2',
       '{"kind":"inbound","phone":"+919811120003","text":"hi","at":"2030-01-02T09:00:00Z","provider_message_id":"wh-in-3"}') $$,
  '22023', null, 'a web_form source cannot receive WhatsApp events');
select throws_ok(
  $$ select public.process_whatsapp_event(900017, '40000000-0000-4000-8000-0000000000a1',
       '{"kind":"reaction","phone":"+919811120003","at":"2030-01-02T09:00:00Z","provider_message_id":"wh-in-3"}') $$,
  '22023', null, 'an unknown kind raises');
select throws_ok(
  $$ select public.process_whatsapp_event(900017, '40000000-0000-4000-8000-0000000000a1',
       '{"kind":"status","status":"queued","at":"2030-01-02T09:00:00Z","provider_message_id":"wh-out-1"}') $$,
  '22023', null, 'an unknown status raises');
select throws_ok(
  $$ select public.process_whatsapp_event(1, '40000000-0000-4000-8000-0000000000a1', '{"kind":"inbound"}') $$,
  'P0002', null, 'an unknown webhook event raises');
select is((select processed_at from public.webhook_events where id = 900017), null, 'a failed call leaves the event unprocessed');

-- record_webhook_failure -------------------------------------------------------------
select is(public.record_webhook_failure(900017, 'boom 1', '40000000-0000-4000-8000-000000000001'), 1,
  'record_webhook_failure counts the first failed attempt');
select is(public.record_webhook_failure(900017, 'boom 2'), 2, 'and the next, in SQL');
select results_eq($$ select attempts, processing_error, org_id::text, processed_at from public.webhook_events where id = 900017 $$,
  $$ values (2, 'boom 2'::text, '40000000-0000-4000-8000-000000000001'::text, null::timestamptz) $$,
  'keeping the last error and the org, and leaving it unprocessed');
select is(public.record_webhook_failure(900001, 'late'), null, 'a processed event is not counted as failed');
select function_privs_are('public', 'record_webhook_failure', array['bigint', 'text', 'uuid'], 'anon', '{}');
select function_privs_are('public', 'record_webhook_failure', array['bigint', 'text', 'uuid'], 'authenticated', '{}');
select function_privs_are('public', 'record_webhook_failure', array['bigint', 'text', 'uuid'], 'service_role', array['EXECUTE']);

-- Deleting a lead redacts its webhook payloads ---------------------------------------
-- Rows with the lead's phone that were never tied to it: a dead letter in its
-- org, an unrouted delivery, and (to keep) one in another org.
insert into public.webhook_events (id, provider, provider_event_id, kind, phone, org_id, payload, processing_error)
overriding system value
values (900021, 'fake', 'wh-e-dead', 'inbound', '+919811120002', '40000000-0000-4000-8000-000000000001',
        '{"phone":"+919811120002","text":"secret"}', 'boom'),
       (900022, 'fake', 'wh-e-unrouted', 'inbound', '+919811120002', null,
        '{"phone":"+919811120002","text":"secret"}', 'unknown source'),
       (900023, 'fake', 'wh-e-other-org', 'inbound', '+919811120002', '40000000-0000-4000-8000-000000000002',
        '{"phone":"+919811120002","text":"theirs"}', null);
delete from public.leads where org_id = '40000000-0000-4000-8000-000000000001' and phone_e164 = '+919811120002';
select results_eq(
  $$ select id, payload, phone from public.webhook_events where id in (900021, 900022, 900023) order by id $$,
  $$ values (900021::bigint, '{"redacted": true}'::jsonb, null::text),
            (900022::bigint, '{"redacted": true}'::jsonb, null::text),
            (900023::bigint, '{"phone":"+919811120002","text":"theirs"}'::jsonb, '+919811120002'::text) $$,
  'deleting a lead also redacts rows with its phone in its org or unrouted, not another org''s');
select results_eq(
  $$ select id, processed_at is not null, result->>'outcome', processing_error from public.webhook_events
      where id in (900021, 900022, 900023) order by id $$,
  $$ values (900021::bigint, true, 'deleted'::text, null::text),
            (900022::bigint, true, 'deleted'::text, null::text),
            (900023::bigint, false, null::text, null::text) $$,
  'and closes the unprocessed ones as processed with outcome deleted');
select is(
  public.process_whatsapp_event(900022, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120002","text":"secret","at":"2030-01-05T07:00:00Z","provider_message_id":"wh-in-unrouted"}')->>'outcome',
  'duplicate', 'so the provider''s retry of an unrouted event, now routed, is a duplicate');
select is(
  public.process_whatsapp_event(900021, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120002","text":"secret","at":"2030-01-05T07:00:00Z","provider_message_id":"wh-in-dead"}')->>'outcome',
  'duplicate', 'and so is the retry of one that had failed');
select results_eq($$ select payload, lead_id, result, processed_at is not null from public.webhook_events where id = 900001 $$,
  $$ values ('{"redacted": true}'::jsonb, null::uuid, null::jsonb, true) $$,
  'deleting a lead redacts its webhook payload but keeps the processed row');
select is(
  public.process_whatsapp_event(900001, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120002","text":"Hi","at":"2030-01-05T06:00:00Z","provider_message_id":"wh-in-1"}')->>'outcome',
  'duplicate', 'so a late provider retry does not recreate the deleted lead');
select is((select count(*)::int from public.leads where phone_e164 = '+919811120002'), 0, 'which stays deleted');

-- Late delivery of an old message vs a newer enquiry ---------------------------------------
-- Lead C enquired on 2030-02-01 and again on 2030-02-10; each enquiry has its
-- queued follow-ups. Messages stamped between the two only answer the first.
insert into public.leads (id, org_id, name, phone_e164, consent_at, last_enquiry_at, created_at)
values ('40000000-0000-4000-8000-0000000000b3', '40000000-0000-4000-8000-000000000001', 'Late Lead', '+919811120007',
        '2030-02-10T05:00:00Z', '2030-02-10T05:00:00Z', '2030-02-01T05:00:00Z');
insert into public.jobs (org_id, lead_id, kind, run_at, idempotency_key, payload)
values ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-0000000000b3', 'followup', '2030-02-02T05:30:00Z',
        'wh-late-old', '{"n":1,"enquiry_at":"2030-02-01T05:00:00.000Z"}'),
       ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-0000000000b3', 'followup', '2030-02-11T05:30:00Z',
        'wh-late-new-1', '{"n":1,"enquiry_at":"2030-02-10T05:00:00.000Z"}'),
       ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-0000000000b3', 'followup', '2030-02-13T05:30:00Z',
        'wh-late-new-2', '{"n":2,"enquiry_at":"2030-02-10T05:00:00.000Z"}');
insert into public.webhook_events (id, provider, provider_event_id, payload) overriding system value
values (900031, 'fake', 'wh-e-late-echo', '{}'), (900032, 'fake', 'wh-e-late-in', '{}'),
       (900033, 'fake', 'wh-e-pre-echo', '{}'), (900034, 'fake', 'wh-e-new-echo', '{}');

select is(
  public.process_whatsapp_event(900031, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"echo","phone":"+919811120007","text":"old reply","at":"2030-02-05T05:00:00Z","provider_message_id":"wh-late-echo"}')
    ->'cancelled_jobs',
  (select jsonb_agg(id) from public.jobs where idempotency_key = 'wh-late-old'),
  'an echo stamped before the newer enquiry cancels only the older enquiry''s follow-ups');
select results_eq(
  $$ select idempotency_key, status from public.jobs where lead_id = '40000000-0000-4000-8000-0000000000b3' order by idempotency_key $$,
  $$ values ('wh-late-new-1'::text, 'queued'::text), ('wh-late-new-2'::text, 'queued'::text), ('wh-late-old'::text, 'cancelled'::text) $$,
  'the newer enquiry''s follow-ups stay queued');
select is(
  public.process_whatsapp_event(900032, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"inbound","phone":"+919811120007","text":"old message","at":"2030-02-06T05:00:00Z","provider_message_id":"wh-late-in"}')
    ->'cancelled_jobs',
  '[]'::jsonb, 'an inbound stamped before the newer enquiry does not cancel its follow-ups either');
select is((select count(*)::int from public.jobs where lead_id = '40000000-0000-4000-8000-0000000000b3' and status = 'queued'), 2,
  'still two queued');
select is(
  public.process_whatsapp_event(900033, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"echo","phone":"+919811120007","text":"before any enquiry","at":"2030-01-20T05:00:00Z","provider_message_id":"wh-pre-echo"}')
    ->>'outcome',
  'processed', 'an echo from before the lead''s first enquiry is stored');
select results_eq(
  $$ select first_human_reply_at, last_human_reply_at from public.leads where id = '40000000-0000-4000-8000-0000000000b3' $$,
  $$ values ('2030-02-05T05:00:00Z'::timestamptz, '2030-02-05T05:00:00Z'::timestamptz) $$,
  'but sets no reply time (the earlier late echo after the first enquiry did)');
select is(
  public.process_whatsapp_event(900034, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"echo","phone":"+919811120007","text":"new reply","at":"2030-02-10T06:00:00Z","provider_message_id":"wh-new-echo"}')
    ->'cancelled_jobs',
  (select jsonb_agg(id order by idempotency_key) from public.jobs where idempotency_key like 'wh-late-new-%'),
  'an echo after the newer enquiry cancels its follow-ups');

-- An echo before a lead's first enquiry leaves first_human_reply_at empty.
insert into public.leads (id, org_id, name, phone_e164, consent_at, last_enquiry_at, created_at)
values ('40000000-0000-4000-8000-0000000000b4', '40000000-0000-4000-8000-000000000001', 'New Lead', '+919811120008',
        '2030-03-01T05:00:00Z', '2030-03-01T05:00:00Z', '2030-03-01T05:00:00Z');
insert into public.webhook_events (id, provider, provider_event_id, payload) overriding system value
values (900035, 'fake', 'wh-e-before-lead', '{}');
select ok(public.process_whatsapp_event(900035, '40000000-0000-4000-8000-0000000000a1',
    '{"kind":"echo","phone":"+919811120008","text":"hello","at":"2030-02-20T05:00:00Z","provider_message_id":"wh-before-lead"}')
    ->>'outcome' = 'processed', 'an echo from before a lead existed is processed');
select results_eq(
  $$ select first_human_reply_at, last_human_reply_at from public.leads where id = '40000000-0000-4000-8000-0000000000b4' $$,
  $$ values (null::timestamptz, null::timestamptz) $$,
  'and leaves both reply times empty, so no negative reply time');

-- webhook_events is service-role only ----------------------------------------------------
insert into auth.users (id, aud, role, email)
values ('40000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', 'wh-a@example.test');
insert into public.org_members (org_id, user_id, role)
values ('40000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-00000000000a', 'owner');

set local role authenticated;
set local request.jwt.claims = '{"sub": "40000000-0000-4000-8000-00000000000a", "role": "authenticated"}';
select throws_ok($$ select * from public.webhook_events $$, '42501', null,
  'a member cannot read webhook_events, even its own org''s');
select throws_ok($$ update public.webhook_events set processed_at = null $$, '42501', null,
  'a member cannot change webhook_events');
select throws_ok(
  $$ select public.process_whatsapp_event(900017, '40000000-0000-4000-8000-0000000000a1', '{}') $$,
  '42501', null, 'a member cannot call process_whatsapp_event');
select is((select count(*)::int from public.messages where org_id = '40000000-0000-4000-8000-000000000002'), 0,
  'a member of the webhook org sees no other org''s messages');
reset role;

set local role anon;
select throws_ok($$ select * from public.webhook_events $$, '42501', null, 'anon cannot read webhook_events');
select throws_ok(
  $$ select public.process_whatsapp_event(900017, '40000000-0000-4000-8000-0000000000a1', '{}') $$,
  '42501', null, 'anon cannot call process_whatsapp_event');
reset role;

-- Deleting an org (cascading its leads through the redaction trigger) works ----------------
delete from public.orgs where id = '40000000-0000-4000-8000-000000000001';
select is((select count(*)::int from public.webhook_events where org_id = '40000000-0000-4000-8000-000000000001'), 0,
  'deleting an org removes its webhook events');
select is((select count(*)::int from public.leads where org_id = '40000000-0000-4000-8000-000000000001'), 0,
  'and its leads');

select * from finish();
rollback;
