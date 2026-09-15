#!/usr/bin/env bash
set -euo pipefail

DB_URL="${1:?usage: phase12_kiosk_concurrency.sh <database-url>}"
SECRET="phase12-kiosk-signing-secret-at-least-32-chars"
SLUG="demo-phase12"
TENANT_ID="ac000000-0000-4000-8000-000000000001"
SERVICE_ID="ac000000-0000-4000-8000-000000000011"
CLIENT_IP="203.0.113.99"
ISSUED_AT="$(date +%s)"

CLIENT_KEY="$(
  node -e 'const {createHmac}=require("node:crypto"); process.stdout.write(createHmac("sha256",process.argv[1]).update(`client|${process.argv[2]}`).digest("hex"))' \
    "$SECRET" "$CLIENT_IP"
)"

sign() {
  node -e 'const {createHmac}=require("node:crypto"); process.stdout.write(createHmac("sha256",process.argv[1]).update(process.argv[2]).digest("hex"))' \
    "$SECRET" "kiosk-v1|$1|$SLUG|$CLIENT_KEY|$ISSUED_AT|$2"
}

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

enable_kiosk() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc \
    "update public.entry_channels set active=true where tenant_id='$TENANT_ID' and code='kiosk';"
}

artifacts() {
  psql_value "
    select concat_ws('|',
      (select count(*) from kiosk_private.kiosk_rate_limits where tenant_id='$TENANT_ID'),
      (select count(*) from kiosk_private.kiosk_request_permits where tenant_id='$TENANT_ID'),
      (select count(*) from public.orders where tenant_id='$TENANT_ID'),
      (select count(*) from public.activity_log where tenant_id='$TENANT_ID')
    );"
}

run_lock_race() {
  local label="$1"
  local call_sql="$2"
  local expected="$3"
  local sql_file="/tmp/kiosk-${label}-session-a.sql"
  local output_file="/tmp/kiosk-${label}-session-a.out"
  local ready_fifo="/tmp/kiosk-${label}-session-a.ready"
  rm -f "$ready_fifo"
  mkfifo "$ready_fifo"

  cat >"$sql_file" <<SQL
\set ON_ERROR_STOP on
begin;
set local role anon;
set local statement_timeout = '8s';
$call_sql
\! printf 'ready\n' > '$ready_fifo'
select pg_sleep(3);
commit;
SQL

  psql "$DB_URL" -qAtf "$sql_file" >"$output_file" &
  local session_a_pid=$!
  local marker
  if ! marker="$(timeout 10s cat "$ready_fifo")"; then
    kill "$session_a_pid" 2>/dev/null || true
    wait "$session_a_pid" 2>/dev/null || true
    echo "$label: session A never reached the lock barrier" >&2
    exit 1
  fi
  if [[ "$marker" != "ready" ]]; then
    echo "$label: invalid session barrier marker: $marker" >&2
    exit 1
  fi

  local started_at
  started_at="$(date +%s%3N)"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    set statement_timeout = '8s';
    update public.entry_channels
    set active=false
    where tenant_id='$TENANT_ID' and code='kiosk';
  "
  local elapsed_ms=$(( $(date +%s%3N) - started_at ))
  wait "$session_a_pid"
  rm -f "$ready_fifo"

  if ! grep -qx "$expected" "$output_file"; then
    echo "$label: session A did not return $expected" >&2
    cat "$output_file" >&2
    exit 1
  fi
  if (( elapsed_ms < 1500 || elapsed_ms >= 8000 )); then
    echo "$label: disable did not serialize safely (${elapsed_ms}ms)" >&2
    exit 1
  fi
}

BOOTSTRAP_SIGNATURE="$(sign bootstrap bootstrap)"
ADMIT_SIGNATURE="$(sign admit request)"

# bootstrap: disable waits for the shared channel lock; after commit no lookup
# or artifact is emitted.
enable_kiosk
run_lock_race \
  "bootstrap" \
  "select public.kiosk_bootstrap('$SLUG','$CLIENT_KEY',$ISSUED_AT,'bootstrap','bootstrap','$BOOTSTRAP_SIGNATURE')->>'status';" \
  "ready"
before="$(artifacts)"
status="$(psql_value "select public.kiosk_bootstrap('$SLUG','$CLIENT_KEY',$ISSUED_AT,'bootstrap','bootstrap','$BOOTSTRAP_SIGNATURE')->>'status';")"
after="$(artifacts)"
test "$status" = "not_found"
test "$before" = "$after"

# admit: the permit/rate write completes before disable; after disable no new
# rate row or permit is emitted.
enable_kiosk
run_lock_race \
  "admit" \
  "select public.admit_kiosk_request('$SLUG','$CLIENT_KEY',$ISSUED_AT,'admit','request','$ADMIT_SIGNATURE')->>'status';" \
  "admitted"
before="$(artifacts)"
status="$(psql_value "select public.admit_kiosk_request('$SLUG','$CLIENT_KEY',$ISSUED_AT,'admit','request','$ADMIT_SIGNATURE')->>'status';")"
after="$(artifacts)"
test "$status" = "not_found"
test "$before" = "$after"

# submit: prepare two admitted permits while enabled. Session A creates one
# order while holding the channel lock. After disable, the second signed submit
# returns not_found, creates no order/activity, and does not consume its permit.
enable_kiosk
permit_one="$(psql_value "select public.admit_kiosk_request('$SLUG','$CLIENT_KEY',$ISSUED_AT,'admit','request','$ADMIT_SIGNATURE')->>'permit';")"
permit_two="$(psql_value "select public.admit_kiosk_request('$SLUG','$CLIENT_KEY',$ISSUED_AT,'admit','request','$ADMIT_SIGNATURE')->>'permit';")"
order_one="ac000000-0000-4000-8000-000000000071"
order_two="ac000000-0000-4000-8000-000000000072"
fingerprint_one="$(psql_value "select kiosk_private.kiosk_payload_fingerprint('Concurrente','$SERVICE_ID','Ana','ana@example.com',null,'Concurrente',null,null);")"
fingerprint_two="$(psql_value "select kiosk_private.kiosk_payload_fingerprint('Después','$SERVICE_ID','Ana','ana@example.com',null,'Después',null,null);")"
binding_one="$permit_one|$order_one|$fingerprint_one"
binding_two="$permit_two|$order_two|$fingerprint_two"
signature_one="$(sign submit "$binding_one")"
signature_two="$(sign submit "$binding_two")"

run_lock_race \
  "submit" \
  "select public.submit_kiosk_order('$SLUG','$CLIENT_KEY',$ISSUED_AT,'submit','$binding_one','$signature_one','$permit_one','$order_one','Concurrente','$SERVICE_ID','Ana','ana@example.com',null,'Concurrente',null,null)->>'status';" \
  "created"
before="$(artifacts)"
status="$(psql_value "select public.submit_kiosk_order('$SLUG','$CLIENT_KEY',$ISSUED_AT,'submit','$binding_two','$signature_two','$permit_two','$order_two','Después','$SERVICE_ID','Ana','ana@example.com',null,'Después',null,null)->>'status';")"
after="$(artifacts)"
consumed_two="$(psql_value "select consumed_at is not null from kiosk_private.kiosk_request_permits where id='$permit_two';")"
test "$status" = "not_found"
test "$before" = "$after"
test "$consumed_two" = "f"

echo "Kiosk concurrency checks passed"
