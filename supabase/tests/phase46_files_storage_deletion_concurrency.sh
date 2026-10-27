#!/usr/bin/env bash
# Files V1.1 storage deletion outbox: real interleavings with separate sessions.
#   C1 DELETE ∥ DELETE            -> serialized, one task, second is a replay
#   C2 DELETE ∥ COMPLETE (both orders)
#   C3 Cleanup ∥ COMPLETE (both orders) -> never a ready row whose object is queued
#   C4 Worker ∥ Worker ∥ Worker  -> disjoint leases
#   C5 Lease expiry + delayed worker -> stale finish ignored
#   C6 Failure after R2 deletion / crash before confirmation -> recovered
# Local only. Uses fixed ids and removes its fixtures on exit.
set -euo pipefail

DB_URL="${1:?usage: phase46_files_storage_deletion_concurrency.sh <database-url>}"

OWNER='e4610000-0000-4000-8000-000000000001'
TENANT='e4610000-0000-4000-8000-000000000011'
STATUS='e4610000-0000-4000-8000-000000000021'
SERVICE='e4610000-0000-4000-8000-000000000031'
ORDER='e4610000-0000-4000-8000-000000000061'
F1='e4610000-0000-4000-8000-000000000071'
F2='e4610000-0000-4000-8000-000000000072'
F3='e4610000-0000-4000-8000-000000000073'
F4='e4610000-0000-4000-8000-000000000074'
F5='e4610000-0000-4000-8000-000000000075'
T_LEASE='e4610000-0000-4000-8000-0000000000a1'
T_CRASH='e4610000-0000-4000-8000-0000000000a2'
SECRET='phase46-conc-files-signing-secret-32b!'
WORK="$(mktemp -d)"

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

fail() {
  echo "phase46 concurrency FAIL: $*" >&2
  exit 1
}

AS_USER="select set_config('request.jwt.claim.sub', '$OWNER', true) is null;
  select set_config('request.jwt.claim.role', 'authenticated', true) is null;
  set local role authenticated;"
AS_SERVICE="select set_config('request.jwt.claim.sub', '', true) is null;
  select set_config('request.jwt.claim.role', 'service_role', true) is null;
  set local role service_role;"

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from files_private.storage_deletion_events e
      using files_private.storage_deletions d
      where e.deletion_id = d.id and d.tenant_id = '$TENANT';
    delete from files_private.storage_deletions where tenant_id = '$TENANT';
    delete from public.activity_log where tenant_id = '$TENANT';
    delete from public.order_files where tenant_id = '$TENANT';
    delete from public.orders where tenant_id = '$TENANT';
    delete from public.services where tenant_id = '$TENANT';
    delete from public.order_statuses where tenant_id = '$TENANT';
    delete from public.tenant_settings where tenant_id = '$TENANT';
    delete from public.memberships where tenant_id = '$TENANT';
    delete from public.tenants where id = '$TENANT';
    delete from public.profiles where id = '$OWNER';
    delete from auth.users where id = '$OWNER';
  " >/dev/null 2>&1 || true
  rm -rf "$WORK"
}

