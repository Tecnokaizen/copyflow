#!/usr/bin/env bash
# Real SQL sessions; local fixture cleanup suspends guards only inside cleanup transaction.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;; *) echo 'Local database required' >&2; exit 2;; esac
TENANT='e4110000-0000-4000-8000-000000000011'; ACTOR='e4110000-0000-4000-8000-000000000001'; QUOTE='e4110000-0000-4000-8000-000000000021'
SECRET='phase41-concurrency-test-secret-32b'; TASK_DIR="$(mktemp -d)"
sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
cleanup() {
 sql "begin;
 alter table public.quote_versions disable trigger quote_versions_guard;
 alter table public.quote_files disable trigger quote_pdf_file_guard;
 alter table public.quote_items disable trigger quote_items_guard;
 alter table public.quote_items disable trigger quote_items_rollup;
 update public.quotes set current_version_id=null where tenant_id='$TENANT';
 update public.quote_versions set pdf_file_id=null where tenant_id='$TENANT';
 delete from public.quote_files where tenant_id='$TENANT';
 delete from public.quote_items where tenant_id='$TENANT';
 delete from public.quote_versions where tenant_id='$TENANT';
 delete from public.tenants where id='$TENANT';delete from auth.users where id='$ACTOR';
 alter table public.quote_versions enable trigger quote_versions_guard;
 alter table public.quote_files enable trigger quote_pdf_file_guard;
 alter table public.quote_items enable trigger quote_items_guard;
 alter table public.quote_items enable trigger quote_items_rollup;
 commit;" >/dev/null
 rm -rf "$TASK_DIR"
}
trap cleanup EXIT
sql "do \$\$ begin
 if exists(select 1 from vault.secrets where name='files_signing_secret') then
 perform vault.update_secret((select id from vault.secrets where name='files_signing_secret' limit 1),'$SECRET');
 else perform vault.create_secret('$SECRET','files_signing_secret');end if;end \$\$;
 insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','pdf-concurrency@phase41.test','{}');
 insert into public.profiles(id,full_name) values('$ACTOR','PDF concurrency');
 insert into public.tenants(id,name,slug,active) values('$TENANT','PDF concurrency','phase41conc',true);
 insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','owner',true);
 select public.seed_quote_statuses('$TENANT');select public.set_tenant_feature('phase41conc','quotes',true,null);
 insert into public.quotes(id,tenant_id,status_id,description) select '$QUOTE','$TENANT',id,'PDF concurrency' from public.quote_statuses where tenant_id='$TENANT' and code='draft';" >/dev/null
rpc() { sql "begin;select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;select $1;commit;" | tail -1; }
VERSION="$(rpc "public.ensure_quote_draft_v1('$QUOTE')->'version'->>'id'")"
RV="$(rpc "public.save_quote_draft_v1('$QUOTE','$VERSION',0,'{}','[{\"concept\":\"PDF line\",\"quantity\":1,\"unit_price\":100}]')->'version'->>'row_version'")"
rpc "public.prepare_quote_version_v1('$QUOTE','$VERSION',$RV)->>'ok'" >/dev/null
ISSUED="$(sql "select extract(epoch from now())::bigint")"
signature() { echo "encode(extensions.hmac(convert_to('files-v1-quote|$1|$ACTOR|$TENANT|$QUOTE|$2|$ISSUED','UTF8'),convert_to('$SECRET','UTF8'),'sha256'),'hex')"; }
pids=()
for n in 1 2 3 4 5 6 7 8; do
 F="e4110000-0000-4000-8000-00000000008$n"
 rpc "public.reserve_quote_pdf_v1('$QUOTE','$VERSION','$F',100,$ISSUED,$(signature create "$F"))->'file'->>'id'" > "$TASK_DIR/reserve-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(cat "$TASK_DIR"/reserve-* | sort -u | wc -l | tr -d ' ')" == 1 ]]
FILE="$(cat "$TASK_DIR/reserve-1")"
pids=()
for n in 1 2 3 4 5 6 7 8; do
 rpc "public.finish_quote_pdf_v1('$QUOTE','$VERSION','$FILE','local-etag',$ISSUED,$(signature complete "$FILE"))->>'replayed'" > "$TASK_DIR/finish-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(awk '$0=="false" {n++} END {print n+0}' "$TASK_DIR"/finish-*)" == 1 ]]
[[ "$(awk '$0=="true" {n++} END {print n+0}' "$TASK_DIR"/finish-*)" == 7 ]]
[[ "$(sql "select count(*) from public.quote_files where tenant_id='$TENANT' and status='ready'")" == 1 ]]
[[ "$(sql "select public.tenant_storage_usage('$TENANT')->>'reserved_bytes'")" == 100 ]]
[[ "$(sql "select count(*) from public.activity_log where tenant_id='$TENANT' and action='quote.pdf_generated'")" == 1 ]]
echo 'PASS: 8 concurrent reservations, 8 confirmations, one ready file, one quota charge, one activity'
