#!/usr/bin/env bash
# Local-only concurrency test. Fixture history is deleted under a transaction-scoped
# trigger suspension during cleanup; product RPCs never suspend invariants.
set -euo pipefail
DB_URL="${1:?usage: phase40_quote_commercial_concurrency.sh <local-database-url>}"
case "$DB_URL" in postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;; *) echo 'Local database required' >&2; exit 2;; esac
TENANT='e4010000-0000-4000-8000-000000000011'
ACTOR='e4010000-0000-4000-8000-000000000001'
QUOTE='e4010000-0000-4000-8000-000000000021'
TASK_DIR="$(mktemp -d)"
psql_at() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
begin;
alter table public.quote_items disable trigger quote_items_guard;
alter table public.quote_items disable trigger quote_items_rollup;
alter table public.quote_versions disable trigger quote_versions_guard;
update public.quotes set current_version_id=null,accepted_version_id=null where tenant_id='$TENANT';
delete from public.quote_items where tenant_id='$TENANT';
delete from public.quote_versions where tenant_id='$TENANT';
delete from public.tenants where id='$TENANT';
delete from auth.users where id='$ACTOR';
alter table public.quote_items enable trigger quote_items_guard;
alter table public.quote_items enable trigger quote_items_rollup;
alter table public.quote_versions enable trigger quote_versions_guard;
commit;
SQL
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT
psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','actor@phase40-concurrent.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR','Concurrent actor');
insert into public.tenants(id,name,slug,active) values('$TENANT','Commercial concurrency','phase40conc',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','owner',true);
select public.seed_quote_statuses('$TENANT');
select public.set_tenant_feature('phase40conc','quotes',true,null);
insert into public.quotes(id,tenant_id,status_id,description)
select '$QUOTE','$TENANT',id,'Concurrent quote' from public.quote_statuses where tenant_id='$TENANT' and code='draft';
SQL
rpc() {
 psql_at "begin;
 select set_config('request.jwt.claim.sub','$ACTOR',true);
 select set_config('request.jwt.claim.role','authenticated',true);
 set local role authenticated;
 select $1;
 commit;" | tail -n 1 > "$2"
}
# Start eight competing ensures; each must resolve to the same draft.
pids=()
for n in 1 2 3 4 5 6 7 8; do
 rpc "public.ensure_quote_draft_v1('$QUOTE')->'version'->>'id'" "$TASK_DIR/ensure-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(cat "$TASK_DIR"/ensure-* | sort -u | wc -l | tr -d ' ')" == 1 ]]
VERSION="$(cat "$TASK_DIR/ensure-1")"
ROW_VERSION="$(psql_at "select row_version from public.quote_versions where id='$VERSION'")"
# Two competing full writes with the same expected version: one success and one conflict.
pids=()
for n in 1 2; do
 rpc "coalesce(public.save_quote_draft_v1('$QUOTE','$VERSION',$ROW_VERSION,
 '{\"title\":\"Concurrent\",\"description\":\"Concurrent quote\",\"prices_include_tax\":false}',
 '[{\"concept\":\"Line $n\",\"quantity\":1,\"unit_price\":100,\"tax_rate\":21}]')->>'error','ok')" "$TASK_DIR/save-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(cat "$TASK_DIR"/save-* | sort | tr '\n' ' ')" == 'conflict ok ' ]]
# Each round prepares the current draft then races eight creators of the next version.
for round in 1 2 3; do
 ROW_VERSION="$(psql_at "select row_version from public.quote_versions where id='$VERSION'")"
 rpc "public.prepare_quote_version_v1('$QUOTE','$VERSION',$ROW_VERSION)->>'ok'" "$TASK_DIR/prepared"
 [[ "$(cat "$TASK_DIR/prepared")" == true ]]
 pids=()
 for n in 1 2 3 4 5 6 7 8; do
  rpc "coalesce(public.create_quote_version_v1('$QUOTE')->>'error','ok')" "$TASK_DIR/clone-$n" & pids+=("$!")
 done
 for pid in "${pids[@]}"; do wait "$pid"; done
 [[ "$(awk '$0=="ok" {n++} END {print n+0}' "$TASK_DIR"/clone-*)" == 1 ]]
 [[ "$(awk '$0=="draft_exists" {n++} END {print n+0}' "$TASK_DIR"/clone-*)" == 7 ]]
 VERSION="$(psql_at "select id from public.quote_versions where quote_id='$QUOTE' and state='draft'")"
done
[[ "$(psql_at "select count(*)=4 and count(distinct version_number)=4 and max(version_number)=4 from public.quote_versions where quote_id='$QUOTE'")" == t ]]
[[ "$(psql_at "select count(*)=1 from public.quote_versions where quote_id='$QUOTE' and state='draft'")" == t ]]
echo 'phase40 commercial concurrency PASS (8 ensures, 2 competing saves, 24 competing clones)'
