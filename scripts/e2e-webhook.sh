#!/usr/bin/env bash
# End-to-end check of the WhatsApp webhook (spec 004, C) against a running
# local stack and a served whatsapp-webhook function. Posts payloads signed
# like the fake provider (HMAC-SHA256 of the body, keyed by
# WHATSAPP_WEBHOOK_SECRET, in x-fake-signature) and checks the database:
# bad signature, a new number creating a lead with its acknowledgement and
# owner alert (no follow-ups for a WhatsApp-first lead), a replay changing
# nothing, statuses only moving forward, a staff echo, and STOP.
# The served function must have the same WHATSAPP_WEBHOOK_SECRET.
# Usage: WHATSAPP_WEBHOOK_SECRET=... scripts/e2e-webhook.sh [function-url]
set -euo pipefail
URL="${1:-http://127.0.0.1:54321/functions/v1/whatsapp-webhook}"
SECRET="${WHATSAPP_WEBHOOK_SECRET:?set WHATSAPP_WEBHOOK_SECRET to the secret the function was served with}"
HOOK="${URL}?source=demo-whatsapp-inbound"
DB="$(docker ps --filter name=supabase_db -q | head -1)"
sql() { docker exec -i "$DB" psql -U postgres -tAc "$1"; }
fail() { echo "FAIL: $*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=e2e-webhook::$*"; exit 1; }

RUN="e2e-wh-$(date +%s)-$RANDOM"
PHONE="98451$(printf '%05d' $((RANDOM % 100000)))"
E164="+91$PHONE"
AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

cleanup() {
  # Owner alerts have no lead_id; find them through the lead's owner_alert_sent events.
  sql "delete from messages where id in (
         select (e.payload->>'message_id')::uuid from events e join leads l on l.id = e.lead_id
          where l.phone_e164 = '$E164' and l.org_id = '00000000-0000-4000-8000-000000000001'
            and e.type = 'owner_alert_sent' and e.payload ? 'message_id');
       delete from leads where phone_e164 = '$E164' and org_id = '00000000-0000-4000-8000-000000000001';
       delete from webhook_events where provider_event_id like '${RUN}%';" >/dev/null || true
}
trap cleanup EXIT

