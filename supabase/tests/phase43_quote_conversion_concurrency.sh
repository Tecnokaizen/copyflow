#!/usr/bin/env bash
# Real SQL sessions; local fixture cleanup suspends guards only inside cleanup transaction.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;; *) echo 'Local database required' >&2; exit 2;; esac
TENANT='e4130000-0000-4000-8000-000000000011'; ACTOR='e4130000-0000-4000-8000-000000000001'; QUOTE='e4130000-0000-4000-8000-000000000021'
SECRET='phase43-concurrency-test-secret-32b'; TASK_DIR="$(mktemp -d)"
sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
cleanup() {
 sql "begin;
 alter table public.quotes disable trigger quote_conversion_stable;
 alter table public.quotes disable trigger quotes_commercial_state;
 alter table public.quote_versions disable trigger quote_versions_guard;
 alter table public.quote_files disable trigger quote_pdf_file_guard;
 alter table public.quote_items disable trigger quote_items_guard;
 alter table public.quote_items disable trigger quote_items_rollup;
 update public.quotes set accepted_version_id=null,current_version_id=null where tenant_id='$TENANT';
 update public.quote_versions set pdf_file_id=null where tenant_id='$TENANT';
 delete from public.quote_files where tenant_id='$TENANT';
 delete from public.quote_items where tenant_id='$TENANT';
 delete from public.quote_versions where tenant_id='$TENANT';
 delete from public.tenants where id='$TENANT';delete from auth.users where id='$ACTOR';
 alter table public.quotes enable trigger quote_conversion_stable;
 alter table public.quotes enable trigger quotes_commercial_state;
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
 insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','pdf-concurrency@phase43.test','{}');
 insert into public.profiles(id,full_name) values('$ACTOR','Transition concurrency');
 insert into public.tenants(id,name,slug,active) values('$TENANT','Transition concurrency','phase43conc',true);
 insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','owner',true);
 select public.seed_quote_statuses('$TENANT');select public.set_tenant_feature('phase43conc','quotes',true,null);
 insert into public.quotes(id,tenant_id,status_id,description) select '$QUOTE','$TENANT',id,'Transition concurrency' from public.quote_statuses where tenant_id='$TENANT' and code='draft';" >/dev/null
rpc() { sql "begin;select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;select $1;commit;" | tail -1; }
VERSION="$(rpc "public.ensure_quote_draft_v1('$QUOTE')->'version'->>'id'")"
RV="$(rpc "public.save_quote_draft_v1('$QUOTE','$VERSION',0,'{}','[{\"concept\":\"PDF line\",\"quantity\":1,\"unit_price\":100}]')->'version'->>'row_version'")"
rpc "public.prepare_quote_version_v1('$QUOTE','$VERSION',$RV)->>'ok'" >/dev/null
ISSUED="$(sql "select extract(epoch from now())::bigint")"
signature() { echo "encode(extensions.hmac(convert_to('files-v1-quote|$1|$ACTOR|$TENANT|$QUOTE|$2|$ISSUED','UTF8'),convert_to('$SECRET','UTF8'),'sha256'),'hex')"; }
pids=()
for n in 1 2 3 4 5 6 7 8; do
 F="e4130000-0000-4000-8000-00000000008$n"
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

QRV="$(sql "select row_version from public.quotes where id='$QUOTE'")"
pids=()
for n in 1 2 3 4 5 6 7 8; do
 rpc "public.transition_quote_v1('$QUOTE','$VERSION',$QRV,'send')->>'replayed'" > "$TASK_DIR/send-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(awk '$0=="false" {n++} END {print n+0}' "$TASK_DIR"/send-*)" == 1 ]]
[[ "$(awk '$0=="true" {n++} END {print n+0}' "$TASK_DIR"/send-*)" == 7 ]]
[[ "$(sql "select count(*) from public.activity_log where tenant_id='$TENANT' and action='quote.status_changed'")" == 1 ]]

QRV="$(sql "select row_version from public.quotes where id='$QUOTE'")"
rpc "public.transition_quote_v1('$QUOTE','$VERSION',$QRV,'accept')->>'ok'" >/dev/null
sql "insert into public.order_statuses(tenant_id,name,code,is_initial) values('$TENANT','Initial','pending',true)" >/dev/null
QRV="$(sql "select row_version from public.quotes where id='$QUOTE'")"
pids=()
for n in 1 2 3 4 5 6 7 8; do
 rpc "public.convert_quote_to_order('$QUOTE',null,null,null,'normal',null,$QRV)->>'order_id'" > "$TASK_DIR/convert-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(cat "$TASK_DIR"/convert-* | sort -u | wc -l | tr -d ' ')" == 1 ]]
[[ "$(sql "select count(*) from public.orders where tenant_id='$TENANT'")" == 1 ]]
[[ "$(sql "select count(*) from public.activity_log where tenant_id='$TENANT' and action='quote.converted'")" == 1 ]]
[[ "$(sql "select count(*) from public.order_files where tenant_id='$TENANT'")" == 0 ]]
echo 'PASS: eight concurrent conversions, one order, one quote event, no copied PDF'

# Distinct accepted quote conversions also serialize the existing order counter.
psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL >/dev/null
begin;
\i supabase/tests/helpers/accepted_quote_fixture.sql
select set_config('request.jwt.claim.sub','$ACTOR',true);
do \$\$ declare q uuid; n integer; begin
 for n in 1..4 loop
  insert into public.quotes(tenant_id,status_id,title,description)
  select '$TENANT',id,'Numbering fixture','Concurrent numbering' from public.quote_statuses where tenant_id='$TENANT' and code='draft' returning id into q;
  perform pg_temp.accepted_quote_fixture(q);
 end loop;
end \$\$;
commit;
SQL
pids=()
for q in $(sql "select id from public.quotes where tenant_id='$TENANT' and id<>'$QUOTE'"); do
 qrv="$(sql "select row_version from public.quotes where id='$q'")"
 rpc "public.convert_quote_to_order('$q',null,null,null,'normal',null,$qrv)->>'ok'" > "$TASK_DIR/number-$q" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(sql "select count(*)=5 and count(distinct reference)=5 from public.orders where tenant_id='$TENANT'")" == t ]]
echo 'PASS: four distinct concurrent accepted conversions plus first order, five unique order references'
