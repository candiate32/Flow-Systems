#!/usr/bin/env bash
# Burst check (spec 004, A.7): 100 enquiries with distinct phones posted at
# once to ingest-form. All must return 200 within 60 seconds, and the database
# must hold exactly 100 leads and 100 enquiry_ack messages for those phones,
# with no duplicates. Rows it created are removed afterwards.
# Usage: scripts/burst.sh [function-url]
set -euo pipefail
URL="${1:-http://127.0.0.1:54321/functions/v1/ingest-form}"
N=100
DB="$(docker ps --filter name=supabase_db -q | head -1)"
sql() { docker exec -i "$DB" psql -U postgres -tAc "$1"; }
fail() { echo "FAIL: $*"; [ -n "${GITHUB_ACTIONS:-}" ] && echo "::error title=burst::$*"; exit 1; }

# Phones +9197<run><5 digits>: one prefix per run, unused by any existing lead.
for _ in $(seq 1 20); do
  RUN=$(printf '%03d' $((RANDOM % 1000)))
  PREFIX="+9197${RUN}"
  [ "$(sql "select count(*) from leads where phone_e164 like '${PREFIX}%'")" = 0 ] && break
done
LIKE="${PREFIX}%"

OUT="$(mktemp -d)"
cleanup() {
  # Owner alerts have no lead_id; find them through the leads' owner_alert_sent events.
  sql "delete from messages where id in (
         select (e.payload->>'message_id')::uuid from events e join leads l on l.id = e.lead_id
          where l.phone_e164 like '${LIKE}' and e.type = 'owner_alert_sent' and e.payload ? 'message_id');
       delete from leads where phone_e164 like '${LIKE}';" >/dev/null || true
  rm -rf "$OUT"
}
trap cleanup EXIT

post() {
  local i="$1" phone
  phone="97${RUN}$(printf '%05d' "$i")"
  curl -s -o "$OUT/$i.json" -w '%{http_code}\n' --max-time 60 -X POST "$URL" \
    -H 'content-type: application/json' \
    -d "{\"source_key\":\"demo-web-form\",\"name\":\"Burst $i\",\"phone\":\"$phone\",\"bhk\":\"2BHK\",\"consent\":true}" \
    > "$OUT/$i.code" || echo 000 > "$OUT/$i.code"
}
export -f post
export URL RUN OUT

start=$(date +%s%N)
seq 1 "$N" | xargs -P "$N" -I{} bash -c 'post {}'
ms=$(( ($(date +%s%N) - start) / 1000000 ))

ok=$(cat "$OUT"/*.code | grep -c '^200$' || true)
[ "$ok" = "$N" ] || fail "$ok of $N returned 200 (codes: $(sort "$OUT"/*.code | uniq -c | tr '\n' ' '))"
[ "$ms" -lt 60000 ] || fail "$N enquiries took ${ms}ms (limit 60000)"
new=$(cat "$OUT"/*.json | grep -o '"duplicate":false' | wc -l | tr -d ' ')
[ "$new" = "$N" ] || fail "$new of $N responses were new enquiries"
acked=$(cat "$OUT"/*.json | grep -o '"ack_sent":true' | wc -l | tr -d ' ')
[ "$acked" = "$N" ] || fail "$acked of $N responses had ack_sent:true"

leads=$(sql "select count(*) from leads where phone_e164 like '${LIKE}'")
[ "$leads" = "$N" ] || fail "expected $N leads, found $leads"
distinct=$(sql "select count(distinct phone_e164) from leads where phone_e164 like '${LIKE}'")
[ "$distinct" = "$N" ] || fail "duplicate leads: $distinct distinct phones for $leads leads"

read -r acks ack_leads sent <<<"$(sql "select count(*), count(distinct m.lead_id), count(*) filter (where m.status = 'sent')
  from messages m join leads l on l.id = m.lead_id
  where l.phone_e164 like '${LIKE}' and m.template_name = 'enquiry_ack' and m.direction = 'outbound'" | tr '|' ' ')"
[ "$acks" = "$N" ] || fail "expected $N enquiry_ack messages, found $acks"
[ "$ack_leads" = "$N" ] || fail "acks reached only $ack_leads distinct leads (duplicates)"
[ "$sent" = "$N" ] || fail "only $sent of $N acks were sent"
[ "$(sql "select count(*) from leads where phone_e164 like '${LIKE}' and first_auto_reply_at is null")" = 0 ] \
  || fail "some leads have no first_auto_reply_at"

echo "PASS: $N enquiries in ${ms}ms: $N x 200, $N leads, $N enquiry_ack messages, no duplicates"
