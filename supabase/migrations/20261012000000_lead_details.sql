-- Spec 003, bar 6: answers to a studio form's custom questions.
-- Shape is validated in ingest-form (_shared/enquiry.ts: at most 10 keys matching
-- ^[a-z][a-z0-9_]{0,31}$, string values of at most 200 characters); the database
-- only guarantees it is a JSON object. Existing rows get '{}'.
alter table public.leads
  add column details jsonb not null default '{}'::jsonb
    constraint leads_details_is_object check (jsonb_typeof(details) = 'object');

comment on column public.leads.details is
  'Custom question answers from the enquiry form, keyed by field key (spec 003).';
