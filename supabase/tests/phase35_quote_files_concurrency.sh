#!/usr/bin/env bash
# Concurrent order INIT and quote INIT share file-quota:{tenant}. Only one 8 MiB
# reservation may succeed when 10 MiB remain. Runs both start orders.
set -euo pipefail

DB_URL="${1:?usage: phase35_quote_files_concurrency.sh <database-url>}"

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

OWNER='e3510000-0000-4000-8000-000000000001'
TENANT='e3510000-0000-4000-8000-000000000011'
STATUS='e3510000-0000-4000-8000-000000000021'
SERVICE='e3510000-0000-4000-8000-000000000031'
ORDER='e3510000-0000-4000-8000-000000000061'
QUOTE='e3510000-0000-4000-8000-000000000071'
PLAN='e3510000-0000-4000-8000-000000000091'
SUB='e3510000-0000-4000-8000-000000000092'
FILE_ORDER='e3510000-0000-4000-8000-000000000081'
FILE_QUOTE='e3510000-0000-4000-8000-000000000082'
SECRET='phase35-conc-files-signing-secret-32b'
QUOTA=$((10 * 1024 * 1024))
SIZE=$((8 * 1024 * 1024))

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.activity_log where tenant_id = '$TENANT';
    delete from public.quote_files where tenant_id = '$TENANT';
    delete from public.order_files where tenant_id = '$TENANT';
    delete from public.quotes where tenant_id = '$TENANT';
    delete from public.quote_statuses where tenant_id = '$TENANT';
    delete from public.orders where tenant_id = '$TENANT';
    delete from public.services where tenant_id = '$TENANT';
    delete from public.order_statuses where tenant_id = '$TENANT';
    delete from public.subscriptions where id = '$SUB';
    delete from public.plan_features where plan_id = '$PLAN';
    delete from public.plans where id = '$PLAN';
    delete from public.tenant_feature_overrides where tenant_id = '$TENANT';
    delete from public.tenant_settings where tenant_id = '$TENANT';
    delete from public.memberships where tenant_id = '$TENANT';
    delete from public.tenants where id = '$TENANT';
    delete from public.profiles where id = '$OWNER';
    delete from auth.users where id = '$OWNER';
  " >/dev/null || true
}

trap cleanup EXIT
cleanup

FEATURE_ID="$(psql_value "select id from public.features where code = 'storage_bytes';")"

