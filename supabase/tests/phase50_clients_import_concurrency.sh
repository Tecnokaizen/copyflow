#!/usr/bin/env bash
# Migration V1 client import: real interleavings with separate sessions.
#   C1 create_batch ∥ create_batch (same file + mapping) -> one batch, one reuse
#   C2 commit_chunk ∥ commit_chunk (same expected version) -> one writes, the
#      other waits for the batch lock and gets row_version_conflict (GC409); no row is processed twice
#   C3 resume until committed -> every row processed exactly once, no duplicates
# Local only. Uses fixed ids and removes its fixtures on exit.
set -euo pipefail

DB_URL="${1:?usage: phase50_clients_import_concurrency.sh <database-url>}"

OWNER='e5010000-0000-4000-8000-000000000001'
TENANT='e5010000-0000-4000-8000-000000000011'
SHA="$(printf 'c%.0s' $(seq 1 64))"
WORK="$(mktemp -d)"

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

fail() {
  echo "phase50 concurrency FAIL: $*" >&2
  exit 1
}

AS_OWNER="select set_config('request.jwt.claim.sub', '$OWNER', true) is null;
  select set_config('request.jwt.claim.role', 'authenticated', true) is null;
  set local role authenticated;"

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.activity_log where tenant_id = '$TENANT';
    delete from public.clients where tenant_id = '$TENANT';
    delete from imports_private.client_import_batches where tenant_id = '$TENANT';
    delete from public.tenant_feature_overrides where tenant_id = '$TENANT';
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
  insert into auth.users (id, email, raw_user_meta_data) values ('$OWNER', 'owner@phase50c.test', '{}');
  insert into public.profiles (id, full_name) values ('$OWNER', 'Owner C');
  insert into public.tenants (id, name, slug, active) values ('$TENANT', 'Phase50 Conc', 'phase50conc', true);
  insert into public.memberships (tenant_id, user_id, role, active) values ('$TENANT', '$OWNER', 'owner', true);
  select public.set_tenant_feature('phase50conc', 'clients_import', true, null);
SQL

# C1 -------------------------------------------------------------------------
create_batch_sql="begin; $AS_OWNER
  select (r ->> 'id') || ' ' || (r ->> 'reused')
  from public.client_import_create_batch('$TENANT', 'Concurrencia', 'c.csv', 100, '$SHA', '{\"Nombre\":\"name\"}') r;
  select pg_sleep(1);
  commit;"
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "$create_batch_sql" > "$WORK/c1a" 2>&1 &
p1=$!
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "$create_batch_sql" > "$WORK/c1b" 2>&1 &
p2=$!
wait "$p1" || fail "C1 session A: $(cat "$WORK/c1a")"
wait "$p2" || fail "C1 session B: $(cat "$WORK/c1b")"
batches="$(psql_value "select count(*) from imports_private.client_import_batches where tenant_id = '$TENANT'")"
[ "$batches" = "1" ] || fail "C1 expected one batch, got $batches"
reused="$(grep -hoE ' (true|false)$' "$WORK/c1a" "$WORK/c1b" | sort | tr -d ' ' | tr '\n' ',')"
[ "$reused" = "false,true," ] || fail "C1 expected one new and one reused, got $reused"
BATCH="$(psql_value "select id from imports_private.client_import_batches where tenant_id = '$TENANT'")"

# Stage 400 rows and finalize -------------------------------------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt >/dev/null <<SQL
  begin; $AS_OWNER
  select public.client_import_stage_rows('$BATCH',
    (select jsonb_agg(jsonb_build_object('row_number', g, 'name', 'Cliente ' || g, 'email', 'c' || g || '@phase50c.test'))
     from generate_series(1, 400) g));
  select public.client_import_finalize('$BATCH');
  commit;
SQL
VERSION="$(psql_value "select row_version from imports_private.client_import_batches where id = '$BATCH'")"

# C2 -------------------------------------------------------------------------
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin; $AS_OWNER
  select (public.client_import_commit_chunk('$BATCH', $VERSION, 200) -> 'chunk' ->> 'created');
  select pg_sleep(2);
  commit;" > "$WORK/c2a" 2>&1 &
p1=$!
sleep 0.5
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin; $AS_OWNER
  select public.client_import_commit_chunk('$BATCH', $VERSION, 200);
  commit;" > "$WORK/c2b" 2>&1
rc_b=$?
set -e
wait "$p1" || fail "C2 session A: $(cat "$WORK/c2a")"
[ "$rc_b" -ne 0 ] || fail "C2 session B should fail with row_version_conflict"
grep -q 'row_version_conflict' "$WORK/c2b" || fail "C2 session B: $(cat "$WORK/c2b")"
[ "$(grep -E '^[0-9]+$' "$WORK/c2a" | tail -1)" = "200" ] || fail "C2 session A created $(cat "$WORK/c2a")"
created="$(psql_value "select count(*) from public.clients where tenant_id = '$TENANT'")"
[ "$created" = "200" ] || fail "C2 expected 200 clients after one chunk, got $created"

# C3 -------------------------------------------------------------------------
for _ in 1 2 3; do
  VERSION="$(psql_value "select row_version from imports_private.client_import_batches where id = '$BATCH'")"
  status="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAt -c "begin; $AS_OWNER
    select public.client_import_commit_chunk('$BATCH', $VERSION, 200) ->> 'status'; commit;" | tail -1)"
  [ "$status" = "committed" ] && break
done
[ "$status" = "committed" ] || fail "C3 batch not committed: $status"
result="$(psql_value "select count(*) filter (where result = 'created') || ',' || count(*) filter (where result is null)
  from imports_private.client_import_rows where batch_id = '$BATCH'")"
[ "$result" = "400,0" ] || fail "C3 rows created/pending: $result"
dups="$(psql_value "select count(*) from (select lower(email) from public.clients where tenant_id = '$TENANT' group by 1 having count(*) > 1) d")"
[ "$dups" = "0" ] || fail "C3 duplicated clients: $dups"
linked="$(psql_value "select count(*) from public.clients where tenant_id = '$TENANT' and import_batch_id = '$BATCH'")"
[ "$linked" = "400" ] || fail "C3 clients linked to batch: $linked"

echo "phase50 concurrency PASS (C1 one batch, C2 one writer + row_version_conflict, C3 400 rows once)"
