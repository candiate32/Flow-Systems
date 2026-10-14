-- Spec 004, slice D, item 1: response-time metrics
-- (docs/specs/004-production-engine.md, "D. Metrics and report").
--
-- Two views, both `security_invoker`, so a member reading them gets exactly
-- the rows the leads table's RLS lets them read (their own orgs' leads):
--
-- - lead_response_metrics: one row per lead.
-- - lead_response_weekly: one row per org per ISO week in IST (Monday 00:00
--   to Sunday 23:59:59 Asia/Kolkata), aggregated from the first.
--
-- A lead's enquiry time is its first enquiry: least(created_at,
-- last_enquiry_at). created_at keeps a form lead's first enquiry when a
-- repeat enquiry moves last_enquiry_at; last_enquiry_at is the message time of
-- a lead who wrote first on WhatsApp (the webhook creates the row a moment
-- later). first_auto_reply_at and first_human_reply_at are set once per lead,
-- so both times are measured from that first enquiry, and a lead counts in
-- the week of its first enquiry only.
--
-- A reply recorded before the enquiry is not a reply to it (a staff message
-- from an earlier conversation, a late echo): its seconds are null, not
-- negative, and it is left out of medians and the 1-hour %.

create view public.lead_response_metrics
with (security_invoker = true)
as
with base as (
  select l.id as lead_id,
         l.org_id,
         least(l.created_at, l.last_enquiry_at) as enquiry_at,
         l.first_auto_reply_at,
         l.first_human_reply_at,
         l.last_inbound_at
    from public.leads l
)
select b.lead_id,
       b.org_id,
       b.enquiry_at,
       -- Monday of the enquiry's week in IST, and its ISO week (e.g. 2026-W41).
       (date_trunc('week', b.enquiry_at at time zone 'Asia/Kolkata'))::date as week_start,
       to_char(b.enquiry_at at time zone 'Asia/Kolkata', 'IYYY-"W"IW') as iso_week,
       case when b.first_auto_reply_at >= b.enquiry_at
            then extract(epoch from b.first_auto_reply_at - b.enquiry_at) end as seconds_to_auto_reply,
       case when b.first_human_reply_at >= b.enquiry_at
            then extract(epoch from b.first_human_reply_at - b.enquiry_at) end as seconds_to_first_human_reply,
       -- Strictly after the enquiry: a WhatsApp-first lead's own first message
       -- (last_inbound_at = enquiry) is the enquiry, not a reply.
       coalesce(b.last_inbound_at > b.enquiry_at, false) as replied_by_lead
  from base b;

comment on view public.lead_response_metrics is
  'Per lead: seconds from the first enquiry to the first auto-reply and to the first human reply, and whether the lead replied (spec 004, D.1). security_invoker: RLS of leads applies.';

-- Medians and p90 are percentile_cont (linear interpolation between the two
-- nearest values), rounded to 0.1 s, over the leads that got that reply.
-- The 1-hour % is over all of the week's leads: a lead with no human reply
-- yet counts as not answered within the hour. Exactly 3600 s counts.
create view public.lead_response_weekly
with (security_invoker = true)
as
select m.org_id,
       m.week_start,
       m.week_start + 6 as week_end,
       to_char(m.week_start, 'IYYY-"W"IW') as iso_week,
       count(*)::integer as lead_count,
       count(m.seconds_to_auto_reply)::integer as auto_replied_count,
       round((percentile_cont(0.5) within group (order by m.seconds_to_auto_reply))::numeric, 1)
         as median_seconds_to_auto_reply,
       round((percentile_cont(0.9) within group (order by m.seconds_to_auto_reply))::numeric, 1)
         as p90_seconds_to_auto_reply,
       count(m.seconds_to_first_human_reply)::integer as human_replied_count,
       round((percentile_cont(0.5) within group (order by m.seconds_to_first_human_reply))::numeric, 1)
         as median_seconds_to_first_human_reply,
       (count(*) filter (where m.seconds_to_first_human_reply <= 3600))::integer as human_reply_within_1h_count,
       round(100.0 * count(*) filter (where m.seconds_to_first_human_reply <= 3600) / count(*), 1)
         as pct_human_reply_within_1h,
       (count(*) filter (where m.replied_by_lead))::integer as replied_by_lead_count
  from public.lead_response_metrics m
 group by m.org_id, m.week_start;

comment on view public.lead_response_weekly is
  'Per org per ISO week (Monday-Sunday, IST): lead count, median and p90 seconds to auto-reply, median seconds to first human reply, % with a human reply within 1 hour (spec 004, D.1). security_invoker: RLS of leads applies.';

-- Members read (RLS narrows it to their orgs); anon gets nothing.
revoke all on public.lead_response_metrics, public.lead_response_weekly from anon, authenticated;
grant select on public.lead_response_metrics, public.lead_response_weekly to authenticated;