trap cleanup EXIT
cleanup
WORK="$(mktemp -d)"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/dev/null <<SQL
  do \$\$
  declare v_id uuid;
  begin
    select id into v_id from vault.secrets where name = 'files_signing_secret';
    if v_id is null then
      perform vault.create_secret('$SECRET', 'files_signing_secret', 'phase46 conc');
    else
      perform vault.update_secret(v_id, '$SECRET');
    end if;
  end;
  \$\$;

  insert into auth.users (id, email, raw_user_meta_data) values ('$OWNER', 'owner@phase46-conc.test', '{}');
  insert into public.profiles (id, full_name) values ('$OWNER', 'Owner');
  insert into public.tenants (id, name, slug, active) values ('$TENANT', 'Phase46 Conc', 'phase46-conc', true);
  -- S2: explicit storage capacity (a tenant without subscription has 0 bytes).
  insert into public.subscriptions (tenant_id, plan_id, provider, status) select '$TENANT', id, 'internal', 'active' from public.plans where code = 'basic';
  insert into public.memberships (tenant_id, user_id, role, active) values ('$TENANT', '$OWNER', 'owner', true);
  insert into public.tenant_settings (tenant_id, preferences) values ('$TENANT', '{}'::jsonb);

  begin;
  $AS_USER
  insert into public.order_statuses (id, tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order)
    values ('$STATUS', '$TENANT', 'Recibido', 'received', true, false, false, false, true, 1);
  insert into public.services (id, tenant_id, name, active) values ('$SERVICE', '$TENANT', 'Servicio', true);
  insert into public.orders (id, tenant_id, title, status_id, service_id, created_by)
    values ('$ORDER', '$TENANT', 'Conc', '$STATUS', '$SERVICE', '$OWNER');
  commit;
SQL

sig() { # purpose file issued
  psql_value "select encode(extensions.hmac(convert_to(
    'files-v1|$1|$OWNER|$TENANT|$ORDER|$2|$3', 'UTF8'), convert_to('$SECRET', 'UTF8'), 'sha256'), 'hex');"
}

now_epoch() { psql_value "select floor(extract(epoch from now()))::bigint;"; }

create_file() { # file expires_sql complete(yes|no)
  local issued; issued="$(now_epoch)"
  local complete_sql=""
  if [[ "$3" == "yes" ]]; then
    complete_sql="select public.complete_order_file_upload('$ORDER', '$1', '\"etag\"', $issued, '$(sig complete "$1" "$issued")') is null;"
  fi
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt >/dev/null <<SQL
    begin;
    $AS_USER
    select public.create_order_file_upload('$ORDER', '$1', 'f.pdf', 'application/pdf', 100,
      $2, $issued, '$(sig create "$1" "$issued")') is null;
    $complete_sql
    commit;
SQL
}

delete_sql() { # file -> SQL printing R:<result json>
  local issued; issued="$(now_epoch)"
  echo "select 'R:' || public.soft_delete_order_file('$ORDER', '$1', $issued, '$(sig delete "$1" "$issued")')::text;"
}

complete_sql() { # file
  local issued; issued="$(now_epoch)"
  echo "select 'R:' || public.complete_order_file_upload('$ORDER', '$1', '\"etag\"', $issued, '$(sig complete "$1" "$issued")')::text;"
}

session() { # out-file sql...  (runs one transaction, prints R:/T: lines)
  local out="$1"; shift
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt >"$out" 2>&1 <<SQL || true
  begin;
  $*
  select 'T:' || extract(epoch from clock_timestamp());
  commit;
SQL
}

hold() { echo "select pg_sleep($1) is null;"; }
result() { grep '^R:' "$1" | head -1 | cut -c3-; }
finished_at() { grep '^T:' "$1" | head -1 | cut -c3-; }
later() { [[ "$(psql_value "select ($1)::numeric > ($2)::numeric;")" == "t" ]]; }

# ---------------------------------------------------------------- C1
create_file "$F1" "now() + interval '15 minutes'" yes
session "$WORK/c1a" "$AS_USER" "$(delete_sql "$F1")" "$(hold 2)" &
A=$!; sleep 0.7
session "$WORK/c1b" "$AS_USER" "$(delete_sql "$F1")"
wait "$A"
RA="$(result "$WORK/c1a")"; RB="$(result "$WORK/c1b")"
[[ -n "$RA" && -n "$RB" ]] || fail "C1 missing results: $(cat "$WORK/c1a" "$WORK/c1b")"
later "$(finished_at "$WORK/c1b")" "$(finished_at "$WORK/c1a")" || fail "C1 second DELETE did not wait for the first"
[[ "$(psql_value "select ('$RB'::jsonb->>'replay') = 'true' and ('$RA'::jsonb->>'storage_deletion_id') = ('$RB'::jsonb->>'storage_deletion_id');")" == "t" ]] \
  || fail "C1 expected replay with same task: $RA / $RB"
