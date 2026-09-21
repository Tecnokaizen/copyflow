#!/usr/bin/env bash
# Concurrent create_order_file_upload must not exceed tenant storage quota.
set -euo pipefail

DB_URL="${1:?usage: phase22_storage_quota_concurrency.sh <database-url>}"

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

OWNER_A='e2210000-0000-4000-8000-000000000001'
TENANT_A='e2210000-0000-4000-8000-000000000011'
STATUS_A='e2210000-0000-4000-8000-000000000021'
SERVICE_A='e2210000-0000-4000-8000-000000000031'
ORDER_A='e2210000-0000-4000-8000-000000000061'
PLAN_ID='e2210000-0000-4000-8000-000000000091'
SUB_ID='e2210000-0000-4000-8000-000000000092'
FILE_A='e2210000-0000-4000-8000-000000000071'
FILE_B='e2210000-0000-4000-8000-000000000072'
SECRET='phase22-conc-files-signing-secret-at-least-32'

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.activity_log where tenant_id = '$TENANT_A';
    delete from public.order_files where tenant_id = '$TENANT_A';
    delete from public.orders where tenant_id = '$TENANT_A';
    delete from public.services where tenant_id = '$TENANT_A';
    delete from public.order_statuses where tenant_id = '$TENANT_A';
    delete from public.subscriptions where id = '$SUB_ID';
    delete from public.plan_features where plan_id = '$PLAN_ID';
    delete from public.plans where id = '$PLAN_ID';
    delete from public.tenant_settings where tenant_id = '$TENANT_A';
    delete from public.memberships where tenant_id = '$TENANT_A';
    delete from public.tenants where id = '$TENANT_A';
    delete from public.profiles where id = '$OWNER_A';
    delete from auth.users where id = '$OWNER_A';
  " >/dev/null || true
}

trap cleanup EXIT
cleanup

FEATURE_ID="$(psql_value "select id from public.features where code = 'storage_bytes';")"
if [[ -z "$FEATURE_ID" ]]; then
  echo "concurrency: storage_bytes feature missing" >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  do \$\$
  declare
    v_id uuid;
  begin
    select id into v_id from vault.secrets where name = 'files_signing_secret';
    if v_id is null then
      perform vault.create_secret(
        '$SECRET',
        'files_signing_secret',
        'phase22 concurrency secret'
      );
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
    '$OWNER_A', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner-conc@phase22.test', crypt('pw', gen_salt('bf')), now(),
    '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values ('$OWNER_A', 'Owner Conc');
  insert into public.tenants (id, name, slug, active)
    values ('$TENANT_A', 'Tenant Conc Phase22', 'tenant-conc-phase22', true);
  insert into public.memberships (tenant_id, user_id, role, active)
    values ('$TENANT_A', '$OWNER_A', 'owner', true);
  insert into public.tenant_settings (tenant_id, preferences) values ('$TENANT_A', '{}'::jsonb);

  begin;
  select set_config('request.jwt.claim.sub', '$OWNER_A', true);
  select set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values (
    '$STATUS_A', '$TENANT_A', 'Recibido', 'received', true, false, false, false, true, 1
  );
  insert into public.services (id, tenant_id, name, active)
    values ('$SERVICE_A', '$TENANT_A', 'Servicio', true);
  insert into public.orders (
    id, tenant_id, reference, title, status_id, service_id, created_by
  ) values (
    '$ORDER_A', '$TENANT_A', 'P22-C', 'Conc', '$STATUS_A', '$SERVICE_A', '$OWNER_A'
  );
  commit;

  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
    values ('$PLAN_ID', 'phase22_conc', 'Phase22 Conc', true, 99, 0, 0);
  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
    values ('$PLAN_ID', '$FEATURE_ID'::uuid, true, 5000);
  insert into public.subscriptions (
    id, tenant_id, plan_id, status, current_period_start, current_period_end
  ) values (
    '$SUB_ID', '$TENANT_A', '$PLAN_ID', 'active', now() - interval '1 day', now() + interval '30 days'
  );
"

sig_for() {
  local file_id="$1"
  local issued_at="$2"
  psql_value "
    select encode(
      extensions.hmac(
        convert_to(
          'files-v1|create|$OWNER_A|$TENANT_A|$ORDER_A|' || '$file_id' || '|' || '$issued_at',
          'UTF8'
        ),
        convert_to('$SECRET', 'UTF8'),
        'sha256'
      ),
      'hex'
    );
  "
}

ISSUED_AT="$(psql_value "select floor(extract(epoch from now()))::bigint;")"
SIG_A="$(sig_for "$FILE_A" "$ISSUED_AT")"
SIG_B="$(sig_for "$FILE_B" "$ISSUED_AT")"

run_upload() {
  local file_id="$1"
  local sig="$2"
  local out="$3"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    begin;
    select set_config('request.jwt.claim.sub', '$OWNER_A', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select public.create_order_file_upload(
      '$ORDER_A'::uuid,
      '$file_id'::uuid,
      'conc.pdf',
      'application/pdf',
      3000,
      now() + interval '15 minutes',
      $ISSUED_AT,
      '$sig'
    ) #>> '{file,id}';
    commit;
  " >"$out" 2>&1 || true
}

OUT_A="$(mktemp)"
OUT_B="$(mktemp)"

run_upload "$FILE_A" "$SIG_A" "$OUT_A" &
PID_A=$!
run_upload "$FILE_B" "$SIG_B" "$OUT_B" &
PID_B=$!

wait "$PID_A" || true
wait "$PID_B" || true

RESERVED="$(psql_value "
  select coalesce(sum(size_bytes), 0) from public.order_files
  where tenant_id = '$TENANT_A' and deleted_at is null;
")"

COUNT="$(psql_value "
  select count(*) from public.order_files
  where tenant_id = '$TENANT_A' and deleted_at is null;
")"

if [[ "$RESERVED" -gt 5000 ]]; then
  echo "concurrency: reserved $RESERVED exceeds quota 5000" >&2
  echo "--- A ---" >&2; cat "$OUT_A" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  exit 1
fi

if [[ "$COUNT" -ne 1 ]]; then
  echo "concurrency: expected exactly 1 pending file, got $COUNT" >&2
  echo "--- A ---" >&2; cat "$OUT_A" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  exit 1
fi

SUCCESS=0
if grep -Eq "$FILE_A|$FILE_B" "$OUT_A"; then SUCCESS=$((SUCCESS + 1)); fi
if grep -Eq "$FILE_A|$FILE_B" "$OUT_B"; then SUCCESS=$((SUCCESS + 1)); fi
if [[ "$SUCCESS" -lt 1 ]]; then
  echo "concurrency: neither upload succeeded" >&2
  echo "--- A ---" >&2; cat "$OUT_A" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  exit 1
fi

echo "phase22_storage_quota_concurrency: ok (reserved=$RESERVED count=$COUNT)"