psql "$DB_URL" -v ON_ERROR_STOP=1 <<SQL
  do \$\$
  declare
    v_id uuid;
    v_draft uuid;
  begin
    select id into v_id from vault.secrets where name = 'files_signing_secret';
    if v_id is null then
      perform vault.create_secret('$SECRET', 'files_signing_secret', 'phase35 conc');
    else
      perform vault.update_secret(v_id, '$SECRET');
    end if;
  end;
  \$\$;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '$OWNER', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner-conc@phase35.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values ('$OWNER', 'Owner Conc');
  insert into public.tenants (id, name, slug, active)
    values ('$TENANT', 'Phase35 Conc', 'phase35-conc', true);
  insert into public.memberships (tenant_id, user_id, role, active)
    values ('$TENANT', '$OWNER', 'owner', true);
  insert into public.tenant_settings (tenant_id, preferences) values ('$TENANT', '{}'::jsonb);
  select public.set_tenant_feature('phase35-conc', 'quotes', true, null);
  select public.seed_quote_statuses('$TENANT'::uuid);

  begin;
  select set_config('request.jwt.claim.sub', '$OWNER', true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values (
    '$STATUS', '$TENANT', 'Recibido', 'received', true, false, false, false, true, 1
  );
  insert into public.services (id, tenant_id, name, active)
    values ('$SERVICE', '$TENANT', 'Servicio', true);
  insert into public.orders (
    id, tenant_id, reference, title, status_id, service_id, created_by
  ) values (
    '$ORDER', '$TENANT', 'P35-C', 'Conc', '$STATUS', '$SERVICE', '$OWNER'
  );
  insert into public.quotes (tenant_id, description, status_id)
  select '$TENANT', 'Conc quote', id
  from public.quote_statuses
  where tenant_id = '$TENANT' and code = 'draft';
  commit;

  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
    values ('$PLAN', 'phase35_conc', 'Phase35 Conc', true, 99, 0, 0);
  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
    values ('$PLAN', '$FEATURE_ID'::uuid, true, $QUOTA);
  insert into public.subscriptions (
    id, tenant_id, plan_id, status, current_period_start, current_period_end
  ) values (
    '$SUB', '$TENANT', '$PLAN', 'active', now() - interval '1 day', now() + interval '30 days'
  );
SQL

QUOTE="$(psql_value "select id from public.quotes where tenant_id = '$TENANT' limit 1;")"
ISSUED_AT="$(psql_value "select floor(extract(epoch from now()))::bigint;")"

sig_order() {
  psql_value "
    select encode(extensions.hmac(convert_to(
      'files-v1|create|$OWNER|$TENANT|$ORDER|$FILE_ORDER|$ISSUED_AT', 'UTF8'
    ), convert_to('$SECRET', 'UTF8'), 'sha256'), 'hex');
  "
}
sig_quote() {
  psql_value "
    select encode(extensions.hmac(convert_to(
      'files-v1-quote|create|$OWNER|$TENANT|$QUOTE|$FILE_QUOTE|$ISSUED_AT', 'UTF8'
    ), convert_to('$SECRET', 'UTF8'), 'sha256'), 'hex');
  "
}

SIG_ORDER="$(sig_order)"
SIG_QUOTE="$(sig_quote)"

run_order() {
  local out="$1"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    begin;
    select set_config('request.jwt.claim.sub', '$OWNER', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select public.create_order_file_upload(
      '$ORDER'::uuid, '$FILE_ORDER'::uuid, 'order.pdf', 'application/pdf', $SIZE,
      now() + interval '15 minutes', $ISSUED_AT, '$SIG_ORDER'
    ) #>> '{file,id}';
    commit;
  " >"$out" 2>&1 || true
}

run_quote() {
  local out="$1"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    begin;
    select set_config('request.jwt.claim.sub', '$OWNER', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select public.create_quote_file_upload(
      '$QUOTE'::uuid, '$FILE_QUOTE'::uuid, 'quote.pdf', 'application/pdf', $SIZE,
      now() + interval '15 minutes', $ISSUED_AT, '$SIG_QUOTE'
    ) #>> '{file,id}';
    commit;
  " >"$out" 2>&1 || true
}

assert_one() {
  local label="$1"
  local out_order="$2"
  local out_quote="$3"
  local reserved count
  reserved="$(psql_value "
    select coalesce(sum(size_bytes), 0) from (
      select size_bytes from public.order_files
      where tenant_id = '$TENANT' and deleted_at is null
      union all
      select size_bytes from public.quote_files
      where tenant_id = '$TENANT' and deleted_at is null
    ) s;
  ")"
  count="$(psql_value "
    select (
      select count(*) from public.order_files where tenant_id = '$TENANT' and deleted_at is null
    ) + (
      select count(*) from public.quote_files where tenant_id = '$TENANT' and deleted_at is null
    );
  ")"
  if [[ "$reserved" -gt "$QUOTA" ]]; then
    echo "$label: reserved $reserved exceeds $QUOTA" >&2
    echo "--- order ---" >&2; cat "$out_order" >&2
    echo "--- quote ---" >&2; cat "$out_quote" >&2
    exit 1
  fi
  if [[ "$count" -ne 1 ]]; then
    echo "$label: expected 1 reservation, got $count (reserved $reserved)" >&2
    echo "--- order ---" >&2; cat "$out_order" >&2
    echo "--- quote ---" >&2; cat "$out_quote" >&2
    exit 1
  fi
}

clear_files() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.activity_log where tenant_id = '$TENANT';
    delete from public.order_files where tenant_id = '$TENANT';
    delete from public.quote_files where tenant_id = '$TENANT';
  " >/dev/null
}

OUT_ORDER="$(mktemp)"
OUT_QUOTE="$(mktemp)"

run_order "$OUT_ORDER" &
PID_ORDER=$!
sleep 0.05
run_quote "$OUT_QUOTE" &
PID_QUOTE=$!
wait "$PID_ORDER" || true
wait "$PID_QUOTE" || true
assert_one "order-then-quote" "$OUT_ORDER" "$OUT_QUOTE"

clear_files
: >"$OUT_ORDER"
: >"$OUT_QUOTE"
run_quote "$OUT_QUOTE" &
PID_QUOTE=$!
sleep 0.05
run_order "$OUT_ORDER" &
PID_ORDER=$!
wait "$PID_ORDER" || true
wait "$PID_QUOTE" || true
assert_one "quote-then-order" "$OUT_ORDER" "$OUT_QUOTE"

echo "phase35 quote/order quota concurrency ok"