[[ "$(psql_value "select count(*) from files_private.storage_deletions where file_id = '$F1';")" == "1" ]] || fail "C1 duplicate tasks"
[[ "$(psql_value "select count(*) from public.activity_log where tenant_id = '$TENANT' and action = 'order.file_deleted' and metadata->>'file_id' = '$F1';")" == "1" ]] \
  || fail "C1 duplicate activity"
echo "C1 DELETE ∥ DELETE: PASS"

# ---------------------------------------------------------------- C2a DELETE first, COMPLETE waits
create_file "$F2" "now() + interval '15 minutes'" no
session "$WORK/c2a" "$AS_USER" "$(delete_sql "$F2")" "$(hold 2)" &
A=$!; sleep 0.7
session "$WORK/c2b" "$AS_USER" "$(complete_sql "$F2")"
wait "$A"
grep -q 'file not found' "$WORK/c2b" || fail "C2a late COMPLETE should be 'file not found': $(cat "$WORK/c2b")"
[[ "$(psql_value "select status = 'pending' and deleted_at is not null from public.order_files where id = '$F2';")" == "t" ]] \
  || fail "C2a COMPLETE reactivated a reserved file"
[[ "$(psql_value "select count(*) from files_private.storage_deletions where file_id = '$F2' and status = 'pending';")" == "1" ]] || fail "C2a task missing"
echo "C2a DELETE then COMPLETE: PASS"

# ---------------------------------------------------------------- C2b COMPLETE first, DELETE waits
create_file "$F3" "now() + interval '15 minutes'" no
session "$WORK/c2c" "$AS_USER" "$(complete_sql "$F3")" "$(hold 2)" &
A=$!; sleep 0.7
session "$WORK/c2d" "$AS_USER" "$(delete_sql "$F3")"
wait "$A"
[[ -n "$(result "$WORK/c2c")" && -n "$(result "$WORK/c2d")" ]] || fail "C2b results: $(cat "$WORK/c2c" "$WORK/c2d")"
later "$(finished_at "$WORK/c2d")" "$(finished_at "$WORK/c2c")" || fail "C2b DELETE did not wait for COMPLETE"
[[ "$(psql_value "select f.status = 'ready' and f.deleted_at is not null and d.next_attempt_at < f.upload_expires_at
  from public.order_files f join files_private.storage_deletions d on d.file_id = f.id where f.id = '$F3';")" == "t" ]] \
  || fail "C2b expected ready+deleted with an immediately due task"
echo "C2b COMPLETE then DELETE: PASS"

# ---------------------------------------------------------------- C3a COMPLETE holds the row across expiry; cleanup skips it
create_file "$F4" "now() + interval '3 seconds'" no
session "$WORK/c3a" "$AS_USER" "$(complete_sql "$F4")" "$(hold 6)" &
A=$!; sleep 4.5
[[ "$(psql_value "select upload_expires_at < now() from public.order_files where id = '$F4';")" == "t" ]] || fail "C3a fixture not expired yet"
session "$WORK/c3b" "$AS_SERVICE" "select 'R:' || public.claim_expired_file_uploads(100)::text;"
wait "$A"
later "$(finished_at "$WORK/c3a")" "$(finished_at "$WORK/c3b")" || fail "C3a cleanup should not wait (SKIP LOCKED)"
[[ -n "$(result "$WORK/c3a")" ]] || fail "C3a COMPLETE failed: $(cat "$WORK/c3a")"
[[ "$(psql_value "select status = 'ready' and deleted_at is null from public.order_files where id = '$F4';")" == "t" ]] || fail "C3a file must be ready"
[[ "$(psql_value "select count(*) from files_private.storage_deletions where file_id = '$F4';")" == "0" ]] || fail "C3a ready file object was queued for deletion"
session "$WORK/c3c" "$AS_SERVICE" "select 'R:' || public.claim_expired_file_uploads(100)::text;"
[[ "$(psql_value "select count(*) from files_private.storage_deletions where file_id = '$F4';")" == "0" ]] || fail "C3a cleanup re-run queued a ready file"
echo "C3a Cleanup ∥ COMPLETE (COMPLETE first): PASS"

