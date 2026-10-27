#!/usr/bin/env bash
# R5 (20261022120000) under concurrency. Every psql call is its own session.
#   1. Eight sessions race one RPC on the same order with the same version:
#      exactly one wins, seven get the stale-version error (optimistic
#      concurrency unchanged).
#   2. While eight sessions run RPCs on their own orders, eight others PATCH
#      those orders directly: every direct write is refused and every RPC
#      lands. The marker is per transaction; it never leaks to another session.
#   3. Eight sessions run an RPC and then a direct UPDATE in the same
#      transaction: all refused, nothing written.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e5840000-0000-4000-8000-000000000011'
ACTOR='e5840000-0000-4000-8000-000000000001'
RACE='e5840000-0000-4000-8000-000000000031'
PREFIX='e5840000-0000-4000-8000-0000000001'   # + two digits
BLOCKED='orders can only change through controlled RPCs'
TASK_DIR="$(mktemp -d)"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
as_user() {
  echo "begin;select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;$1;commit;"
}
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  rm -rf "$TASK_DIR"
  sql "delete from public.tenants where id='$TENANT';delete from auth.users where id='$ACTOR';" >/dev/null || true
}
trap cleanup EXIT
cleanup; TASK_DIR="$(mktemp -d)"

sql "insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','a@phase58c.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR','A');
insert into public.tenants(id,name,slug,active) values('$TENANT','Guard R5 conc','phase58c',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','staff',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled)
values('$TENANT','Recibido','received',true,1,true,false,false,false);" >/dev/null
orders="('$RACE','$TENANT','Carrera',(select id from public.order_statuses where tenant_id='$TENANT'),'$ACTOR')"
for i in 10 11 12 13 14 15 16 17 20 21 22 23 24 25 26 27; do
  orders="$orders,('$PREFIX$i','$TENANT','Pedido $i',(select id from public.order_statuses where tenant_id='$TENANT'),'$ACTOR')"
done
sql "$(as_user "insert into public.orders(id,tenant_id,title,status_id,created_by) values $orders")" >/dev/null

# 1. One version, eight racers.
for n in 1 2 3 4 5 6 7 8; do
  ( sql "$(as_user "select public.change_order_details_v2('$RACE','priority','high','$TENANT',0)->>'version'")" \
      > "$TASK_DIR/race-$n" 2>&1 || true ) &
done
wait
wins=$(grep -l '^1$' "$TASK_DIR"/race-* | wc -l | tr -d ' ')
stale=$(grep -l 'order has been modified since last read' "$TASK_DIR"/race-* | wc -l | tr -d ' ')
[[ "$wins" == 1 && "$stale" == 7 ]] || fail "race: $wins winner(s), $stale stale ($(cat "$TASK_DIR"/race-* | tr '\n' ' '))"
[[ "$(sql "select row_version from public.orders where id='$RACE'")" == 1 ]] || fail 'race: row_version must advance exactly once'
echo 'PASS: eight racers on one version, one winner, seven stale'

# 2. RPCs and direct PATCHes at the same time, on the same orders.
for i in 10 11 12 13 14 15 16 17; do
  ( sql "$(as_user "select public.change_order_content_v2('$PREFIX$i','notes','via RPC $i','$TENANT',0)->>'version'")" \
      > "$TASK_DIR/rpc-$i" 2>&1 || true ) &
  ( sql "$(as_user "update public.orders set notes='forged $i', priority='urgent' where id='$PREFIX$i'")" \
      > "$TASK_DIR/patch-$i" 2>&1 && echo 'WROTE' >> "$TASK_DIR/patch-$i" || true ) &
done
wait
for i in 10 11 12 13 14 15 16 17; do
  grep -q "$BLOCKED" "$TASK_DIR/patch-$i" || fail "concurrent PATCH $i was not refused: $(cat "$TASK_DIR/patch-$i")"
  grep -q '^1$' "$TASK_DIR/rpc-$i" || fail "concurrent RPC $i failed: $(cat "$TASK_DIR/rpc-$i")"
done
[[ "$(sql "select count(*) from public.orders where id::text like '$PREFIX%' and id::text between '${PREFIX}10' and '${PREFIX}17' and notes like 'via RPC %' and priority='normal' and row_version=1")" == 8 ]] \
  || fail 'concurrent: final state is not exactly the RPC writes'
echo 'PASS: eight concurrent PATCHes refused while eight RPCs landed on the same orders'

# 3. RPC then direct UPDATE in one transaction, eight at a time.
for i in 20 21 22 23 24 25 26 27; do
  ( sql "$(as_user "select public.change_order_content_v2('$PREFIX$i','notes','rpc $i','$TENANT',0);update public.orders set priority='urgent' where id='$PREFIX$i'")" \
      > "$TASK_DIR/mix-$i" 2>&1 && echo 'WROTE' >> "$TASK_DIR/mix-$i" || true ) &
done
wait
for i in 20 21 22 23 24 25 26 27; do
  grep -q "$BLOCKED" "$TASK_DIR/mix-$i" || fail "RPC + PATCH $i was not refused: $(cat "$TASK_DIR/mix-$i")"
done
[[ "$(sql "select count(*) from public.orders where id::text between '${PREFIX}20' and '${PREFIX}27' and notes is null and priority='normal' and row_version=0")" == 8 ]] \
  || fail 'RPC + PATCH: something was written'
echo 'PASS: eight RPC + PATCH transactions refused whole, nothing written'
