#!/usr/bin/env bash
# P0 hotfix. Every psql call is a NEW session, so gestcopy.order_total_write was never
# set (NULL): the state of a fresh pooled connection. Direct writes to
# orders.total_amount must be refused for any role, while the RPCs still work.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e5210000-0000-4000-8000-000000000011'
OTHER='e5210000-0000-4000-8000-000000000012'
ACTOR='e5210000-0000-4000-8000-000000000001'
OTHER_ACTOR='e5210000-0000-4000-8000-000000000002'
ORDER='e5210000-0000-4000-8000-000000000031'
OTHER_ORDER='e5210000-0000-4000-8000-000000000032'

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
as_user() { # $1 actor, $2 statement
  echo "begin;select set_config('request.jwt.claim.sub','$1',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;$2;commit;"
}
rpc() { sql "$(as_user "$1" "select $2")" | tail -1; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  sql "delete from public.tenants where id in ('$TENANT','$OTHER');delete from auth.users where id in ('$ACTOR','$OTHER_ACTOR');" >/dev/null || true
}
trap cleanup EXIT

sql "insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','a@phase52f.test','{}'),('$OTHER_ACTOR','b@phase52f.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR','A'),('$OTHER_ACTOR','B');
insert into public.tenants(id,name,slug,active) values('$TENANT','Guard A','phase52fa',true),('$OTHER','Guard B','phase52fb',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','owner',true),('$OTHER','$OTHER_ACTOR','owner',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled)
values('$TENANT','Recibido','received',true,1,true,false,false,false),('$OTHER','Recibido','received',true,1,true,false,false,false);" >/dev/null
sql "$(as_user "$ACTOR" "insert into public.orders(id,tenant_id,title,status_id) select '$ORDER','$TENANT','A',id from public.order_statuses where tenant_id='$TENANT' and is_initial")" >/dev/null
sql "$(as_user "$OTHER_ACTOR" "insert into public.orders(id,tenant_id,title,status_id) select '$OTHER_ORDER','$OTHER','B',id from public.order_statuses where tenant_id='$OTHER' and is_initial")" >/dev/null

version() { sql "select row_version::text from public.orders where id='$1'"; }
refused() { # $1 actor (or empty = privileged), $2 statement, $3 expected message
  local out
  if [[ -n "$1" ]]; then
    out="$(sql "$(as_user "$1" "$2")" 2>&1)" && fail "direct write succeeded on a fresh session: $2"
  else
    out="$(sql "$2" 2>&1)" && fail "privileged direct write succeeded on a fresh session: $2"
  fi
  [[ "$out" == *"$3"* ]] || fail "wrong refusal for [$2]: $out"
}

# 1. Fresh sessions, no flag: refused, repeatedly (each attempt is a new connection).
for _ in 1 2 3 4 5; do
  refused "$ACTOR" "update public.orders set total_amount=5 where id='$ORDER'" 'total_amount_rpc_only'
done
refused "" "update public.orders set total_amount=5 where id='$ORDER'" 'total_amount_rpc_only'
# Since 20261022120000 authenticated cannot name total_amount in an INSERT; privileged roles still hit the guard.
refused "$ACTOR" "insert into public.orders(tenant_id,title,status_id,total_amount) select '$TENANT','x',id,9 from public.order_statuses where tenant_id='$TENANT' and is_initial" 'permission denied for table orders'
refused "" "insert into public.orders(tenant_id,title,status_id,total_amount) select '$TENANT','x',id,9 from public.order_statuses where tenant_id='$TENANT' and is_initial" 'total_amount_rpc_only'
[[ "$(sql "select coalesce(total_amount::text,'null') from public.orders where id='$ORDER'")" == null ]] || fail "total changed"
echo 'PASS: five fresh authenticated sessions and a fresh privileged session cannot write total_amount'

# 2. The RPC works from a fresh session and does not leave the door open for the next one.
[[ "$(rpc "$ACTOR" "public.set_order_total_amount('$ORDER','100.00','$(version "$ORDER")')->>'total_amount'")" == "100.00" ]] || fail "RPC failed"
refused "$ACTOR" "update public.orders set total_amount=5 where id='$ORDER'" 'total_amount_rpc_only'
echo 'PASS: set_order_total_amount works on a fresh session; the next fresh session is still refused'

# 3. Collections: the RPC refuses a total below what was collected, from fresh sessions too.
[[ "$(rpc "$ACTOR" "public.record_order_payment('$ORDER','60.00','2026-10-16T12:00:00Z','fresh-pay-phase52','cash',null,'$TENANT')->>'ok'")" == "true" ]] || fail "payment failed"
[[ "$(rpc "$ACTOR" "public.set_order_total_amount('$ORDER','59.99','$(version "$ORDER")')->>'error'")" == "total_below_paid" ]] || fail "total below collections was accepted"
refused "$ACTOR" "update public.orders set total_amount=59.99 where id='$ORDER'" 'total_amount_rpc_only'
[[ "$(sql "select total_amount::text from public.orders where id='$ORDER'")" == "100.00" ]] || fail "total changed"
echo 'PASS: collections still protect the total from fresh sessions'

# 4. Tenant isolation from fresh sessions.
[[ "$(rpc "$OTHER_ACTOR" "public.set_order_total_amount('$ORDER','1.00','$(version "$ORDER")')->>'error'")" == "not_found" ]] || fail "cross-tenant RPC was not refused"
[[ "$(sql "$(as_user "$OTHER_ACTOR" "with u as (update public.orders set total_amount=1 where id='$ORDER' returning 1) select count(*) from u")" | tail -1)" == "0" ]] || fail "cross-tenant direct UPDATE touched a row"
refused "$OTHER_ACTOR" "update public.orders set total_amount=1 where id='$OTHER_ORDER'" 'total_amount_rpc_only'
[[ "$(sql "select total_amount::text from public.orders where id='$ORDER'")" == "100.00" ]] || fail "tenant A total changed"
echo 'PASS: tenant isolation holds from fresh sessions'
