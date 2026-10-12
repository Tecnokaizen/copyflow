#!/usr/bin/env bash
# Concurrent ai_reserve_usage must not exceed tenant monthly budget.
set -euo pipefail

DB_URL="${1:?usage: phase46_ai_voice_budget_concurrency.sh <database-url>}"

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

OWNER_A='e4620000-0000-4000-8000-000000000001'
TENANT_A='e4620000-0000-4000-8000-000000000011'
REQ_A='e4620000-0000-4000-8000-000000000021'
REQ_B='e4620000-0000-4000-8000-000000000022'

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.ai_usage_events where tenant_id = '$TENANT_A';
    delete from public.ai_usage_limits where tenant_id = '$TENANT_A';
    delete from public.tenant_feature_overrides where tenant_id = '$TENANT_A';
    delete from public.memberships where tenant_id = '$TENANT_A';
    delete from public.tenant_settings where tenant_id = '$TENANT_A';
    delete from public.tenants where id = '$TENANT_A';
    delete from public.profiles where id = '$OWNER_A';
    delete from auth.users where id = '$OWNER_A';
    update public.ai_usage_limits
      set enabled = false, monthly_budget_micros = 10000000
      where scope = 'platform' and feature_code = 'voice_orders';
  " >/dev/null || true
}

trap cleanup EXIT
cleanup

psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    '$OWNER_A', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner-conc@phase46.test', crypt('pw', gen_salt('bf')), now(),
    '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values ('$OWNER_A', 'Owner Conc');
  insert into public.tenants (id, name, slug, active)
    values ('$TENANT_A', 'Tenant Conc Phase46', 'phase46-conc', true);
  insert into public.memberships (tenant_id, user_id, role, active)
    values ('$TENANT_A', '$OWNER_A', 'owner', true);
  insert into public.tenant_settings (tenant_id, preferences) values ('$TENANT_A', '{}'::jsonb);

  update public.ai_usage_limits
    set enabled = true, monthly_budget_micros = 10000000
    where scope = 'platform' and feature_code = 'voice_orders';

  select public.set_tenant_feature('phase46-conc', 'voice_orders', true, null);

  insert into public.ai_usage_limits (
    scope, tenant_id, feature_code, enabled, monthly_budget_micros, daily_request_limit
  ) values (
    'tenant', '$TENANT_A', 'voice_orders', true, 5000, 100
  );
"

run_reserve() {
  local request_id="$1"
  local out="$2"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    begin;
    select set_config('request.jwt.claim.sub', '$OWNER_A', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select public.ai_reserve_usage(
      '$TENANT_A'::uuid,
      'voice_orders',
      'transcription',
      '$request_id'::uuid,
      3000,
      'fake',
      'fake',
      'v1'
    );
    commit;
  " >"$out" 2>&1 || true
}

OUT_A="$(mktemp)"
OUT_B="$(mktemp)"

run_reserve "$REQ_A" "$OUT_A" &
PID_A=$!
run_reserve "$REQ_B" "$OUT_B" &
PID_B=$!

wait "$PID_A" || true
wait "$PID_B" || true

CHARGED="$(psql_value "
  select coalesce(sum(coalesce(actual_micros, reserved_micros)), 0)
  from public.ai_usage_events
  where tenant_id = '$TENANT_A'
    and status in ('reserved', 'committed', 'expired');
")"

COUNT="$(psql_value "
  select count(*) from public.ai_usage_events
  where tenant_id = '$TENANT_A'
    and status in ('reserved', 'committed', 'expired');
")"

if [[ "$CHARGED" -gt 5000 ]]; then
  echo "concurrency: charged $CHARGED exceeds budget 5000" >&2
  echo "--- A ---" >&2; cat "$OUT_A" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  exit 1
fi

if [[ "$COUNT" -ne 1 ]]; then
  echo "concurrency: expected exactly 1 reservation, got $COUNT" >&2
  echo "--- A ---" >&2; cat "$OUT_A" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  exit 1
fi

echo "phase46_ai_voice_budget_concurrency: ok (charged=$CHARGED count=$COUNT)"