sign() { printf '%s' "$1" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.*= //'; }
# post <body> [signature] -> prints "<http code>\n<json>"
post() {
  local sig="${2:-$(sign "$1")}"
  curl -sS -w '\n%{http_code}' -X POST "$HOOK" -H 'content-type: application/json' -H "x-fake-signature: $sig" -d "$1"
}
code_of() { tail -1 <<<"$1"; }

inbound() { printf '{"events":[{"id":"%s","kind":"inbound","phone":"%s","text":"%s","at":"%s","message_id":"%s","profile_name":"E2E Webhook"}]}' "$1" "$PHONE" "$2" "$AT" "$1-msg"; }

# 1. A bad signature is refused before anything is stored.
BODY="$(inbound "${RUN}-in-1" "Hi, I need interiors for my 3BHK")"
out=$(post "$BODY" "$(printf '0%.0s' {1..64})")
[ "$(code_of "$out")" = 401 ] || fail "bad signature returned $(code_of "$out")"
[ "$(sql "select count(*) from webhook_events where provider_event_id like '${RUN}%'")" = 0 ] || fail "stored a webhook with a bad signature"

# 2. A new number: lead, acknowledgement, owner alert, and no follow-ups.
start=$(date +%s%N)
out=$(post "$BODY")
ms=$(( ($(date +%s%N) - start) / 1000000 ))
[ "$(code_of "$out")" = 200 ] || fail "inbound returned $(code_of "$out"): $(head -1 <<<"$out")"
lead=$(sql "select id from leads where phone_e164 = '$E164' and org_id = '00000000-0000-4000-8000-000000000001'")
[ -n "$lead" ] || fail "no lead for $E164"
[ "$(sql "select consent_at = '$AT'::timestamptz and last_inbound_at = '$AT'::timestamptz and first_auto_reply_at is not null
          and source_id = '00000000-0000-4000-8000-000000000102' from leads where id = '$lead'")" = t ] \
  || fail "lead consent/inbound/auto-reply/source not set"
[ "$(sql "select count(*) from messages where lead_id = '$lead' and direction = 'inbound' and kind = 'session'")" = 1 ] || fail "inbound message"
[ "$(sql "select count(*) from messages where lead_id = '$lead' and direction = 'outbound' and kind = 'session' and status = 'sent'")" = 1 ] \
  || fail "session acknowledgement"
[ "$(sql "select count(*) from events where lead_id = '$lead' and type = 'owner_alert_sent'")" -ge 1 ] || fail "owner alert"
[ "$(sql "select count(*) from jobs where lead_id = '$lead' and kind = 'followup'")" = 0 ] || fail "follow-ups scheduled for a WhatsApp-first lead"
[ "$(sql "select count(*) from events where lead_id = '$lead' and type = 'followups_skipped'")" = 1 ] || fail "followups_skipped event"
[ "$(sql "select count(*) from webhook_events where provider_event_id = '${RUN}-in-1' and processed_at is not null")" = 1 ] \
  || fail "webhook event not stored and processed"

# 3. A replay changes nothing.
state() { sql "select (select count(*) from messages where lead_id = '$lead') || '/' || (select count(*) from events where lead_id = '$lead')
                || '/' || (select count(*) from jobs where lead_id = '$lead') || '/' || (select count(*) from messages where to_phone = '+919000000001')"; }
before=$(state)
out=$(post "$BODY")
[ "$(code_of "$out")" = 200 ] || fail "replay returned $(code_of "$out")"
grep -q '"duplicates":1' <<<"$out" || fail "replay not a duplicate: $out"
[ "$(state)" = "$before" ] || fail "replay changed rows: $before -> $(state)"

# 4. Statuses only move forward: read, then a late delivered.
ack=$(sql "select provider_message_id from messages where lead_id = '$lead' and direction = 'outbound' and kind = 'session'")
out=$(post "$(printf '{"events":[{"id":"%s-st-read","kind":"status","message_id":"%s","status":"read","at":"%s"},{"id":"%s-st-dlv","kind":"status","message_id":"%s","status":"delivered","at":"%s"}]}' \
  "$RUN" "$ack" "$AT" "$RUN" "$ack" "$AT")")
[ "$(code_of "$out")" = 200 ] || fail "status returned $(code_of "$out")"
[ "$(sql "select status from messages where provider_message_id = '$ack'")" = read ] || fail "status is not read"

# 5. A staff echo: first_human_reply_at. (Cancelling follow-ups on an echo is
# covered by the function's tests; a WhatsApp-first lead has none.)
out=$(post "$(printf '{"events":[{"id":"%s-echo","kind":"echo","phone":"%s","text":"Our designer will call you at 4","at":"%s","message_id":"%s-echo-msg"}]}' \
  "$RUN" "$PHONE" "$AT" "$RUN")")
[ "$(code_of "$out")" = 200 ] || fail "echo returned $(code_of "$out")"
[ "$(sql "select first_human_reply_at is not null from leads where id = '$lead'")" = t ] || fail "first_human_reply_at"
[ "$(sql "select count(*) from messages where lead_id = '$lead' and direction = 'echo'")" = 1 ] || fail "echo message"

# 6. STOP opts out and sends nothing.
outbound_before=$(sql "select count(*) from messages where lead_id = '$lead' and direction = 'outbound'")
out=$(post "$(inbound "${RUN}-in-stop" "STOP")")
[ "$(code_of "$out")" = 200 ] || fail "STOP returned $(code_of "$out")"
[ "$(sql "select opted_out_at is not null from leads where id = '$lead'")" = t ] || fail "opted_out_at"
[ "$(sql "select count(*) from messages where lead_id = '$lead' and direction = 'outbound'")" = "$outbound_before" ] || fail "sent after STOP"

echo "PASS: signature, new lead + ack + alert, no follow-ups (${ms}ms), replay, statuses, echo and STOP all correct"
