#!/usr/bin/env bash
# D1 · prepare, sync and the internal-grant RPC share the tenant billing lock
# (key 31) across real concurrent sessions, and a grant racing a Checkout is
# decided after the other commits.
set -euo pipefail

DB_URL="${1:?usage: phase57_billing_lock_concurrency.sh <database-url>}"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }

T1='e5710000-0000-4000-8000-000000000011'
T2='e5710000-0000-4000-8000-000000000012'
T3='e5710000-0000-4000-8000-000000000013'
WORK="$(mktemp -d)"

db_cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.billing_checkout_attempts where tenant_id in ('$T1', '$T2', '$T3');
    delete from billing_private.subscription_holds where tenant_id in ('$T1', '$T2', '$T3');
    delete from billing_private.internal_subscription_audit where tenant_id in ('$T1', '$T2', '$T3');
    delete from public.subscriptions where tenant_id in ('$T1', '$T2', '$T3');
    delete from public.tenants where id in ('$T1', '$T2', '$T3');
  " >/dev/null || true
}
trap 'db_cleanup; rm -rf "$WORK"' EXIT
db_cleanup

sql "insert into public.tenants (id, name, slug, active) values
  ('$T1', 'P57 lock 1', 'p57-lock-1', true),
  ('$T2', 'P57 lock 2', 'p57-lock-2', true),
  ('$T3', 'P57 lock 3', 'p57-lock-3', true);" >/dev/null

BASIC="$(sql "select id from public.plans where code = 'basic';")"

PREPARE() { echo "select public.prepare_billing_checkout_attempt_v2('$1', 'basic', 'month', 'billing', false);"; }
SYNC() { echo "select public.sync_billing_subscription_v1('$1', '$BASIC', 'stripe', 'cus_p57_lock', 'sub_p57_lock_$2', '$3', now(), now() + interval '30 days', false, '{}'::jsonb, now(), null, false);"; }
GRANT() { echo "select public.grant_internal_subscription_v1('$1', 'basic', 'active', null, 'Concurrency test grant', 'phase57');"; }

# Holder runs $1 inside a transaction and keeps the lock for 3 s; the
# contender runs $2 with a short lock_timeout and must time out.
expect_blocked() {
  local label="$1" holder="$2" contender="$3"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt >"$WORK/holder.out" 2>&1 <<SQL &
begin;
$holder
select pg_sleep(3);
rollback;
SQL
  local pid=$!
  sleep 1
  if psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt >"$WORK/contender.out" 2>&1 <<SQL
set lock_timeout = '400ms';
$contender
SQL
  then
    echo "FAIL [$label]: contender did not wait for the tenant billing lock" >&2
    cat "$WORK/contender.out" >&2
    wait "$pid" || true
    exit 1
  fi
  if ! grep -q "lock timeout" "$WORK/contender.out"; then
    echo "FAIL [$label]: unexpected contender error" >&2
    cat "$WORK/contender.out" >&2
    wait "$pid" || true
    exit 1
  fi
  wait "$pid"
  echo "PASS [$label]"
}

expect_blocked "prepare holds, sync waits" "$(PREPARE "$T1")" "$(SYNC "$T1" a active)"
expect_blocked "sync holds, prepare waits" "$(SYNC "$T1" b canceled)" "$(PREPARE "$T1")"
expect_blocked "grant holds, prepare waits" "$(GRANT "$T2")" "$(PREPARE "$T2")"
expect_blocked "prepare holds, grant waits" "$(PREPARE "$T2")" "$(GRANT "$T2")"

# Race: a grant commits while a Checkout prepare is waiting for the lock. The
# prepare is decided after the grant and refuses (no incompatible Checkout).
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt >"$WORK/grant.out" 2>&1 <<SQL &
begin;
$(GRANT "$T3")
select pg_sleep(2);
commit;
SQL
GPID=$!
sleep 1
RESULT="$(sql "$(PREPARE "$T3")")"
wait "$GPID"
if ! grep -q '"outcome": "granted"' "$WORK/grant.out"; then
  echo "FAIL [race]: grant did not commit" >&2; cat "$WORK/grant.out" >&2; exit 1
fi
if [[ "$RESULT" != *'"outcome": "internal_subscription_current"'* ]]; then
  echo "FAIL [race]: prepare racing a grant must refuse, got $RESULT" >&2; exit 1
fi
if [[ "$(sql "select count(*) from public.billing_checkout_attempts where tenant_id = '$T3';")" != "0" ]]; then
  echo "FAIL [race]: no attempt may be reserved" >&2; exit 1
fi
echo "PASS [race: grant vs prepare]"

echo "phase57_billing_lock_concurrency: ok"