# ---------------------------------------------------------------- C3b cleanup holds the row; late COMPLETE cannot revive it
psql_value "insert into public.order_files (id, tenant_id, order_id, original_name, size_bytes, storage_key, status, uploaded_by, upload_expires_at)
  values ('$F5', '$TENANT', '$ORDER', 'old.pdf', 10, 'orders/$TENANT/$ORDER/$F5', 'pending', '$OWNER', now() - interval '1 hour');" >/dev/null
session "$WORK/c3d" "$AS_SERVICE" "select 'R:' || public.claim_expired_file_uploads(100)::text;" "$(hold 2)" &
A=$!; sleep 0.7
session "$WORK/c3e" "$AS_USER" "$(complete_sql "$F5")"
wait "$A"
grep -q 'file not found' "$WORK/c3e" || fail "C3b late COMPLETE should be 'file not found': $(cat "$WORK/c3e")"
[[ "$(psql_value "select count(*) from public.order_files where id = '$F5';")" == "0" ]] || fail "C3b metadata should be purged"
[[ "$(psql_value "select count(*) from files_private.storage_deletions where file_id = '$F5' and reason = 'expired_upload';")" == "1" ]] || fail "C3b task missing"
echo "C3b Cleanup ∥ COMPLETE (cleanup first): PASS"

# ---------------------------------------------------------------- C4 three workers claim concurrently
psql_value "insert into files_private.storage_deletions (file_kind, tenant_id, parent_id, file_id, storage_key, reason)
  select 'order', '$TENANT', '$ORDER', g, 'orders/$TENANT/$ORDER/' || g, 'expired_upload'
  from (select gen_random_uuid() g from generate_series(1, 20)) s;" >/dev/null
WORKER_SQL="select 'R:' || coalesce(string_agg(e->>'id', ','), '') from jsonb_array_elements(public.claim_storage_deletions(9, 300)) e;"
for w in 1 2 3; do
  session "$WORK/c4_$w" "$AS_SERVICE" "$WORKER_SQL" "$(hold 1)" &
done
wait
CLAIMED="$(for w in 1 2 3; do result "$WORK/c4_$w" | tr ',' '\n'; done | grep -v '^$' || true)"
TOTAL="$(echo "$CLAIMED" | grep -c . || true)"
UNIQUE="$(echo "$CLAIMED" | sort -u | grep -c . || true)"
[[ "$TOTAL" == "$UNIQUE" ]] || fail "C4 a task was leased twice ($TOTAL vs $UNIQUE)"
[[ "$(psql_value "select count(*) from files_private.storage_deletions where tenant_id = '$TENANT' and reason = 'expired_upload'
  and status = 'processing' and attempts = 1;")" -ge 20 ]] || fail "C4 expected all queued tasks leased exactly once"
[[ "$(psql_value "select count(*) from files_private.storage_deletions where tenant_id = '$TENANT' and attempts > 1;")" == "0" ]] || fail "C4 double attempt"
echo "C4 Worker ∥ Worker ∥ Worker: PASS ($TOTAL leases, all distinct)"

# ---------------------------------------------------------------- C5 + C6 lease expiry, delayed worker, crash before confirmation
psql_value "insert into files_private.storage_deletions (id, file_kind, tenant_id, parent_id, file_id, storage_key, reason) values
  ('$T_LEASE', 'order', '$TENANT', '$ORDER', '$T_LEASE', 'orders/$TENANT/$ORDER/$T_LEASE', 'expired_upload'),
  ('$T_CRASH', 'order', '$TENANT', '$ORDER', '$T_CRASH', 'orders/$TENANT/$ORDER/$T_CRASH', 'expired_upload');" >/dev/null
