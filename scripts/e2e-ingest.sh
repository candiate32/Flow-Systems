#!/usr/bin/env bash
# End-to-end check of the demo form against a running local stack (spec 002, bar 4-6).
# Usage: scripts/e2e-ingest.sh [function-url]
set -euo pipefail
URL="${1:-http://127.0.0.1:54321/functions/v1/ingest-form}"
DB="$(docker ps --filter name=supabase_db -q | head -1)"
sql() { docker exec -i "$DB" psql -U postgres -tAc "$1"; }
PHONE="98450$(printf '%05d' $((RANDOM % 100000)))"
E164="+91$PHONE"
body() { printf '{"source_key":"demo-web-form","name":"E2E Test","phone":"%s","bhk":"3BHK","possession_month":"2027-03","consent":%s}' "$1" "$2"; }
fail() { echo "FAIL: $*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=e2e-ingest::$*"; exit 1; }

start=$(date +%s%N)
out=$(curl -sS -w '\n%{http_code}' -X POST "$URL" -H 'content-type: application/json' -d "$(body "$PHONE" true)")
ms=$(( ($(date +%s%N) - start) / 1000000 ))
code=$(tail -1 <<<"$out"); json=$(head -1 <<<"$out")
[ "$code" = 200 ] || fail "first post returned $code: $json"
grep -q '"duplicate":false' <<<"$json" || fail "first post not new: $json"
[ "$ms" -lt 2000 ] || fail "took ${ms}ms"

lead=$(sql "select id from leads where phone_e164 = '$E164'")
[ "$(wc -l <<<"$lead")" = 1 ] && [ -n "$lead" ] || fail "expected exactly one lead for $E164"
[ "$(sql "select count(*) from messages where lead_id = '$lead' and template_name = 'enquiry_ack' and direction = 'outbound'")" = 1 ] || fail "ack message"
owners=$(sql "select cardinality(owner_alert_phones) from orgs o join leads l on l.org_id = o.id where l.id = '$lead'")
alerts=$(sql "select count(*) from messages where lead_id is null and template_name = 'owner_alert' and created_at >= (select created_at from leads where id = '$lead')")
[ "$alerts" -ge "$owners" ] || fail "owner alerts $alerts < $owners"
[ "$(sql "select first_auto_reply_at is not null from leads where id = '$lead'")" = t ] || fail "first_auto_reply_at not set"
[ "$(sql "select count(*) from events where lead_id = '$lead' and type in ('lead_created','ack_sent','owner_alert_sent')")" = 3 ] || fail "events"

dup=$(curl -sS -X POST "$URL" -H 'content-type: application/json' -d "$(body "$PHONE" true)")
grep -q '"duplicate":true' <<<"$dup" || fail "second post not a duplicate: $dup"
[ "$(sql "select count(*) from messages where lead_id = '$lead'")" = 1 ] || fail "duplicate sent a message"

bad=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$URL" -H 'content-type: application/json' -d "$(body 12345 false)")
[ "$bad" = 400 ] || fail "bad input returned $bad"

sql "delete from messages where lead_id = '$lead'; delete from leads where id = '$lead';" >/dev/null
echo "PASS: lead, ack, owner alert, events, duplicate and bad input all correct (${ms}ms)"
