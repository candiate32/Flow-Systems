-- Tables, columns, constraints and seed from docs/specs/002-demo-slice.md.
begin;
select plan(46);

select has_schema('private');
select tables_are('public',
  array['orgs', 'org_members', 'sources', 'leads', 'messages', 'events', 'webhook_events',
        'jobs', 'templates', 'audit_log']);

select columns_are('public', 'orgs',
  array['id', 'name', 'slug', 'timezone', 'owner_alert_phones', 'whatsapp_fallback_phone', 'is_demo', 'created_at']);
select columns_are('public', 'org_members', array['org_id', 'user_id', 'role', 'created_at']);
select columns_are('public', 'sources', array['id', 'org_id', 'kind', 'name', 'public_key', 'created_at']);
select columns_are('public', 'leads',
  array['id', 'org_id', 'source_id', 'name', 'phone_e164', 'bhk', 'possession_month', 'consent_at',
        'status', 'last_enquiry_at', 'first_auto_reply_at', 'first_human_reply_at', 'last_inbound_at', 'created_at',
        'details', 'opted_out_at']);
select columns_are('public', 'messages',
  array['id', 'org_id', 'lead_id', 'to_phone', 'direction', 'kind', 'template_name', 'body', 'provider',
        'provider_message_id', 'status', 'error', 'created_at', 'sent_at', 'job_id']);
select columns_are('public', 'events', array['id', 'org_id', 'lead_id', 'type', 'payload', 'created_at']);
select columns_are('public', 'webhook_events',
  array['id', 'provider', 'provider_event_id', 'payload', 'received_at', 'processed_at']);

select col_type_is('public', 'leads', 'consent_at', 'timestamp with time zone', 'col_type_is leads consent_at, timestamp with time zone');
select col_not_null('public', 'leads', 'consent_at', 'col_not_null leads consent_at');
select col_default_is('public', 'leads', 'status', 'new'::text, 'leads.status defaults to new');
-- leads.details (spec 003, bar 6)
select col_type_is('public', 'leads', 'details', 'jsonb', 'col_type_is leads details, jsonb');
select col_not_null('public', 'leads', 'details', 'col_not_null leads details');
select col_default_is('public', 'leads', 'details', '{}'::jsonb, 'leads.details defaults to {}');
select col_default_is('public', 'orgs', 'timezone', 'Asia/Kolkata'::text, 'orgs.timezone defaults to Asia/Kolkata');
select col_type_is('public', 'orgs', 'owner_alert_phones', 'text[]', 'col_type_is orgs owner_alert_phones, text[]');
select col_type_is('public', 'events', 'id', 'bigint', 'col_type_is events id, bigint');
select col_type_is('public', 'events', 'payload', 'jsonb', 'col_type_is events payload, jsonb');

select col_is_pk('public', 'org_members', array['org_id', 'user_id']);
select col_is_unique('public', 'orgs', 'slug', 'col_is_unique orgs slug');
select col_is_unique('public', 'sources', 'public_key', 'col_is_unique sources public_key');
select col_is_unique('public', 'leads', array['org_id', 'phone_e164'], 'col_is_unique leads (org_id, phone_e164)');
select col_is_unique('public', 'webhook_events', array['provider', 'provider_event_id'], 'col_is_unique webhook_events (provider, provider_event_id)');
select index_is_unique('public', 'messages', 'messages_provider_message_id_key');
select has_index('public', 'leads', 'leads_org_id_created_at_idx', 'has_index leads leads_org_id_created_at_idx');
select has_index('public', 'messages', 'messages_lead_id_idx', 'has_index messages messages_lead_id_idx');
select has_index('public', 'events', 'events_org_id_created_at_idx', 'has_index events events_org_id_created_at_idx');
select fk_ok('public', 'leads', 'org_id', 'public', 'orgs', 'id');
select fk_ok('public', 'messages', 'lead_id', 'public', 'leads', 'id');

