#!/usr/bin/env bash
# Addendum 02 · automatic finish. Real concurrent sessions against a local
# database. Every psql call is a NEW session (gestcopy.* and app.* markers
# unset), like a fresh pooled connection. Cleanup always runs.
#   A1. Two people complete the last two steps at the same time -> one transition.
#   A2. Four sessions mark the same last step -> one write, one transition.
#   A3. The last step is marked while another session holds the order (in both
#       orders of arrival) -> one transition, two version bumps.
#   A4. Someone sets «Entregado» while the last step is being marked (both
#       orders) -> a delivered order is never moved to «Listo».
set -euo pipefail

DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e6710000-0000-4000-8000-000000000011'
OWNER='e6710000-0000-4000-8000-000000000001'
STAFF='e6710000-0000-4000-8000-000000000002'
RAQUEL='e6710000-0000-4000-8000-000000000031'
JESUS='e6710000-0000-4000-8000-000000000032'
P='e6710000-0000-4000-8000-0000000001'
TASK_DIR="$(mktemp -d)"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
as_user() { # $1 user, $2 statements (run inside one transaction)
  echo "begin;select set_config('request.jwt.claim.sub','$1',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;$2;commit;"
}
as_owner_postgres() {
  echo "begin;select set_config('request.jwt.claim.sub','$OWNER',true);select set_config('request.jwt.claim.role','authenticated',true);$1;commit;"
}
rpc() { sql "$(as_user "${2:-$STAFF}" "select $1")" | tail -1; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  sql "delete from public.tenants where id='$TENANT';delete from auth.users where id in ('$OWNER','$STAFF');" >/dev/null || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT

sql "insert into auth.users(id,email,raw_user_meta_data) values('$OWNER','owner@phase67c.test','{}'),('$STAFF','staff@phase67c.test','{}');
insert into public.profiles(id,full_name) values('$OWNER','Tamara'),('$STAFF','Raquel');
insert into public.tenants(id,name,slug,active) values('$TENANT','Auto finish concurrency','phase67conc',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$OWNER','owner',true),('$TENANT','$STAFF','staff',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled) values
  ('$TENANT','Recibido','received',true,1,true,false,false,false),
  ('$TENANT','Terminado','terminado',true,2,false,true,false,false),
  ('$TENANT','Entregado','delivered',true,3,false,false,true,false);
select public.set_tenant_feature('phase67conc','order_work_sequence',true,null);" >/dev/null
sql "$(as_owner_postgres "insert into public.team_members(id,tenant_id,name,active,can_receive_orders,user_id) values
  ('$RAQUEL','$TENANT','Raquel',true,true,'$STAFF'),('$JESUS','$TENANT','Jesús',true,true,null)")" >/dev/null
[[ "$(rpc "public.create_suggested_work_stages_v1('$TENANT')->>'created'" "$OWNER")" == 4 ]] || fail 'suggested stages'
STAGE="$(sql "select id from public.work_stages where tenant_id='$TENANT' and name='Diseño'")"
DELIVERED="$(sql "select id from public.order_statuses where tenant_id='$TENANT' and code='delivered'")"

new_order() { # $1 id; two pending steps (Raquel, Jesús)
  sql "$(as_user "$OWNER" "insert into public.orders(id,tenant_id,title,status_id,created_by) select '$1','$TENANT','Concurrente',id,'$OWNER' from public.order_statuses where tenant_id='$TENANT' and code='received'")" >/dev/null
  local v
  v="$(version "$1")"
  [[ "$(rpc "public.replace_order_work_steps_v1('$1','$v','[{\"stage_id\":\"$STAGE\",\"team_member_id\":\"$RAQUEL\"},{\"stage_id\":\"$STAGE\",\"team_member_id\":\"$JESUS\"}]'::jsonb)->>'error'")" == "" ]] || fail "fixture $1"
}
version() { sql "select row_version::text from public.orders where id='$1'"; }
step_at() { sql "select id from public.order_work_steps where order_id='$1' and position=$2"; }
status_of() { sql "select st.code from public.orders o join public.order_statuses st on st.tenant_id=o.tenant_id and st.id=o.status_id where o.id='$1'"; }
transitions() { sql "select count(*) from public.activity_log where entity_id='$1' and action='order.status_changed'"; }
auto_transitions() { sql "select count(*) from public.activity_log where entity_id='$1' and action='order.status_changed' and (metadata->>'automatic')::boolean"; }

# A1. Five orders; on each, two sessions mark the two last steps at once.
for n in 1 2 3 4 5; do
  O="${P}1$n"
  new_order "$O"
  V="$(version "$O")"
  S1="$(step_at "$O" 1)"; S2="$(step_at "$O" 2)"
  rpc "public.set_order_work_step_done_v1('$S1',true)->>'changed'" > "$TASK_DIR/a1-$n-1" &
  rpc "public.set_order_work_step_done_v1('$S2',true)->>'changed'" "$OWNER" > "$TASK_DIR/a1-$n-2" &
  wait
  [[ "$(cat "$TASK_DIR/a1-$n-1" "$TASK_DIR/a1-$n-2" | tr '\n' ' ')" == "true true " ]] || fail "A1/$n: both marks must write"
  [[ "$(status_of "$O")" == terminado ]] || fail "A1/$n: order must be Terminado, is $(status_of "$O")"
  [[ "$(transitions "$O")" == 1 && "$(auto_transitions "$O")" == 1 ]] || fail "A1/$n: exactly one automatic transition, got $(transitions "$O")"
  [[ "$(version "$O")" == "$((V + 2))" ]] || fail "A1/$n: two marks = two version bumps, got $(version "$O") from $V"
done
echo 'PASS A1: two people finish the last two steps at once (x5), one automatic transition each, two bumps'

# A2. Four sessions mark the same last step.
O="${P}21"
new_order "$O"
[[ "$(rpc "public.set_order_work_step_done_v1('$(step_at "$O" 1)',true)->>'changed'")" == true ]] || fail 'A2 fixture'
V="$(version "$O")"
S2="$(step_at "$O" 2)"
for n in 1 2 3 4; do
  rpc "public.set_order_work_step_done_v1('$S2',true)->>'changed'" > "$TASK_DIR/a2-$n" &
done
wait
[[ "$(cat "$TASK_DIR"/a2-* | sort | tr '\n' ' ')" == "false false false true " ]] || fail "A2: expected one write, got $(cat "$TASK_DIR"/a2-* | tr '\n' ' ')"
[[ "$(transitions "$O")" == 1 && "$(status_of "$O")" == terminado ]] || fail 'A2: one transition'
[[ "$(version "$O")" == "$((V + 1))" ]] || fail 'A2: one version bump for step + status'
echo 'PASS A2: four marks of the last step, one write, one transition, one bump'

# A3. The first session holds the order lock while the second marks the last step.
for round in first-holds last-holds; do
  O="${P}31"; [[ "$round" == last-holds ]] && O="${P}32"
  new_order "$O"
  V="$(version "$O")"
  S1="$(step_at "$O" 1)"; S2="$(step_at "$O" 2)"
  if [[ "$round" == first-holds ]]; then HOLD="$S1"; LATE="$S2"; else HOLD="$S2"; LATE="$S1"; fi
  sql "$(as_user "$STAFF" "select public.set_order_work_step_done_v1('$HOLD',true);select pg_sleep(0.8)")" > /dev/null &
  sleep 0.3
  r="$(rpc "public.set_order_work_step_done_v1('$LATE',true)->>'order_status'" "$OWNER")"
  wait
  [[ -n "$r" ]] || fail "A3 $round: the session that completes the sequence carries order_status"
  [[ "$(transitions "$O")" == 1 && "$(status_of "$O")" == terminado ]] || fail "A3 $round: one transition"
  [[ "$(version "$O")" == "$((V + 2))" ]] || fail "A3 $round: two bumps"
done
echo 'PASS A3: last step marked while the other is in flight (both orders), one transition'

# A4. «Entregado» and the last step race (both orders of arrival).
for round in deliver-first mark-first; do
  O="${P}41"; [[ "$round" == mark-first ]] && O="${P}42"
  new_order "$O"
  [[ "$(rpc "public.set_order_work_step_done_v1('$(step_at "$O" 1)',true)->>'changed'")" == true ]] || fail 'A4 fixture'
  V="$(version "$O")"
  S2="$(step_at "$O" 2)"
  if [[ "$round" == deliver-first ]]; then
    sql "$(as_user "$OWNER" "select public.change_order_status_v2('$O','$DELIVERED','$TENANT',$V);select pg_sleep(0.8)")" > /dev/null &
    sleep 0.3
    rpc "public.set_order_work_step_done_v1('$S2',true)->>'changed'" > /dev/null
    wait
    [[ "$(status_of "$O")" == delivered ]] || fail "A4 $round: a delivered order is never moved, is $(status_of "$O")"
    [[ "$(auto_transitions "$O")" == 0 && "$(transitions "$O")" == 1 ]] || fail "A4 $round: only the manual transition"
    [[ "$(sql "select metadata->'auto_finish'->>'reason' from public.activity_log where entity_id='$O' and action='order.work_step_completed' and new_values->>'step_id'='$S2'")" == order_closed ]] || fail "A4 $round: reason order_closed"
  else
    sql "$(as_user "$STAFF" "select public.set_order_work_step_done_v1('$S2',true);select pg_sleep(0.8)")" > /dev/null &
    sleep 0.3
    # The manual change waits for the lock, then its version is stale (GCO01).
    if sql "$(as_user "$OWNER" "select public.change_order_status_v2('$O','$DELIVERED','$TENANT',$V)")" > /dev/null 2>&1; then
      wait; fail "A4 $round: the stale manual change must be refused"
    fi
    wait
    [[ "$(status_of "$O")" == terminado && "$(auto_transitions "$O")" == 1 ]] || fail "A4 $round: automatic finish kept"
    W="$(version "$O")"
    sql "$(as_user "$OWNER" "select public.change_order_status_v2('$O','$DELIVERED','$TENANT',$W)")" > /dev/null
    [[ "$(status_of "$O")" == delivered && "$(transitions "$O")" == 2 ]] || fail "A4 $round: delivering after it works"
    [[ "$(sql "select (ready_at is not null and delivered_at is not null)::text from public.orders where id='$O'")" == true ]] || fail "A4 $round: dates"
  fi
done
echo 'PASS A4: delivered vs last step in both orders, a delivered order is never moved to Terminado'

echo 'phase67 auto finish concurrency: PASS'
