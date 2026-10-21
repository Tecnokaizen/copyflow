#!/usr/bin/env bash
# phase53: concurrent ai_reserve_usage calls from two members of one tenant
# must not exceed the tenant monthly budget (advisory locks global → tenant →
# user). Commits synthetic fixtures and removes them; the platform row is
# restored to the exact values it had before the run.
set -euo pipefail

DB_URL="${1:?usage: phase53_ai_voice_budget_concurrency.sh <database-url>}"

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

OWNER_A='e5310000-0000-4000-8000-000000000001'
STAFF_A='e5310000-0000-4000-8000-000000000002'
TENANT_A='e5310000-0000-4000-8000-000000000011'
REQ_A='e5310000-0000-4000-8000-000000000021'
REQ_B='e5310000-0000-4000-8000-000000000022'

PLATFORM_BEFORE="$(psql_value "
  select concat_ws(',', enabled::text, coalesce(monthly_budget_micros::text, 'null'),
    coalesce(daily_request_limit::text, 'null'), coalesce(max_clip_seconds::text, 'null'),
    coalesce(max_audio_bytes::text, 'null'))
  from public.ai_usage_limits
  where scope = 'platform' and feature_code = 'ai_voice_orders';
")"
if [[ -z "$PLATFORM_BEFORE" ]]; then
  echo "concurrency: platform limit row missing" >&2
  exit 1
fi

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.ai_usage_events where tenant_id = '$TENANT_A';
    delete from public.ai_usage_limits where tenant_id = '$TENANT_A';
    delete from public.tenant_feature_overrides where tenant_id = '$TENANT_A';
    delete from public.memberships where tenant_id = '$TENANT_A';
    delete from public.tenants where id = '$TENANT_A';
    delete from public.profiles where id in ('$OWNER_A', '$STAFF_A');
    delete from auth.users where id in ('$OWNER_A', '$STAFF_A');
  " >/dev/null || true
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    select public.ai_set_voice_usage_limit('platform', null, null, $PLATFORM_BEFORE);
  " >/dev/null
}

trap cleanup EXIT
cleanup

psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  insert into auth.users (id, email, raw_user_meta_data) values
    ('$OWNER_A', 'owner-conc@phase53.test', '{}'::jsonb),
    ('$STAFF_A', 'staff-conc@phase53.test', '{}'::jsonb);
  insert into public.profiles (id, full_name) values
    ('$OWNER_A', 'Owner Conc'), ('$STAFF_A', 'Staff Conc');
  insert into public.tenants (id, name, slug, active)
    values ('$TENANT_A', 'Tenant Conc Phase53', 'phase53-conc', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    ('$TENANT_A', '$OWNER_A', 'owner', true),
    ('$TENANT_A', '$STAFF_A', 'staff', true);

  select public.ai_set_voice_usage_limit('platform', null, null, true, 10000000, 60, 60, 3000000);
  select public.set_tenant_feature('phase53-conc', 'ai_voice_orders', true, null);
  select public.ai_set_voice_usage_limit('tenant', 'phase53-conc', null, true, 5000, 100, null, null);
" >/dev/null

run_reserve() {
  local user_id="$1"
  local request_id="$2"
  local out="$3"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    begin;
    select set_config('request.jwt.claim.sub', '$user_id', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select public.ai_reserve_usage(
      '$TENANT_A'::uuid,
      'ai_voice_orders',
      'transcription',
      '$request_id'::uuid,
      3000,
      'fake',
      'fake',
      'phase53'
    );
    commit;
  " >"$out" 2>&1 || true
}

OUT_A="$(mktemp)"
OUT_B="$(mktemp)"

run_reserve "$OWNER_A" "$REQ_A" "$OUT_A" &
PID_A=$!
run_reserve "$STAFF_A" "$REQ_B" "$OUT_B" &
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

EXHAUSTED="$(cat "$OUT_A" "$OUT_B" | grep -c 'ai_budget_exhausted' || true)"

if [[ "$CHARGED" -gt 5000 ]]; then
  echo "concurrency: charged $CHARGED exceeds budget 5000" >&2
  echo "--- A ---" >&2; cat "$OUT_A" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  exit 1
fi

if [[ "$COUNT" -ne 1 || "$EXHAUSTED" -ne 1 ]]; then
  echo "concurrency: expected 1 reservation and 1 ai_budget_exhausted, got $COUNT / $EXHAUSTED" >&2
  echo "--- A ---" >&2; cat "$OUT_A" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  exit 1
fi

rm -f "$OUT_A" "$OUT_B"
echo "phase53_ai_voice_budget_concurrency: ok (charged=$CHARGED count=$COUNT)"
