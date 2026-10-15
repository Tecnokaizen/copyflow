#!/usr/bin/env bash
# Real concurrent sessions against a local database. Cleanup always runs.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e4510000-0000-4000-8000-000000000011'
ACTOR='e4510000-0000-4000-8000-000000000001'
ORDER='e4510000-0000-4000-8000-000000000031'
TASK_DIR="$(mktemp -d)"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
rpc() {
  sql "begin;select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;select $1;commit;" | tail -1
}

cleanup() {
  sql "delete from public.tenants where id='$TENANT';delete from auth.users where id='$ACTOR';" >/dev/null || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT

sql "insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','pay@phase45.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR','Pago');
insert into public.tenants(id,name,slug,active) values('$TENANT','Payments concurrency','phase45pay',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','owner',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled)
values('$TENANT','Recibido','received',true,1,true,false,false,false);" >/dev/null

sql "begin;select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;insert into public.orders(id,tenant_id,title,status_id) select '$ORDER','$TENANT','Concurrente',id from public.order_statuses where tenant_id='$TENANT' and is_initial;commit;" >/dev/null
VERSION="$(sql "select row_version::text from public.orders where id='$ORDER'")"
rpc "public.set_order_total_amount('$ORDER','100.00','$VERSION')->>'total_amount'" >/dev/null

pids=()
for n in 1 2 3 4 5; do
  rpc "public.record_order_payment('$ORDER','30.00','2026-10-07T12:0${n}:00Z','concurrent-$n')->>'error'" > "$TASK_DIR/pay-$n" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done

ok_count="$(awk '$0=="" {n++} END {print n+0}' "$TASK_DIR"/pay-*)"
err_count="$(awk '$0=="payment_exceeds_total" {n++} END {print n+0}' "$TASK_DIR"/pay-*)"
[[ "$ok_count" == 3 ]]
[[ "$err_count" == 2 ]]
[[ "$(sql "select coalesce(sum(amount),0)::text from public.order_payments where order_id='$ORDER' and voided_at is null")" == "90.00" ]]
[[ "$(sql "select count(*) from public.order_payments where order_id='$ORDER'")" == 3 ]]
echo 'PASS: five concurrent 30.00 deposits against 100.00, three posted, sum 90.00'

VERSION="$(sql "select row_version::text from public.orders where id='$ORDER'")"
rpc "public.set_order_total_amount('$ORDER','200.00','$VERSION')->>'total_amount'" >/dev/null
pids=()
for n in 1 2 3 4; do
  rpc "public.record_order_payment('$ORDER','30.00','2026-10-07T12:01:00Z','same-key')->>'replayed'" > "$TASK_DIR/retry-$n" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(sql "select count(*) from public.order_payments where order_id='$ORDER' and idempotency_key='same-key'")" == 1 ]]
echo 'PASS: four concurrent retries of one idempotency key create one payment'
