#!/usr/bin/env bash
# Order Lines V1 · PR A. Real concurrent sessions against a local database.
# Every psql call is a NEW session (the gestcopy.* GUCs are unset, i.e. NULL),
# which is exactly the state of a fresh pooled connection. Cleanup always runs.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e5110000-0000-4000-8000-000000000011'
ACTOR='e5110000-0000-4000-8000-000000000001'
STATUS_TENANT_ORDER_PREFIX='e5110000-0000-4000-8000-0000000001'
TASK_DIR="$(mktemp -d)"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
as_owner() {
  echo "begin;select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;$1;commit;"
}
rpc() { sql "$(as_owner "select $1")" | tail -1; }

cleanup() {
  sql "delete from public.tenants where id='$TENANT';delete from auth.users where id='$ACTOR';" >/dev/null || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT

new_order() { # $1 = order id
  sql "$(as_owner "insert into public.orders(id,tenant_id,title,status_id) select '$1','$TENANT','Concurrente',id from public.order_statuses where tenant_id='$TENANT' and is_initial")" >/dev/null
}
version() { sql "select row_version::text from public.orders where id='$1'"; }
line() { # $1 concept, $2 price
  printf '{"concept":"%s","quantity":"1","unit_price":"%s"}' "$1" "$2"
}
lines_n() { # $1 = count, each line costs 1.00
  local out="" i
  for ((i = 1; i <= $1; i++)); do out+="$(line "L$i" 1.00),"; done
  printf '[%s]' "${out%,}"
}
fail() { echo "FAIL: $*" >&2; exit 1; }

sql "insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','lines@phase51.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR','Lineas');
insert into public.tenants(id,name,slug,active) values('$TENANT','Order lines concurrency','phase51conc',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','owner',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled)
values('$TENANT','Recibido','received',true,1,true,false,false,false);" >/dev/null

# 1. Five sessions replace the lines of one order with the SAME expected version.
O1="${STATUS_TENANT_ORDER_PREFIX}31"
new_order "$O1"
V="$(version "$O1")"
pids=()
for n in 1 2 3 4 5; do
  rpc "public.replace_order_items_v1('$O1','$V','$(lines_n "$n")'::jsonb)->>'error'" > "$TASK_DIR/same-$n" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
ok_count="$(awk '$0=="" {n++} END {print n+0}' "$TASK_DIR"/same-*)"
conflicts="$(awk '$0=="conflict" {n++} END {print n+0}' "$TASK_DIR"/same-*)"
[[ "$ok_count" == 1 ]] || fail "expected exactly one winner, got $ok_count"
[[ "$conflicts" == 4 ]] || fail "expected four conflicts, got $conflicts"
winner="$(grep -lx '' "$TASK_DIR"/same-* | sed 's/.*same-//')"
[[ "$(sql "select count(*) from public.order_items where order_id='$O1'")" == "$winner" ]] || fail "lines are not the winner's"
[[ "$(sql "select items_total::text from public.orders where id='$O1'")" == "${winner}.00" ]] || fail "aggregate is not the winner's"
[[ "$(version "$O1")" == "$((V + 1))" ]] || fail "row_version must advance exactly once"
echo "PASS: five concurrent replaces with one version, one winner (job $winner), four conflicts, no mixed lines"

# 2. Payment vs lowering the derived total: collections can never exceed the total.
paid_wins=0
total_wins=0
for round in 1 2 3 4 5 6 7 8; do
  O="${STATUS_TENANT_ORDER_PREFIX}4$round"
  new_order "$O"
  rpc "public.replace_order_items_v1('$O','$(version "$O")','[$(line 'Base' 100.00)]'::jsonb,'items')->>'error'" >/dev/null
  V="$(version "$O")"
  rpc "public.record_order_payment('$O','60.00','2026-10-16T12:00:00Z','race-pay-$round-aaaa','cash',null,'$TENANT')->>'error'" > "$TASK_DIR/pay-$round" &
  p1=$!
  rpc "public.replace_order_items_v1('$O','$V','[$(line 'Rebaja' 50.00)]'::jsonb,'items')->>'error'" > "$TASK_DIR/low-$round" &
  p2=$!
  wait "$p1"; wait "$p2"
  pay="$(cat "$TASK_DIR/pay-$round")"; low="$(cat "$TASK_DIR/low-$round")"
  paid="$(sql "select coalesce(sum(amount),0)::text from public.order_payments where order_id='$O' and voided_at is null")"
  total="$(sql "select total_amount::text from public.orders where id='$O'")"
  [[ "$(sql "select ($paid <= $total)::text")" == true ]] || fail "round $round: paid $paid exceeds total $total"
  [[ "$(sql "select (total_amount = items_total)::text from public.orders where id='$O'")" == true ]] || fail "round $round: total drifted from the lines"
  if [[ "$pay" == "" && "$low" == "total_below_paid" ]]; then
    [[ "$paid" == "60.00" && "$total" == "100.00" ]] || fail "round $round: payment-first state is wrong ($paid/$total)"
    paid_wins=$((paid_wins + 1))
  elif [[ "$pay" == "payment_exceeds_total" && "$low" == "" ]]; then
    [[ "$paid" == "0" || "$paid" == "0.00" ]] || fail "round $round: total-first state is wrong ($paid/$total)"
    [[ "$total" == "50.00" ]] || fail "round $round: total-first total is $total"
    total_wins=$((total_wins + 1))
  else
    fail "round $round: unexpected outcomes pay='$pay' lower='$low'"
  fi
done
echo "PASS: 8 payment/total races, collections never exceeded the total (payment first: $paid_wins, total first: $total_wins)"

# 3. Different orders of one tenant write in parallel without deadlocks.
pids=()
for n in 1 2 3 4; do
  O="${STATUS_TENANT_ORDER_PREFIX}5$n"
  new_order "$O"
  rpc "public.replace_order_items_v1('$O','$(version "$O")','$(lines_n 100)'::jsonb,'items')->>'error'" > "$TASK_DIR/par-$n" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(awk '$0=="" {n++} END {print n+0}' "$TASK_DIR"/par-*)" == 4 ]] || fail "parallel writes on different orders failed"
for n in 1 2 3 4; do
  O="${STATUS_TENANT_ORDER_PREFIX}5$n"
  [[ "$(sql "select count(*)||':'||items_total||':'||total_amount from public.order_items i join public.orders o on o.id=i.order_id where o.id='$O' group by o.items_total,o.total_amount")" == "100:100.00:100.00" ]] || fail "order $n has wrong lines or totals"
done
echo 'PASS: four parallel 100-line replaces on different orders, all consistent'

# 4. Fresh sessions (GUC never set): direct writes stay refused.
direct() {
  local statement="$1" expected="$2" out
  if out="$(sql "$(as_owner "$statement")" 2>&1)"; then
    fail "direct write succeeded on a fresh session: $statement"
  fi
  [[ "$out" == *"$expected"* ]] || fail "wrong refusal for [$statement]: $out"
}
V="$(version "$O1")"
sql "$(as_owner "select public.set_order_total_amount('$O1','77.00','$V')->>'ok'")" >/dev/null
for _ in 1 2 3; do
  direct "update public.orders set total_amount=5 where id='$O1'" 'total_amount_rpc_only'
done
direct "update public.orders set total_mode='items' where id='$O1'" 'order_items_columns_rpc_only'
direct "update public.orders set items_total=1 where id='$O1'" 'order_items_columns_rpc_only'
direct "update public.orders set prices_include_tax=true where id='$O1'" 'order_items_columns_rpc_only'
direct "update public.orders set total_amount=5 where id='${STATUS_TENANT_ORDER_PREFIX}51'" 'total_amount_items_mode'
direct "insert into public.order_items(tenant_id,order_id,position,concept,quantity,unit_price) values('$TENANT','$O1',900,'x',1,1)" 'permission denied'
direct "delete from public.order_items where order_id='$O1'" 'permission denied'
[[ "$(sql "select total_amount::text from public.orders where id='$O1'")" == "77.00" ]] || fail "manual total changed"
echo 'PASS: direct writes to totals, mode and lines are refused on fresh sessions'
