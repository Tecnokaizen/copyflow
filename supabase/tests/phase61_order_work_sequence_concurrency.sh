#!/usr/bin/env bash
# SUR4 E7 · work sequence. Real concurrent sessions against a local database
# (C1, C2/C11, C3, C4, C8, C12, C13, C14 of the SUR4 document). Every psql call
# is a NEW session: the gestcopy.* markers are unset (NULL), like a fresh pooled
# connection. Cleanup always runs and removes the tenant (purge path included).
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e6110000-0000-4000-8000-000000000011'
OWNER='e6110000-0000-4000-8000-000000000001'
STAFF='e6110000-0000-4000-8000-000000000002'
RAQUEL='e6110000-0000-4000-8000-000000000031'
JESUS='e6110000-0000-4000-8000-000000000032'
DAVINIA='e6110000-0000-4000-8000-000000000033'
P='e6110000-0000-4000-8000-0000000001'
TASK_DIR="$(mktemp -d)"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
as_user() { # $1 user, $2 statements (run inside one transaction)
  echo "begin;select set_config('request.jwt.claim.sub','$1',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;$2;commit;"
}
# As postgres with the owner's claims (activity triggers need an actor).
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

sql "insert into auth.users(id,email,raw_user_meta_data) values('$OWNER','owner@phase61c.test','{}'),('$STAFF','staff@phase61c.test','{}');
insert into public.profiles(id,full_name) values('$OWNER','Tamara'),('$STAFF','Raquel');
insert into public.tenants(id,name,slug,active) values('$TENANT','Sequence concurrency','phase61conc',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$OWNER','owner',true),('$TENANT','$STAFF','staff',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled) values
  ('$TENANT','Recibido','received',true,1,true,false,false,false),
  ('$TENANT','Entregado','delivered',true,2,false,false,true,false);
select public.set_tenant_feature('phase61conc','order_work_sequence',true,null);" >/dev/null
sql "$(as_owner_postgres "insert into public.team_members(id,tenant_id,name,active,can_receive_orders,user_id) values
  ('$RAQUEL','$TENANT','Raquel',true,true,'$STAFF'),('$JESUS','$TENANT','Jesús',true,true,null),('$DAVINIA','$TENANT','Davinia',true,true,null)")" >/dev/null
[[ "$(rpc "public.create_suggested_work_stages_v1('$TENANT')->>'created'" "$OWNER")" == 4 ]] || fail 'suggested stages'
STAGE="$(sql "select id from public.work_stages where tenant_id='$TENANT' and name='Diseño'")"
STAGE2="$(sql "select id from public.work_stages where tenant_id='$TENANT' and name='Impresión'")"

new_order() { # $1 id, $2 status code
  sql "$(as_user "$OWNER" "insert into public.orders(id,tenant_id,title,status_id,created_by) select '$1','$TENANT','Concurrente',id,'$OWNER' from public.order_statuses where tenant_id='$TENANT' and code='${2:-received}'")" >/dev/null
}
version() { sql "select row_version::text from public.orders where id='$1'"; }
steps_json() { # people... -> jsonb array, one step per person (or null)
  local out='' sep='' m
  for m in "$@"; do
    if [[ "$m" == null ]]; then out+="${sep}{\"stage_id\":\"$STAGE\"}"; else out+="${sep}{\"stage_id\":\"$STAGE\",\"team_member_id\":\"$m\"}"; fi
    sep=','
  done
  echo "[$out]"
}
replace() { # $1 order, $2 version, $3 json
  rpc "public.replace_order_work_steps_v1('$1','$2','$3'::jsonb)->>'error'"
}
step_at() { sql "select id from public.order_work_steps where order_id='$1' and position=$2"; }
reactivate() { sql "$(as_owner_postgres "update public.team_members set active=true where id in ('$RAQUEL','$JESUS','$DAVINIA')")" >/dev/null; }

# C1. Four sessions replace the sequence with the same version.
O="${P}01"
new_order "$O"
V="$(version "$O")"
for n in 1 2 3 4; do
  people=()
  for k in $(seq 1 "$n"); do people+=("$RAQUEL"); done
  replace "$O" "$V" "$(steps_json "${people[@]}")" > "$TASK_DIR/c1-$n" &
done
wait
ok_count="$(awk '$0=="" {n++} END {print n+0}' "$TASK_DIR"/c1-*)"
conflicts="$(awk '$0=="conflict" {n++} END {print n+0}' "$TASK_DIR"/c1-*)"
[[ "$ok_count" == 1 && "$conflicts" == 3 ]] || fail "C1: expected 1 winner and 3 conflicts, got $ok_count/$conflicts"
winner="$(grep -l '^$' "$TASK_DIR"/c1-* | sed 's/.*c1-//')"
[[ "$(sql "select count(*) from public.order_work_steps where order_id='$O'")" == "$winner" ]] || fail 'C1: steps mixed between sessions'
[[ "$(version "$O")" == "$((V + 1))" ]] || fail 'C1: one version bump'
[[ "$(sql "select count(*) from public.activity_log where entity_id='$O' and action='order.work_steps_changed'")" == 1 ]] || fail 'C1: one activity row'
echo "PASS C1: four replaces with one version, one winner ($winner steps), three conflicts, nothing mixed"

# C2 + C11. Four sessions mark the same step, each with another executor.
O="${P}02"
new_order "$O"
[[ "$(replace "$O" "$(version "$O")" "$(steps_json "$RAQUEL" "$JESUS")")" == "" ]] || fail 'C2 fixture'
S1="$(step_at "$O" 1)"
V="$(version "$O")"
executors=("$RAQUEL" "$JESUS" "$DAVINIA" "$RAQUEL")
for n in 0 1 2 3; do
  rpc "public.set_order_work_step_done_v1('$S1',true,'${executors[$n]}')->>'changed'" > "$TASK_DIR/c2-$n" &
done
wait
[[ "$(cat "$TASK_DIR"/c2-* | sort | tr '\n' ' ')" == "false false false true " ]] || fail "C2: expected one write, got $(cat "$TASK_DIR"/c2-* | tr '\n' ' ')"
[[ "$(version "$O")" == "$((V + 1))" ]] || fail 'C2: the later marks do not bump the version'
[[ "$(sql "select count(*) from public.activity_log where entity_id='$O' and action='order.work_step_completed'")" == 1 ]] || fail 'C2: one completed event'
first_exec="$(sql "select new_values->>'executed_by_team_member_id' from public.activity_log where entity_id='$O' and action='order.work_step_completed'")"
[[ "$(sql "select executed_by_team_member_id from public.order_work_steps where id='$S1'")" == "$first_exec" ]] || fail 'C11: the stored executor is the first one'
echo 'PASS C2/C11: four marks with different executors, one write, one event, the first executor kept'

# C3. Mark a step while another session reorders (both orders of arrival).
for round in mark-first replace-first; do
  O="${P}03"; [[ "$round" == replace-first ]] && O="${P}13"
  new_order "$O"
  [[ "$(replace "$O" "$(version "$O")" "$(steps_json "$RAQUEL" "$JESUS" "$DAVINIA")")" == "" ]] || fail 'C3 fixture'
  A="$(step_at "$O" 1)"; B="$(step_at "$O" 2)"; C="$(step_at "$O" 3)"
  V="$(version "$O")"
  reorder="[{\"id\":\"$C\",\"stage_id\":\"$STAGE\",\"team_member_id\":\"$DAVINIA\"},{\"id\":\"$A\",\"stage_id\":\"$STAGE\",\"team_member_id\":\"$RAQUEL\"},{\"id\":\"$B\",\"stage_id\":\"$STAGE\",\"team_member_id\":\"$JESUS\"}]"
  if [[ "$round" == mark-first ]]; then
    sql "$(as_user "$STAFF" "select public.set_order_work_step_done_v1('$A',true);select pg_sleep(0.8)")" > /dev/null &
    sleep 0.3
    # The replace waits for the order lock, then its version is stale.
    r="$(replace "$O" "$V" "$reorder")"
    wait
    [[ "$r" == conflict ]] || fail "C3 $round: the reorder must see the new version, got '$r'"
    r="$(replace "$O" "$(version "$O")" "$reorder")"
    [[ "$r" == "" ]] || fail "C3 $round: reorder after the mark failed: $r"
  else
    sql "$(as_user "$STAFF" "select public.replace_order_work_steps_v1('$O','$V','$reorder'::jsonb);select pg_sleep(0.8)")" > /dev/null &
    sleep 0.3
    r="$(rpc "public.set_order_work_step_done_v1('$A',true)->>'error'")"
    wait
    [[ "$r" == "" ]] || fail "C3 $round: mark after the reorder failed: $r"
  fi
  [[ "$(sql "select count(*) from public.order_work_steps where order_id='$O' and is_current")" == 1 ]] || fail "C3 $round: one current step"
  [[ "$(sql "select position from public.order_work_steps where order_id='$O' and is_current")" == 1 ]] || fail "C3 $round: le toca is Davinia, first not done"
  [[ "$(sql "select completed_at is not null from public.order_work_steps where id='$A'")" == t ]] || fail "C3 $round: the mark survived"
done
echo 'PASS C3: mark and reorder in both orders, one current step, nothing lost'

# C8. Deactivate a person while another session assigns them (both orders).
O="${P}08"
new_order "$O"
sql "$(as_owner_postgres "update public.team_members set active=false where id='$DAVINIA';select pg_sleep(0.8)")" > /dev/null &
sleep 0.3
r="$(replace "$O" "$(version "$O")" "$(steps_json "$DAVINIA")")"
wait
[[ "$r" == member_unassignable ]] || fail "C8 deactivate-first: expected member_unassignable, got '$r'"
[[ "$(sql "select count(*) from public.order_work_steps where order_id='$O'")" == 0 ]] || fail 'C8: nothing written'
reactivate
sql "$(as_user "$STAFF" "select public.replace_order_work_steps_v1('$O','$(version "$O")','$(steps_json "$DAVINIA")'::jsonb);select pg_sleep(0.8)")" > /dev/null &
sleep 0.3
sql "$(as_owner_postgres "update public.team_members set active=false where id='$DAVINIA'")" > /dev/null
wait
[[ "$(sql "select count(*) from public.order_work_steps where order_id='$O' and team_member_id='$DAVINIA'")" == 1 ]] || fail 'C8 assign-first: the step went in before the deactivation'
[[ "$(sql "select active from public.team_members where id='$DAVINIA'")" == f ]] || fail 'C8 assign-first: the deactivation waited and applied'
reactivate
echo 'PASS C8: deactivation and assignment are ordered by the row lock, never half done'

# C12. Deactivate the assigned person while another session marks their step.
O="${P}12"
new_order "$O"
[[ "$(replace "$O" "$(version "$O")" "$(steps_json "$JESUS" "$JESUS")")" == "" ]] || fail 'C12 fixture'
S1="$(step_at "$O" 1)"; S2="$(step_at "$O" 2)"
sql "$(as_owner_postgres "update public.team_members set active=false where id='$JESUS';select pg_sleep(0.8)")" > /dev/null &
sleep 0.3
r="$(rpc "public.set_order_work_step_done_v1('$S1',true)->>'error'")"
wait
[[ "$r" == member_unassignable ]] || fail "C12 deactivate-first: expected member_unassignable, got '$r'"
reactivate
sql "$(as_user "$STAFF" "select public.set_order_work_step_done_v1('$S2',true);select pg_sleep(0.8)")" > /dev/null &
sleep 0.3
sql "$(as_owner_postgres "update public.team_members set active=false where id='$JESUS'")" > /dev/null
wait
[[ "$(sql "select completed_at is not null and executed_by_team_member_id='$JESUS' from public.order_work_steps where id='$S2'")" == t ]] || fail 'C12 mark-first: the step is done by Jesús'
[[ "$(sql "select active from public.team_members where id='$JESUS'")" == f ]] || fail 'C12 mark-first: the deactivation applied after'
reactivate
echo 'PASS C12: deactivation and marking are ordered; a done step keeps its person'

# C13. Reassign a step while another session marks it (both orders).
O="${P}31"
new_order "$O"
[[ "$(replace "$O" "$(version "$O")" "$(steps_json "$RAQUEL")")" == "" ]] || fail 'C13 fixture'
S1="$(step_at "$O" 1)"
reassign="[{\"id\":\"$S1\",\"stage_id\":\"$STAGE\",\"team_member_id\":\"$DAVINIA\"}]"
sql "$(as_user "$STAFF" "select public.set_order_work_step_done_v1('$S1',true);select pg_sleep(0.8)")" > /dev/null &
sleep 0.3
V="$(version "$O")" # read before the mark commits: the replace will also see a new version
r="$(replace "$O" "$((V + 1))" "$reassign")"
wait
[[ "$r" == step_done ]] || fail "C13 mark-first: expected step_done, got '$r'"
[[ "$(sql "select team_member_id from public.order_work_steps where id='$S1'")" == "$RAQUEL" ]] || fail 'C13: a done step never changes its person'
O="${P}32"
new_order "$O"
[[ "$(replace "$O" "$(version "$O")" "$(steps_json "$RAQUEL")")" == "" ]] || fail 'C13 fixture 2'
S1="$(step_at "$O" 1)"
reassign="[{\"id\":\"$S1\",\"stage_id\":\"$STAGE\",\"team_member_id\":\"$DAVINIA\"}]"
sql "$(as_user "$STAFF" "select public.replace_order_work_steps_v1('$O','$(version "$O")','$reassign'::jsonb);select pg_sleep(0.8)")" > /dev/null &
sleep 0.3
r="$(rpc "public.set_order_work_step_done_v1('$S1',true)->>'error'")"
wait
[[ "$r" == "" ]] || fail "C13 reassign-first: mark failed: $r"
[[ "$(sql "select team_member_id='$DAVINIA' and executed_by_team_member_id='$DAVINIA' from public.order_work_steps where id='$S1'")" == t ]] || fail 'C13 reassign-first: marked with the new person'
echo 'PASS C13: reassign and mark in both orders, step_done or the new person, never mixed'

# C14. Remove the person of a step while another session marks it (both orders).
O="${P}41"
new_order "$O"
[[ "$(replace "$O" "$(version "$O")" "$(steps_json "$RAQUEL")")" == "" ]] || fail 'C14 fixture'
S1="$(step_at "$O" 1)"
unassign="[{\"id\":\"$S1\",\"stage_id\":\"$STAGE\"}]"
V="$(version "$O")"
sql "$(as_user "$STAFF" "select public.set_order_work_step_done_v1('$S1',true);select pg_sleep(0.8)")" > /dev/null &
sleep 0.3
r="$(replace "$O" "$((V + 1))" "$unassign")"
wait
[[ "$r" == step_done ]] || fail "C14 mark-first: expected step_done, got '$r'"
O="${P}42"
new_order "$O"
[[ "$(replace "$O" "$(version "$O")" "$(steps_json "$RAQUEL")")" == "" ]] || fail 'C14 fixture 2'
S1="$(step_at "$O" 1)"
unassign="[{\"id\":\"$S1\",\"stage_id\":\"$STAGE\"}]"
sql "$(as_user "$STAFF" "select public.replace_order_work_steps_v1('$O','$(version "$O")','$unassign'::jsonb);select pg_sleep(0.8)")" > /dev/null &
sleep 0.3
r="$(rpc "public.set_order_work_step_done_v1('$S1',true)->>'error'")"
wait
[[ "$r" == step_unassigned ]] || fail "C14 unassign-first: expected step_unassigned, got '$r'"
[[ "$(sql "select count(*) from public.order_work_steps where tenant_id='$TENANT' and completed_at is not null and team_member_id is null")" == 0 ]] || fail 'C14: a done step without a person'
echo 'PASS C14: unassign and mark in both orders, step_done or step_unassigned, never a done step without a person'

# C4. Archive while sessions mark steps.
# The order's row lock decides what comes first, and every write bumps
# orders.row_version by one while holding it, so the versions give the exact
# order. Timestamps cannot: now() is when each transaction started, so an
# archive that starts first and gets the lock last has an earlier archived_at
# than the marks that went before it (seen in CI on 28/10).
O="${P}44"
new_order "$O" delivered
[[ "$(replace "$O" "$(version "$O")" "$(steps_json "$RAQUEL" "$JESUS" "$DAVINIA" "$RAQUEL" "$JESUS")")" == "" ]] || fail 'C4 fixture'
V0="$(version "$O")"
pids=()
for p in 1 2 3 4 5; do
  S="$(step_at "$O" "$p")"
  rpc "coalesce(r->>'error','')||'|'||coalesce(r->>'row_version','') from (select public.set_order_work_step_done_v1('$S',true) r) x" > "$TASK_DIR/c4-$p" &
  pids+=("$!")
done
# The archive's own version, read in its transaction right after the write.
sql "$(as_user "$OWNER" "select public.archive_order('$O','$TENANT');select row_version::text from public.orders where id='$O'")" | tail -1 > "$TASK_DIR/c4-archive" &
pids+=("$!")
for pid in "${pids[@]}"; do wait "$pid"; done
done_ok="$(awk -F'|' '$1=="" && $2!="" {n++} END {print n+0}' "$TASK_DIR"/c4-[0-9])"
refused="$(awk -F'|' '$1=="order_archived" {n++} END {print n+0}' "$TASK_DIR"/c4-[0-9])"
[[ "$((done_ok + refused))" == 5 ]] || fail "C4: unexpected outcomes $(cat "$TASK_DIR"/c4-[0-9] | sort | uniq -c)"
[[ "$(sql "select count(*) from public.order_work_steps where order_id='$O' and completed_at is not null")" == "$done_ok" ]] || fail 'C4: marks do not match the successes'
[[ "$(sql "select count(*) from public.activity_log where entity_id='$O' and action='order.work_step_completed'")" == "$done_ok" ]] || fail 'C4: one event per accepted mark'
[[ "$(sql "select archived_at is not null from public.orders where id='$O'")" == t ]] || fail 'C4: order not archived'
A="$(cat "$TASK_DIR/c4-archive")"
# Nothing else wrote: one version per accepted mark, then the archive, last.
[[ "$A" == "$((V0 + done_ok + 1))" && "$(version "$O")" == "$A" ]] || fail "C4: archive is not the last write (start $V0, $done_ok marks, archive '$A', now $(version "$O"))"
expected=''
if (( done_ok > 0 )); then expected="$(seq $((V0 + 1)) $((V0 + done_ok)) | paste -sd, -)"; fi
got="$(awk -F'|' '$1=="" {print $2}' "$TASK_DIR"/c4-[0-9] | sort -n | paste -sd, -)"
[[ "$got" == "$expected" ]] || fail "C4: a mark after the archive (marks at versions '$got', archive at $A)"
S="$(step_at "$O" 1)"
[[ "$(rpc "public.set_order_work_step_done_v1('$S',false)->>'error'")" == order_archived ]] || fail 'C4: archived order accepted a change'
echo "PASS C4: archive during 5 marks ($done_ok before, $refused refused), marks at versions ${got:-none}, archive last at $A"

# Fresh sessions: direct writes stay refused (marker NULL).
direct() {
  local statement="$1" out
  if out="$(sql "$statement" 2>&1)"; then fail "direct write succeeded: $statement"; fi
  grep -q "$2" <<<"$out" || fail "unexpected error for $statement: $out"
}
direct "update public.order_work_steps set is_current=false where tenant_id='$TENANT'" order_work_steps_rpc_only
direct "delete from public.order_work_steps where tenant_id='$TENANT'" order_work_steps_rpc_only
direct "update public.work_stages set active=false where tenant_id='$TENANT'" work_stages_rpc_only
direct "delete from public.work_stages where tenant_id='$TENANT'" work_stages_deactivate_only
direct "truncate public.order_work_steps" order_work_sequence_truncate_refused
direct "truncate public.work_stages cascade" order_work_sequence_truncate_refused
echo 'PASS: fresh sessions cannot write steps or stages directly, nor truncate them'

# Cleanup path: removing the tenant purges orders, steps (done ones too) and stages.
[[ "$(sql "select count(*) > 0 from public.order_work_steps where tenant_id='$TENANT' and completed_at is not null")" == t ]] || fail 'cleanup fixture: done steps exist'
sql "delete from public.tenants where id='$TENANT'" >/dev/null || fail 'tenant removal failed with steps'
[[ "$(sql "select count(*) from public.order_work_steps where tenant_id='$TENANT'")" == 0 ]] || fail 'steps survived the tenant'
[[ "$(sql "select count(*) from public.work_stages where tenant_id='$TENANT'")" == 0 ]] || fail 'stages survived the tenant'
echo 'PASS: tenant removal purges steps and stages'
