#!/usr/bin/env bash
# R5 (20261022120000). Every psql call is a NEW session, so app.order_write was
# never set (NULL): the state of a fresh pooled connection. Direct writes to
# public.orders must be refused, the RPCs must keep working, and an RPC must not
# leave the marker open for the rest of its transaction or for the next session.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e5820000-0000-4000-8000-000000000011'
ACTOR='e5820000-0000-4000-8000-000000000001'
ORDER='e5820000-0000-4000-8000-000000000031'
BLOCKED='orders can only change through controlled RPCs'

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
as_user() { # $1 actor, $2 statements
  echo "begin;select set_config('request.jwt.claim.sub','$1',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;$2;commit;"
}
fail() { echo "FAIL: $*" >&2; exit 1; }
version() { sql "select row_version::text from public.orders where id='$ORDER'"; }
refused() { # $1 statements (run as the actor), $2 expected message
  local out
  out="$(sql "$(as_user "$ACTOR" "$1")" 2>&1)" && fail "direct write succeeded: $1"
  [[ "$out" == *"$2"* ]] || fail "wrong refusal for [$1]: $out"
}

cleanup() {
  sql "delete from public.tenants where id='$TENANT';delete from auth.users where id='$ACTOR';" >/dev/null || true
}
trap cleanup EXIT
cleanup

sql "insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','a@phase58f.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR','A');
insert into public.tenants(id,name,slug,active) values('$TENANT','Guard R5','phase58f',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','staff',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled)
values('$TENANT','Recibido','received',true,1,true,false,false,false);" >/dev/null
sql "$(as_user "$ACTOR" "insert into public.orders(id,tenant_id,title,status_id,created_by) select '$ORDER','$TENANT','A',id,'$ACTOR' from public.order_statuses where tenant_id='$TENANT' and is_initial")" >/dev/null

# 1. Fresh sessions: the marker is NULL and every direct UPDATE is refused.
for _ in 1 2 3 4 5; do
  [[ "$(sql "select coalesce(current_setting('app.order_write', true), '<null>')")" == '<null>' ]] || fail 'marker set on a fresh session'
  refused "update public.orders set notes='x' where id='$ORDER'" "$BLOCKED"
done
echo 'PASS: five fresh sessions cannot update orders directly'

# 2. An RPC works from a fresh session and closes the marker before it returns:
#    a direct UPDATE later in the SAME transaction is still refused.
refused "select public.change_order_content_v2('$ORDER','notes','via RPC','$TENANT',$(version));
update public.orders set priority='urgent' where id='$ORDER'" "$BLOCKED"
[[ "$(sql "select coalesce(notes,'') from public.orders where id='$ORDER'")" == '' ]] || fail 'the refused transaction was not rolled back'
out="$(sql "$(as_user "$ACTOR" "select public.change_order_content_v2('$ORDER','notes','via RPC','$TENANT',$(version))->>'version';select 'marker=' || coalesce(current_setting('app.order_write', true), '<null>')")")"
[[ "$(echo "$out" | grep '^marker=')" == 'marker=' ]] || fail "marker left open after the RPC: $out"
[[ "$(sql "select notes from public.orders where id='$ORDER'")" == 'via RPC' ]] || fail 'RPC did not write'
echo 'PASS: the RPC works and leaves the marker closed in its own transaction'

# 3. The next fresh session is refused again.
refused "update public.orders set notes='forged' where id='$ORDER'" "$BLOCKED"
[[ "$(sql "select notes from public.orders where id='$ORDER'")" == 'via RPC' ]] || fail 'notes changed'
echo 'PASS: the next fresh session is still refused'
