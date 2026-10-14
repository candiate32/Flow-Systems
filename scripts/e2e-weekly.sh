#!/usr/bin/env bash
# End-to-end check of the weekly report (spec 004, D.1 and D.2) against a
# running local stack and a served run-jobs function. Creates a throwaway org
# with two owner phones and three enquiries last week (Tuesday 10:00 IST),
# queues its report the way the Monday cron does, calls run-jobs once, and
# checks: one weekly_report job keyed weekly:<org>:<iso-week>, the
# weekly_summary template sent to each owner phone with the week's numbers,
# and a second cron run and a second run-jobs call sending nothing.
# The served function must have the same RUN_JOBS_SECRET. Without
# RESEND_API_KEY on the function no email is attempted (weekly_email_skipped).
# Usage: RUN_JOBS_SECRET=... scripts/e2e-weekly.sh [run-jobs-url]
set -euo pipefail
URL="${1:-http://127.0.0.1:54321/functions/v1/run-jobs}"
SECRET="${RUN_JOBS_SECRET:?set RUN_JOBS_SECRET to the secret run-jobs was served with}"
DB="$(docker ps --filter name=supabase_db -q | head -1)"
sql() { docker exec -i "$DB" psql -U postgres -tAc "$1"; }
fail() { echo "FAIL: $*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=e2e-weekly::$*"; exit 1; }

ORG="$(sql "select gen_random_uuid()")"
P1="+9198452$(printf '%05d' $((RANDOM % 100000)))"
P2="+9198453$(printf '%05d' $((RANDOM % 100000)))"
cleanup() { sql "delete from orgs where id = '$ORG'" >/dev/null || true; }
trap cleanup EXIT

# Last week's Monday (IST), as the cron computes it, and its ISO week.
WEEK="$(sql "select private.report_week_start(now())")"
ISO="$(sql "select to_char(date '$WEEK', 'IYYY-\"W\"IW')")"
sql "insert into orgs (id, name, slug, owner_alert_phones)
     values ('$ORG', 'E2E Weekly Studio', 'e2e-weekly-$ORG', array['$P1', '$P2'])" >/dev/null
# Tuesday 10:00 IST of that week; auto-replies after 5, 10, 20 s; staff replies after 60 s and 2 h.
sql "insert into leads (org_id, name, phone_e164, consent_at, created_at, last_enquiry_at, first_auto_reply_at, first_human_reply_at)
     select '$ORG', 'E2E Weekly ' || n, '+9198454' || lpad(n::text, 5, '0'), t, t, t,
            t + make_interval(secs => a), t + make_interval(secs => h)
       from (values (1, 5, 60), (2, 10, 7200), (3, 20, null)) v(n, a, h),
            lateral (select (date '$WEEK' + 1 + time '04:30') at time zone 'UTC' as t) x" >/dev/null

[ "$(sql "select count(*) from private.enqueue_weekly_reports(now(), '$ORG')")" = 1 ] || fail "cron did not queue one job"
[ "$(sql "select count(*) from private.enqueue_weekly_reports(now(), '$ORG')")" = 0 ] || fail "second cron run queued again"
KEY="$(sql "select idempotency_key from jobs where org_id = '$ORG' and kind = 'weekly_report'")"
[ "$KEY" = "weekly:$ORG:$ISO" ] || fail "job key $KEY, expected weekly:$ORG:$ISO"

call() { curl -sS -w '\n%{http_code}' -X POST "$URL" -H 'content-type: application/json' -H "x-run-jobs-secret: $SECRET" -d '{}'; }
out="$(call)"; code="$(tail -1 <<<"$out")"
[ "$code" = 200 ] || fail "run-jobs returned $code: $(head -1 <<<"$out")"

[ "$(sql "select status from jobs where org_id = '$ORG' and kind = 'weekly_report'")" = done ] || fail "report job not done"
sent="$(sql "select string_agg(to_phone, ',' order by to_phone) from messages
              where org_id = '$ORG' and template_name = 'weekly_summary' and direction = 'outbound' and status = 'sent'")"
[ "$sent" = "$(printf '%s\n%s\n' "$P1" "$P2" | sort | paste -sd,)" ] || fail "weekly_summary sent to [$sent], expected both owner phones"
[ "$(sql "select count(*) from events where org_id = '$ORG' and type = 'weekly_summary_sent'")" = 2 ] || fail "weekly_summary_sent events"
[ "$(sql "select count(*) from events where org_id = '$ORG' and type in ('weekly_email_skipped', 'weekly_email_sent')")" = 1 ] \
  || fail "no email outcome recorded"
# The numbers in the report: 3 leads, auto median 10 s, p90 18 s, team median 1h 1m, 33.3 % within an hour.
params="$(sql "select payload->'params' from jobs where org_id = '$ORG' and kind = 'send_message' limit 1")"
grep -q '"3", "10s", "18s", "1h 1m", "33.3%"' <<<"$params" || fail "unexpected report params: $params"

out="$(call)"; [ "$(tail -1 <<<"$out")" = 200 ] || fail "second run-jobs call failed"
[ "$(sql "select count(*) from messages where org_id = '$ORG' and template_name = 'weekly_summary'")" = 2 ] \
  || fail "second run sent again"

echo "PASS: one job per org and week ($ISO), weekly_summary to both owner phones with the week's numbers, re-runs send nothing"
