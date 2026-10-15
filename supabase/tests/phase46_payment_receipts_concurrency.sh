#!/usr/bin/env bash
# Local-only concurrent sessions. No remote Supabase/R2 access.
set -euo pipefail
DB_URL="${1:?local database URL required}"
case "$DB_URL" in postgresql://*@127.0.0.1:*/*|postgresql://*@localhost:*/*) ;; *) echo 'Local database required' >&2; exit 2 ;; esac
TENANT='e4610000-0000-4000-8000-000000000011'
ACTOR='e4610000-0000-4000-8000-000000000001'
ORDER='e4610000-0000-4000-8000-000000000031'
RECEIPT='e4610000-0000-4000-8000-000000000051'
RETRY_FILE='e4610000-0000-4000-8000-000000000052'
RACE_FILE='e4610000-0000-4000-8000-000000000053'
TASK_DIR="$(mktemp -d)"
sql() { psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"; }
rpc() { sql "begin;select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;select $1;commit;" | tail -1; }
cleanup() {
  if [[ -f "$TASK_DIR/prior-secret" ]]; then
    prior="$(cat "$TASK_DIR/prior-secret")"
    prior="${prior//\'/\'\'}"
    sql "select vault.update_secret((select id from vault.secrets where name='files_signing_secret' order by updated_at desc limit 1),'$prior');" >/dev/null || true
  else
    sql "delete from vault.secrets where id in (select id from vault.decrypted_secrets where name='files_signing_secret' and decrypted_secret='phase46-concurrency-test-secret-32-characters');" >/dev/null || true
  fi
  sql "delete from public.orders where tenant_id='$TENANT';delete from public.tenants where id='$TENANT';delete from auth.users where id='$ACTOR';" >/dev/null || true
  rm -rf "$TASK_DIR"
}
trap cleanup EXIT
sql "insert into auth.users(id,email,raw_user_meta_data) values('$ACTOR','pay@phase46.test','{}');
insert into public.profiles(id,full_name) values('$ACTOR','Pago');
insert into public.tenants(id,name,slug,active) values('$TENANT','Receipts concurrency','phase46pay',true);
insert into public.memberships(tenant_id,user_id,role,active) values('$TENANT','$ACTOR','owner',true);
insert into public.order_statuses(tenant_id,name,code,active,sort_order,is_initial,is_ready,is_closed,is_cancelled)
values('$TENANT','Recibido','received',true,1,true,false,false,false);" >/dev/null
rpc "public.order_collection_v1('$ORDER')" >/dev/null
sql "begin;select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;insert into public.orders(id,tenant_id,title,status_id) select '$ORDER','$TENANT','Concurrente',id from public.order_statuses where tenant_id='$TENANT' and is_initial;commit;" >/dev/null
VERSION="$(sql "select row_version::text from public.orders where id='$ORDER'")"
rpc "public.set_order_total_amount('$ORDER','100.00','$VERSION')" >/dev/null
sql "insert into public.order_files(id,tenant_id,order_id,original_name,content_type,size_bytes,storage_key,status,etag,completed_at,upload_expires_at,uploaded_by)
select id::uuid,'$TENANT','$ORDER','receipt.pdf','application/pdf',12,'orders/$TENANT/$ORDER/'||id,'ready','test-etag',now(),now()+interval '5 minutes','$ACTOR'
from unnest(array['$RECEIPT','$RETRY_FILE','$RACE_FILE']) id;" >/dev/null
pids=()
for n in 1 2; do
  rpc "public.record_order_payment('$ORDER','10.00','2026-10-07T12:00:00Z','receipt-key-$n','bizum','$RECEIPT','$TENANT')->>'error'" > "$TASK_DIR/receipt-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(sql "select count(*) from public.order_payments where receipt_file_id='$RECEIPT'")" == 1 ]]
[[ "$(awk '$0=="receipt_already_used" {n++} END {print n+0}' "$TASK_DIR"/receipt-*)" == 1 ]]
echo 'PASS: concurrent different keys for the same receipt create one payment'
pids=()
for n in 1 2 3 4; do
  rpc "public.record_order_payment('$ORDER','10.00','2026-10-07T12:00:00Z','receipt-retry','card','$RETRY_FILE','$TENANT')->>'replayed'" > "$TASK_DIR/retry-$n" & pids+=("$!")
done
for pid in "${pids[@]}"; do wait "$pid"; done
[[ "$(sql "select count(*) from public.order_payments where receipt_file_id='$RETRY_FILE'")" == 1 ]]
echo 'PASS: four concurrent exact retries with receipt create one payment'
# A previous local suite may already hold the signing key. Borrow it for this
# race and put the previous value back in cleanup. Never leave the test value behind.
prior="$(sql "select decrypted_secret from vault.decrypted_secrets where name='files_signing_secret' order by updated_at desc limit 1")"
if [[ -n "$prior" ]]; then
  printf '%s' "$prior" > "$TASK_DIR/prior-secret"
  sql "select vault.update_secret((select id from vault.secrets where name='files_signing_secret' order by updated_at desc limit 1),'phase46-concurrency-test-secret-32-characters');" >/dev/null
else
  sql "select vault.create_secret('phase46-concurrency-test-secret-32-characters','files_signing_secret');" >/dev/null
fi
ISSUED="$(sql "select extract(epoch from now())::bigint")"
SIGNATURE="$(sql "select encode(extensions.hmac(convert_to('files-v1|delete|$ACTOR|$TENANT|$ORDER|$RACE_FILE|$ISSUED','UTF8'),convert_to('phase46-concurrency-test-secret-32-characters','UTF8'),'sha256'),'hex')")"
# A delete exception is mapped to a text outcome in its own session.
DELETE_SQL="create function pg_temp.try_delete() returns text language plpgsql as \$\$ begin perform public.soft_delete_order_file('$ORDER','$RACE_FILE',$ISSUED,'$SIGNATURE'); return 'deleted'; exception when sqlstate '55000' then return 'protected'; end \$\$;"
sql "begin;$DELETE_SQL select set_config('request.jwt.claim.sub','$ACTOR',true);select set_config('request.jwt.claim.role','authenticated',true);set local role authenticated;select pg_temp.try_delete();commit;" > "$TASK_DIR/delete" & delete_pid=$!
rpc "public.record_order_payment('$ORDER','10.00','2026-10-07T12:00:00Z','receipt-race','cash','$RACE_FILE','$TENANT')->>'error'" > "$TASK_DIR/pay-race" & pay_pid=$!
wait "$delete_pid"; wait "$pay_pid"
[[ "$(sql "select count(*) from public.order_payments p join public.order_files f on f.id=p.receipt_file_id where p.tenant_id='$TENANT' and f.deleted_at is not null")" == 0 ]]
POSTED="$(sql "select count(*) from public.order_payments where receipt_file_id='$RACE_FILE'")"
if [[ "$POSTED" == 1 ]]; then [[ "$(tail -1 "$TASK_DIR/delete")" == protected ]]; else [[ "$(tail -1 "$TASK_DIR/delete")" == deleted ]]; [[ "$(cat "$TASK_DIR/pay-race")" == invalid_receipt ]]; fi
echo 'PASS: concurrent deletion/payment yields either protected receipt or rejected payment, never a missing receipt'
