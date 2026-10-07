#!/usr/bin/env bash
# Local-only concurrency test. Fixture history is deleted under a transaction-scoped
# trigger suspension during cleanup; product RPCs never suspend invariants.
set -euo pipefail
DB_URL="${1:?usage: phase44_quote_creation_concurrency.sh <local-database-url>}"
case "$DB_URL" in postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;; *) echo 'Local database required' >&2; exit 2;; esac
TENANT='e4410000-0000-4000-8000-000000000011'
ACTOR='e4410000-0000-4000-8000-000000000001'
QUOTE='e4410000-0000-4000-8000-000000000021'
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
insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','actor@phase44-concurrent.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR','Concurrent actor');
insert into public.tenants(id,name,slug,active) values('$TENANT','Commercial concurrency','phase44conc',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','owner',true);
select public.seed_quote_statuses('$TENANT');
select public.set_tenant_feature('phase44conc','quotes',true,null);
SQL
rpc() {
 psql_at "begin;
 select set_config('request.jwt.claim.sub','$ACTOR',true);
 select set_config('request.jwt.claim.role','authenticated',true);
 set local role authenticated;
 select $1;
 commit;" | tail -n 1 > "$2"
}
CREATE_CALL="public.create_quote_draft_v1('$TENANT','$QUOTE',null,null,null,
 '{\"title\":\"Concurrent\",\"description\":\"Copias\",\"issue_date\":\"2026-10-06\",\"currency\":\"EUR\",\"prices_include_tax\":false}',
 '[{\"concept\":\"A4\",\"quantity\":2,\"unit_price\":100,\"tax_rate\":21}]',false)"
pids=()
for n in 1 2 3 4 5 6 7 8; do
 rpc "$CREATE_CALL" "$TASK_DIR/create-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(cat "$TASK_DIR"/create-* | sort -u | wc -l | tr -d ' ')" == 1 ]]
[[ "$(psql_at "select count(*)=1 from public.quotes where tenant_id='$TENANT'")" == t ]]
[[ "$(psql_at "select count(*)=1 and min(state)='draft' and sum(total)=242 from public.quote_versions where quote_id='$QUOTE'")" == t ]]
[[ "$(psql_at "select count(*)=1 from public.quote_draft_creations where creation_id='$QUOTE'")" == t ]]
[[ "$(psql_at "select last_number=1 from public.quote_number_counters where tenant_id='$TENANT'")" == t ]]
# A different request using the same creation UUID must never modify the existing draft.
rpc "public.create_quote_draft_v1('$TENANT','$QUOTE',null,null,null,
 '{\"description\":\"Changed\",\"issue_date\":\"2026-10-06\",\"currency\":\"EUR\",\"prices_include_tax\":false}',
 '[]',false)->>'error'" "$TASK_DIR/conflict"
[[ "$(cat "$TASK_DIR/conflict")" == creation_conflict ]]
# Exact items and simultaneous ACKs have no repeated effects or timestamp changes.
[[ "$(psql_at "select count(*)=1 and min(quantity)=2 and min(unit_price)=100 from public.quote_items where quote_version_id in (select id from public.quote_versions where quote_id='$QUOTE')")" == t ]]
pids=()
for n in 1 2 3 4 5 6 7 8; do
 rpc "public.ack_quote_draft_creation_v1('$TENANT','$QUOTE')" "$TASK_DIR/ack-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(cat "$TASK_DIR"/ack-* | sort -u | wc -l | tr -d ' ')" == 1 ]]
rpc "$CREATE_CALL" "$TASK_DIR/after-ack"
cmp "$TASK_DIR/create-1" "$TASK_DIR/after-ack"
rpc "jsonb_array_length(public.recover_quote_draft_creations_v1('$TENANT')->'receipts')" "$TASK_DIR/pending"
[[ "$(cat "$TASK_DIR/pending")" == 0 ]]
echo 'phase44 creation concurrency PASS (8 exact replays, one quote/draft/receipt/reference; incompatible request rejected)'
