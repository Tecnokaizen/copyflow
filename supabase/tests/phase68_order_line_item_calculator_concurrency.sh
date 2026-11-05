#!/usr/bin/env bash
# Order total calculator (PR #188). Real concurrent sessions against a LOCAL
# database: what the dialog reads and saves when other people write meanwhile.
# Every psql call is a new session. Cleanup always runs.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e5680000-0000-4000-8000-000000000011'
ACTOR_A='e5680000-0000-4000-8000-000000000001'
ACTOR_B='e5680000-0000-4000-8000-000000000002'
ORDER_PREFIX='e5680000-0000-4000-8000-0000000001'
TASK_DIR="$(mktemp -d)"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
as_user() { # $1 actor, $2 statements (run as authenticated, RLS on)
  echo "begin;select set_config('request.jwt.claim.sub','$1',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;$2;commit;"
}
rpc() { sql "$(as_user "$1" "select $2")" | tail -1; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  sql "delete from public.tenants where id='$TENANT';delete from auth.users where id in ('$ACTOR_A','$ACTOR_B');" >/dev/null || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT

sql "insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR_A','a@phase68.test','{}'),('$ACTOR_B','b@phase68.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR_A','Ana'),('$ACTOR_B','Beto');
insert into public.tenants(id,name,slug,active) values('$TENANT','Calculator concurrency','phase68conc',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR_A','owner',true),('$TENANT','$ACTOR_B','staff',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled)
values('$TENANT','Recibido','received',true,1,true,false,false,false);" >/dev/null

new_order() { # $1 = order id
  sql "$(as_user "$ACTOR_A" "insert into public.orders(id,tenant_id,title,status_id) select '$1','$TENANT','Calculadora',id from public.order_statuses where tenant_id='$TENANT' and is_initial")" >/dev/null
}
activity() { sql "select count(*) from public.activity_log where entity_id='$1'"; }
version() { sql "select row_version::text from public.orders where id='$1'"; }
line() { # $1 concept, $2 price, $3 discount
  printf '{"concept":"%s","quantity":"1","unit_price":"%s","discount_percent":"%s","tax_rate":"0"}' "$1" "$2" "${3:-0}"
}
# What GET /api/orders/[id]/items runs: the order with its lines embedded in ONE
# statement (PostgREST builds a single query), as a member with RLS on.
snapshot() { # $1 order → "version|total|mode|concepts"
  sql "$(as_user "$ACTOR_A" "select o.row_version::text||'|'||coalesce(o.total_amount::text,'null')||'|'||o.total_mode||'|'||coalesce((select string_agg(i.concept||':'||i.discount_percent::numeric(5,2)::text, ',' order by i.position) from public.order_items i where i.tenant_id=o.tenant_id and i.order_id=o.id),'') from public.orders o where o.id='$1' and o.tenant_id='$TENANT'")" | tail -1
}

# 1. A write happens while the dialog loads the order and its lines.
O1="${ORDER_PREFIX}11"
new_order "$O1"
rpc "$ACTOR_A" "public.replace_order_items_v1('$O1','$(version "$O1")','[$(line Antes 10.00)]'::jsonb,'items')->>'error'" >/dev/null
V1="$(version "$O1")"
before="$(snapshot "$O1")"
[[ "$before" == "$V1|10.00|items|Antes:0.00" ]] || fail "unexpected initial snapshot $before"
# Writer holds its uncommitted change for 3 s.
sql "$(as_user "$ACTOR_B" "select public.replace_order_items_v1('$O1','$V1','[$(line Despues 20.00)]'::jsonb,'items');select pg_sleep(3)")" >/dev/null &
writer=$!
sleep 1
during="$(snapshot "$O1")"
[[ "$during" == "$before" ]] || fail "single-statement read during the write is not the previous snapshot: $during"
# Control: the old two-read shape (order first, lines after the commit) mixes moments.
sql "$(as_user "$ACTOR_A" "select 'order:'||row_version::text||'|'||total_amount::text from public.orders where id='$O1';select pg_sleep(3);select 'lines:'||string_agg(concept, ',') from public.order_items where order_id='$O1'")" > "$TASK_DIR/two-reads" &
reader=$!
wait "$writer"
wait "$reader"
grep -qx "order:$V1|10.00" "$TASK_DIR/two-reads" || fail "control read did not see the old order row: $(cat "$TASK_DIR/two-reads")"
grep -qx "lines:Despues" "$TASK_DIR/two-reads" || fail "control read did not see the new lines: $(cat "$TASK_DIR/two-reads")"
after="$(snapshot "$O1")"
[[ "$after" == "$((V1 + 1))|20.00|items|Despues:0.00" ]] || fail "snapshot after the commit is $after"
echo "PASS: a load during a write returns one coherent snapshot (old, then new); two separate reads would mix old version with new lines"

# 2. Someone changes the direct amount while another person has the dialog open.
O2="${ORDER_PREFIX}21"
new_order "$O2"
rpc "$ACTOR_A" "public.set_order_total_amount('$O2','50.00','$(version "$O2")')->>'ok'" >/dev/null
seen="$(snapshot "$O2")"          # Ana opens the dialog: 50.00 with its version
VA="${seen%%|*}"
[[ "$(rpc "$ACTOR_B" "public.set_order_total_amount('$O2','80.00','$VA')->>'ok'")" == true ]] || fail "Beto could not change the total"
[[ "$(rpc "$ACTOR_A" "public.set_order_total_amount('$O2','60.00','$VA')->>'error'")" == conflict ]] || fail "stale direct save was not a conflict"
[[ "$(snapshot "$O2")" == "$((VA + 1))|80.00|manual|" ]] || fail "stale direct save overwrote Beto's total"
# Ana has now seen 80.00 and explicitly overwrites with the version she saw.
[[ "$(rpc "$ACTOR_A" "public.set_order_total_amount('$O2','60.00','$((VA + 1))')->>'ok'")" == true ]] || fail "explicit overwrite failed"
[[ "$(sql "select total_amount::text from public.orders where id='$O2'")" == 60.00 ]] || fail "explicit overwrite not saved"
echo 'PASS: a direct amount changed meanwhile is a conflict; only a save with the version the user has seen succeeds'

# 3. Two people edit lines; the second save conflicts and a hidden discount survives.
O3="${ORDER_PREFIX}31"
new_order "$O3"
rpc "$ACTOR_A" "public.replace_order_items_v1('$O3','$(version "$O3")','[$(line Copias 10.00)]'::jsonb,'items')->>'error'" >/dev/null
V3="$(version "$O3")"             # both open the dialog at V3
[[ "$(rpc "$ACTOR_B" "public.replace_order_items_v1('$O3','$V3','[$(line Copias 10.00 5),$(line Grapado 2.00)]'::jsonb,'items')->>'error'")" == "" ]] || fail "Beto could not save lines"
saved_b="$(snapshot "$O3")"
[[ "$saved_b" == "$((V3 + 1))|11.50|items|Copias:5.00,Grapado:0.00" ]] || fail "Beto's lines are $saved_b"
activity_before="$(activity "$O3")"
# Ana's draft (no discount column in V1) with the version she loaded.
[[ "$(rpc "$ACTOR_A" "public.replace_order_items_v1('$O3','$V3','[$(line Copias 12.00)]'::jsonb,'items')->>'error'")" == conflict ]] || fail "second lines save was not a conflict"
[[ "$(rpc "$ACTOR_A" "public.set_order_manual_total_v1('$O3','30.00','$V3')->>'error'")" == conflict ]] || fail "stale switch to a direct amount was not a conflict"
[[ "$(snapshot "$O3")" == "$saved_b" ]] || fail "a stale save touched Beto's lines or discount"
[[ "$(activity "$O3")" == "$activity_before" ]] || fail "a refused save left an activity row"
echo 'PASS: concurrent line edits: the stale save conflicts and the other person'"'"'s lines and 5 % discount stay intact'

# 4. A payment lands while the total is lowered below it: refused, nothing partial.
lower_vs_payment() { # $1 order suffix, $2 call that lowers the total to 50.00 (uses $V)
  local O="${ORDER_PREFIX}$1" before_state result call
  new_order "$O"
  rpc "$ACTOR_A" "public.replace_order_items_v1('$O','$(version "$O")','[$(line Base 100.00)]'::jsonb,'items')->>'error'" >/dev/null
  V="$(version "$O")"
  before_state="$(snapshot "$O")"
  # The payment holds the order row lock for 2 s before committing.
  sql "$(as_user "$ACTOR_B" "select public.record_order_payment('$O','60.00','2026-11-05T10:00:00Z','phase68-pay-$1-aaaa','cash',null,'$TENANT');select pg_sleep(2)")" >/dev/null &
  local payer=$!
  sleep 0.5
  call="${2//\$O/$O}"
  result="$(rpc "$ACTOR_A" "${call//\$V/$V}")"
  wait "$payer"
  [[ "$result" == total_below_paid ]] || fail "order $1: expected total_below_paid, got '$result'"
  [[ "$(snapshot "$O")" == "$before_state" ]] || fail "order $1: total, mode, lines or version changed: $(snapshot "$O")"
  [[ "$(sql "select coalesce(sum(amount),0)::text from public.order_payments where order_id='$O' and voided_at is null")" == 60.00 ]] || fail "order $1: payment missing"
  [[ "$(sql "select count(*) from public.activity_log where entity_id='$O' and action='order.total_changed'")" == 0 ]] || fail "order $1: refused change was logged"
}
V=''
lower_vs_payment 41 "public.set_order_manual_total_v1('\$O','50.00','\$V')->>'error'"
lower_vs_payment 42 "public.replace_order_items_v1('\$O','\$V','[$(line Rebaja 50.00)]'::jsonb,'items')->>'error'"
echo 'PASS: a simultaneous payment above the new total makes the database refuse it; no partial write (mode, total, lines, version intact)'
