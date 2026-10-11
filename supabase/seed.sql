-- Demo client for sales meetings (docs/specs/002-demo-slice.md). Clearly a demo.
-- Fixed UUIDs so tests and local tooling can reference them.
insert into public.orgs (id, name, slug, is_demo, owner_alert_phones, whatsapp_fallback_phone)
values (
  '00000000-0000-4000-8000-000000000001',
  'Lime & Lattice, Sarjapur Road',
  'demo-interiors',
  true,
  array['+919000000001'],
  '+919000000001'
);

insert into public.sources (id, org_id, kind, name, public_key)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'web_form',
  'Demo landing page form',
  'demo-web-form'
);

-- The demo studio's WhatsApp number. Its provider webhook URL is
-- .../functions/v1/whatsapp-webhook?source=demo-whatsapp-inbound (spec 004, C.4).
insert into public.sources (id, org_id, kind, name, public_key)
values (
  '00000000-0000-4000-8000-000000000102',
  '00000000-0000-4000-8000-000000000001',
  'whatsapp_inbound',
  'Demo WhatsApp number',
  'demo-whatsapp-inbound'
);