session "$WORK/c5a" "$AS_SERVICE" "select 'R:' || (public.claim_storage_deletion('$T_LEASE', 10)->0->>'lease_token');"
TOKEN_A="$(result "$WORK/c5a")"
[[ -n "$TOKEN_A" ]] || fail "C5 first claim failed: $(cat "$WORK/c5a")"
session "$WORK/c6a" "$AS_SERVICE" "select 'R:' || (public.claim_storage_deletion('$T_CRASH', 10)->0->>'lease_token');"
TOKEN_C="$(result "$WORK/c6a")"
# C6: R2 deleted, then the confirmation transaction fails (rolled back) and the process dies.
psql "$DB_URL" -qAt >/dev/null 2>&1 <<SQL || true
  begin;
  $AS_SERVICE
  select public.finish_storage_deletion('$T_CRASH', '$TOKEN_C', 'deleted', null);
  rollback;
SQL
[[ "$(psql_value "select status from files_private.storage_deletions where id = '$T_CRASH';")" == "processing" ]] || fail "C6 lost confirmation must leave the task processing"
session "$WORK/c5b" "$AS_SERVICE" "select 'R:' || coalesce(public.claim_storage_deletion('$T_LEASE', 60)::text, '');"
[[ "$(result "$WORK/c5b")" == "[]" ]] || fail "C5 lease must not be stolen while valid"

sleep 11

session "$WORK/c5c" "$AS_SERVICE" "select 'R:' || (public.claim_storage_deletion('$T_LEASE', 60)->0->>'lease_token');"
TOKEN_B="$(result "$WORK/c5c")"
[[ -n "$TOKEN_B" && "$TOKEN_B" != "$TOKEN_A" ]] || fail "C5 expired lease should be re-claimed: $(cat "$WORK/c5c")"
session "$WORK/c5d" "$AS_SERVICE" "select 'R:' || public.finish_storage_deletion('$T_LEASE', '$TOKEN_A', 'deleted', null);"
[[ "$(result "$WORK/c5d")" == "stale" ]] || fail "C5 delayed worker must be stale: $(cat "$WORK/c5d")"
[[ "$(psql_value "select status from files_private.storage_deletions where id = '$T_LEASE';")" == "processing" ]] || fail "C5 stale finish changed state"
session "$WORK/c5e" "$AS_SERVICE" "select 'R:' || public.finish_storage_deletion('$T_LEASE', '$TOKEN_B', 'deleted', null);"
[[ "$(result "$WORK/c5e")" == "completed" ]] || fail "C5 current lease must complete"
echo "C5 Lease expiry + delayed worker: PASS"

# Recovery of C6: a later run re-claims and R2 reports the (already missing) object as deleted.
session "$WORK/c6b" "$AS_SERVICE" "select 'R:' || (public.claim_storage_deletion('$T_CRASH', 60)->0->>'lease_token');"
TOKEN_C2="$(result "$WORK/c6b")"
[[ -n "$TOKEN_C2" && "$TOKEN_C2" != "$TOKEN_C" ]] || fail "C6 task should be re-claimable after lease expiry"
session "$WORK/c6c" "$AS_SERVICE" "select 'R:' || public.finish_storage_deletion('$T_CRASH', '$TOKEN_C2', 'deleted', null);"
[[ "$(result "$WORK/c6c")" == "completed" ]] || fail "C6 recovery must complete"
[[ "$(psql_value "select attempts from files_private.storage_deletions where id = '$T_CRASH';")" == "2" ]] || fail "C6 attempts"
echo "C6 Failure after R2 / crash before confirmation: PASS"

echo "phase46 concurrency PASS"
