-- Core schema for the Phase 1 demo slice (docs/specs/002-demo-slice.md, "Data model").
-- Writes happen only from Edge Functions with the service role, so tables get
-- select policies for org members and no insert/update/delete policies.

-- Private helpers (not exposed by the Data API) -------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- orgs ------------------------------------------------------------------------
create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  timezone text not null default 'Asia/Kolkata',
  owner_alert_phones text[] not null default '{}',
  whatsapp_fallback_phone text,
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

-- org_members -----------------------------------------------------------------
create table public.org_members (
  org_id uuid not null references public.orgs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'staff', 'admin')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_id_idx on public.org_members (user_id);

-- Membership check used by every select policy. Security definer so it can read
-- org_members without recursing through org_members' own policy.
create function private.is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.org_members m
     where m.org_id = org
       and m.user_id = (select auth.uid())
  );
$$;
revoke execute on function private.is_org_member(uuid) from public;
revoke execute on function private.is_org_member(uuid) from anon;
grant execute on function private.is_org_member(uuid) to authenticated;

-- sources ---------------------------------------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  kind text not null check (kind in ('web_form', 'whatsapp_inbound')),
  name text not null,
  public_key text unique not null,
  created_at timestamptz not null default now()
);
create index sources_org_id_idx on public.sources (org_id);

-- leads -----------------------------------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  source_id uuid references public.sources (id) on delete set null,
  name text not null,
  phone_e164 text not null,
  bhk text,
  possession_month text check (possession_month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  consent_at timestamptz not null,
  status text not null default 'new'
    check (status in ('new', 'contacted', 'consult_booked', 'site_measured', 'quote_sent', 'signed', 'lost')),
  last_enquiry_at timestamptz not null default now(),
  first_auto_reply_at timestamptz,
  first_human_reply_at timestamptz,
  last_inbound_at timestamptz,
  created_at timestamptz not null default now(),
  constraint leads_org_id_phone_e164_key unique (org_id, phone_e164)
);
create index leads_org_id_created_at_idx on public.leads (org_id, created_at desc);
create index leads_source_id_idx on public.leads (source_id);

-- messages --------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  to_phone text,
  direction text not null check (direction in ('outbound', 'inbound', 'echo')),
  kind text not null check (kind in ('template', 'session')),
  template_name text,
  body text,
  provider text not null,
  provider_message_id text,
  status text not null default 'queued'
    check (status in ('queued', 'sent', 'delivered', 'read', 'failed')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index messages_provider_message_id_key
  on public.messages (provider, provider_message_id)
  where provider_message_id is not null;
create index messages_lead_id_idx on public.messages (lead_id);
create index messages_org_id_created_at_idx on public.messages (org_id, created_at desc);

-- events ----------------------------------------------------------------------
create table public.events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.orgs (id) on delete cascade,
  lead_id uuid references public.leads (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index events_org_id_created_at_idx on public.events (org_id, created_at desc);
create index events_lead_id_idx on public.events (lead_id);

-- webhook_events (service role only) ------------------------------------------
create table public.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  provider_event_id text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint webhook_events_provider_event_id_key unique (provider, provider_event_id)
);

-- Row-level security ----------------------------------------------------------
alter table public.orgs enable row level security;
alter table public.org_members enable row level security;
alter table public.sources enable row level security;
alter table public.leads enable row level security;
alter table public.messages enable row level security;
alter table public.events enable row level security;
alter table public.webhook_events enable row level security;

create policy "members read their orgs" on public.orgs
  for select to authenticated using (private.is_org_member(id));
create policy "members read org memberships" on public.org_members
  for select to authenticated using (private.is_org_member(org_id));
create policy "members read org sources" on public.sources
  for select to authenticated using (private.is_org_member(org_id));
create policy "members read org leads" on public.leads
  for select to authenticated using (private.is_org_member(org_id));
create policy "members read org messages" on public.messages
  for select to authenticated using (private.is_org_member(org_id));
create policy "members read org events" on public.events
  for select to authenticated using (private.is_org_member(org_id));
-- webhook_events: no policies on purpose.

-- Grants ----------------------------------------------------------------------
-- anon gets nothing. authenticated may only read (RLS narrows it to its orgs).
-- service_role keeps the Supabase default full access and bypasses RLS.
revoke all on public.orgs, public.org_members, public.sources, public.leads,
  public.messages, public.events, public.webhook_events from anon;
revoke all on public.orgs, public.org_members, public.sources, public.leads,
  public.messages, public.events, public.webhook_events from authenticated;
grant select on public.orgs, public.org_members, public.sources, public.leads,
  public.messages, public.events to authenticated;
revoke all on sequence public.events_id_seq, public.webhook_events_id_seq from anon, authenticated;
