#!/usr/bin/env bash
# SUR4 E5 · order post-its. Real concurrent sessions against a local database
# (C4, C5, C6, C7, C9 of the SUR4 document). Every psql call is a NEW session:
# the gestcopy.* markers are unset (NULL), like a fresh pooled connection.
# Cleanup always runs and removes the tenant (purge path included).
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in
  postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;;
  *) echo 'Local database required' >&2; exit 2 ;;
esac

TENANT='e6010000-0000-4000-8000-000000000011'
OWNER='e6010000-0000-4000-8000-000000000001'
STAFF='e6010000-0000-4000-8000-000000000002'
P='e6010000-0000-4000-8000-0000000001'
TASK_DIR="$(mktemp -d)"

sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
as_user() { # $1 user, $2 statement
  echo "begin;select set_config('request.jwt.claim.sub','$1',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;$2;commit;"
}
rpc() { sql "$(as_user "${2:-$STAFF}" "select $1")" | tail -1; }
fail() { echo "FAIL: $*" >&2; exit 1; }

cleanup() {
  sql "delete from public.tenants where id='$TENANT';delete from auth.users where id in ('$OWNER','$STAFF');" >/dev/null || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT

sql "insert into auth.users(id,email,raw_user_meta_data) values('$OWNER','owner@phase61c.test','{}'),('$STAFF','staff@phase61c.test','{}');
insert into public.profiles(id,full_name) values('$OWNER','Dueña'),('$STAFF','Raquel');
insert into public.tenants(id,name,slug,active) values('$TENANT','Notes concurrency','phase61conc',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$OWNER','owner',true),('$TENANT','$STAFF','staff',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled) values
  ('$TENANT','Recibido','received',true,1,true,false,false,false),
  ('$TENANT','Entregado','delivered',true,2,false,false,true,false);
select public.set_tenant_feature('phase61conc','order_sticky_notes',true,null);" >/dev/null

new_order() { # $1 id, $2 status code
  sql "$(as_user "$OWNER" "insert into public.orders(id,tenant_id,title,status_id,created_by) select '$1','$TENANT','Concurrente',id,'$OWNER' from public.order_statuses where tenant_id='$TENANT' and code='${2:-received}'")" >/dev/null
}
version() { sql "select row_version::text from public.orders where id='$1'"; }
note() { # $1 order -> note id
  rpc "public.create_order_note_v1('$1','<p>Nota</p>')->'note'->>'id'"
}

# C7. Twenty sessions create notes on the same order.
O="${P}01"
new_order "$O"
V="$(version "$O")"
pids=()
for n in $(seq 1 20); do
  rpc "public.create_order_note_v1('$O','<p>Nota $n</p>')->>'ok'" > "$TASK_DIR/c7-$n" &
  pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(cat "$TASK_DIR"/c7-* | sort -u)" == "true" ]] || fail "C7: some creations failed: $(cat "$TASK_DIR"/c7-* | sort | uniq -c)"
[[ "$(sql "select count(*) from public.order_notes where order_id='$O'")" == 20 ]] || fail 'C7: expected 20 notes'
[[ "$(sql "select count(*) from public.order_note_events where order_id='$O' and action='created'")" == 20 ]] || fail 'C7: expected 20 events'
[[ "$(version "$O")" == "$V" ]] || fail 'C7: notes must not bump orders.row_version'
echo 'PASS C7: 20 concurrent notes on one order, 20 events, no deadlock, order version untouched'

# C5. Two sessions edit the same note with the same version.
N="$(note "$O")"
for n in 1 2 3 4; do
  rpc "public.update_order_note_v1('$N','1','<p>Edición $n</p>')->>'error'" > "$TASK_DIR/c5-$n" &
done
wait
ok_count="$(awk '$0=="" {n++} END {print n+0}' "$TASK_DIR"/c5-*)"
conflicts="$(awk '$0=="conflict" {n++} END {print n+0}' "$TASK_DIR"/c5-*)"
[[ "$ok_count" == 1 && "$conflicts" == 3 ]] || fail "C5: expected 1 winner and 3 conflicts, got $ok_count/$conflicts"
[[ "$(sql "select count(*) from public.order_note_events where note_id='$N' and action='edited'")" == 1 ]] || fail 'C5: one edited event'
[[ "$(sql "select count(*) from public.order_note_versions where note_id='$N'")" == 2 ]] || fail 'C5: two versions'
echo 'PASS C5: four edits with one version, one winner, three conflicts, one event'

# C6. Resolve and void the same note at the same time (several rounds).
for round in 1 2 3 4 5 6; do
  N="$(note "$O")"
  rpc "public.set_order_note_state_v1('$N','resolve')->>'error'" > "$TASK_DIR/c6-r" &
  rpc "public.set_order_note_state_v1('$N','void','Duplicada')->>'error'" > "$TASK_DIR/c6-v" &
  wait
  r="$(cat "$TASK_DIR/c6-r")"; v="$(cat "$TASK_DIR/c6-v")"
  state="$(sql "select state from public.order_notes where id='$N'")"
  actions="$(sql "select string_agg(action, ',' order by created_at) from public.order_note_events where note_id='$N'")"
  if [[ "$r" == "" && "$v" == "" ]]; then
    [[ "$state" == voided && "$actions" == "created,resolved,voided" ]] || fail "C6 round $round: resolve then void gave $state / $actions"
  elif [[ "$r" == "conflict" && "$v" == "" ]]; then
    [[ "$state" == voided && "$actions" == "created,voided" ]] || fail "C6 round $round: void first gave $state / $actions"
  else
    fail "C6 round $round: unexpected outcomes resolve='$r' void='$v'"
  fi
done
echo 'PASS C6: resolve and void race six times, final state voided, events in real order'

# C9. A note while another session edits the order: no conflict for anyone.
O9="${P}09"
new_order "$O9"
V="$(version "$O9")"
sql "$(as_user "$OWNER" "select public.change_order_content_v2('$O9','title','Título nuevo','$TENANT',$V);select pg_sleep(1)")" > "$TASK_DIR/c9-edit" &
edit_pid=$!
sleep 0.3
rpc "public.create_order_note_v1('$O9','<p>Mientras edita</p>')->>'ok'" > "$TASK_DIR/c9-note"
wait "$edit_pid"
[[ "$(cat "$TASK_DIR/c9-note")" == true ]] || fail 'C9: the note failed'
[[ "$(sql "select title from public.orders where id='$O9'")" == 'Título nuevo' ]] || fail 'C9: the edit failed'
[[ "$(version "$O9")" == "$((V + 1))" ]] || fail 'C9: only the edit bumps the order version'
echo 'PASS C9: a note during an order edit, both saved, version bumped once'

# C4. Archive while ten sessions create notes.
O4="${P}04"
new_order "$O4" delivered
pids=()
for n in $(seq 1 10); do
  rpc "public.create_order_note_v1('$O4','<p>Carrera $n</p>')->>'error'" > "$TASK_DIR/c4-$n" &
  pids+=("$!")
done
sql "$(as_user "$OWNER" "select public.archive_order('$O4','$TENANT')")" > /dev/null &
pids+=("$!")
for pid in "${pids[@]}"; do wait "$pid"; done
created="$(awk '$0=="" {n++} END {print n+0}' "$TASK_DIR"/c4-*)"
archived="$(awk '$0=="order_archived" {n++} END {print n+0}' "$TASK_DIR"/c4-*)"
[[ "$((created + archived))" == 10 ]] || fail "C4: unexpected outcomes $(cat "$TASK_DIR"/c4-* | sort | uniq -c)"
[[ "$(sql "select count(*) from public.order_notes where order_id='$O4'")" == "$created" ]] || fail 'C4: notes do not match the successes'
[[ "$(rpc "public.create_order_note_v1('$O4','<p>Tarde</p>')->>'error'")" == order_archived ]] || fail 'C4: archived order accepted a note'
echo "PASS C4: archive during 10 creations ($created before, $archived refused), nothing after the archive"

# Fresh sessions: direct writes stay refused (marker NULL).
direct() {
  local statement="$1" out
  if out="$(sql "$statement" 2>&1)"; then fail "direct write succeeded: $statement"; fi
  grep -q "$2" <<<"$out" || fail "unexpected error for $statement: $out"
}
direct "update public.order_notes set pinned=true where order_id='$O'" order_notes_rpc_only
direct "delete from public.order_note_events where order_id='$O'" order_note_events_append_only
direct "update public.order_note_versions set body=null where tenant_id='$TENANT'" order_notes_redact_only
echo 'PASS: fresh sessions cannot write post-its directly'

# Cleanup path: removing the tenant purges orders and their post-its.
sql "delete from public.tenants where id='$TENANT'" >/dev/null || fail 'tenant removal failed with post-its'
[[ "$(sql "select count(*) from public.order_notes where tenant_id='$TENANT'")" == 0 ]] || fail 'post-its survived the tenant'
echo 'PASS: tenant removal purges post-its'