select has_function('private', 'is_org_member', array['uuid']);
select is_definer('private', 'is_org_member', array['uuid']);

-- check constraints (as postgres, RLS bypassed)
insert into public.orgs (id, name, slug) values ('10000000-0000-4000-8000-000000000001', 'Check Org', 'check-org');
select throws_ok(
  $$ insert into public.leads (org_id, name, phone_e164, consent_at, status)
     values ('10000000-0000-4000-8000-000000000001', 'X', '+919811111111', now(), 'bogus') $$,
  '23514', null, 'leads.status rejects unknown values');
select lives_ok(
  $$ insert into public.leads (org_id, name, phone_e164, consent_at)
     values ('10000000-0000-4000-8000-000000000001', 'X', '+919811111111', now()) $$,
  'leads insert with defaults works');
select throws_ok(
  $$ insert into public.leads (org_id, name, phone_e164, consent_at)
     values ('10000000-0000-4000-8000-000000000001', 'Y', '+919811111111', now()) $$,
  '23505', null, 'leads (org_id, phone_e164) is unique');
select is((select details from public.leads where phone_e164 = '+919811111111'), '{}'::jsonb,
  'a lead inserted without details gets {}');
select throws_ok(
  $$ insert into public.leads (org_id, name, phone_e164, consent_at, details)
     values ('10000000-0000-4000-8000-000000000001', 'Z', '+919811111112', now(), '["budget"]') $$,
  '23514', null, 'leads.details rejects a JSON array');
select throws_ok(
  $$ insert into public.leads (org_id, name, phone_e164, consent_at, details)
     values ('10000000-0000-4000-8000-000000000001', 'Z', '+919811111112', now(), '"budget"') $$,
  '23514', null, 'leads.details rejects a JSON string');
select throws_ok(
  $$ insert into public.messages (org_id, direction, kind, provider)
     values ('10000000-0000-4000-8000-000000000001', 'sideways', 'template', 'fake') $$,
  '23514', null, 'messages.direction rejects unknown values');
select throws_ok(
  $$ insert into public.messages (org_id, direction, kind, provider)
     values ('10000000-0000-4000-8000-000000000001', 'outbound', 'sms', 'fake') $$,
  '23514', null, 'messages.kind rejects unknown values');
select throws_ok(
  $$ insert into public.messages (org_id, direction, kind, provider, status)
     values ('10000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', 'lost') $$,
  '23514', null, 'messages.status rejects unknown values');
select throws_ok(
  $$ insert into public.sources (org_id, kind, name, public_key)
     values ('10000000-0000-4000-8000-000000000001', 'email', 'x', 'x-key') $$,
  '23514', null, 'sources.kind rejects unknown values');
select lives_ok(
  $$ insert into public.messages (org_id, direction, kind, provider, provider_message_id)
     values ('10000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', null),
            ('10000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', null) $$,
  'several messages may have a null provider_message_id');
select throws_ok(
  $$ insert into public.messages (org_id, direction, kind, provider, provider_message_id)
     values ('10000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', 'fake-1'),
            ('10000000-0000-4000-8000-000000000001', 'outbound', 'template', 'fake', 'fake-1') $$,
  '23505', null, '(provider, provider_message_id) is unique when set');

-- seed
select results_eq(
  $$ select name, slug, is_demo, owner_alert_phones, whatsapp_fallback_phone
       from public.orgs where id = '00000000-0000-4000-8000-000000000001' $$,
  $$ values ('Demo Interiors, Sarjapur Road'::text, 'demo-interiors'::text, true,
             array['+919000000001']::text[], '+919000000001'::text) $$,
  'seed creates the demo org');
select results_eq(
  $$ select org_id, kind from public.sources where public_key = 'demo-web-form' $$,
  $$ values ('00000000-0000-4000-8000-000000000001'::uuid, 'web_form'::text) $$,
  'seed creates the demo web_form source');

select * from finish();
rollback;
