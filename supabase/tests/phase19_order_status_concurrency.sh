#!/usr/bin/env bash
# Concurrent set_order_status_initial must leave exactly one active initial.
set -euo pipefail

DB_URL="${1:?usage: phase19_order_status_concurrency.sh <database-url>}"

psql_value() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

OWNER_A='e1910000-0000-4000-8000-000000000001'
TENANT_A='e1910000-0000-4000-8000-000000000011'
STATUS_A='e1910000-0000-4000-8000-000000000021'
STATUS_B='e1910000-0000-4000-8000-000000000022'
STATUS_C='e1910000-0000-4000-8000-000000000023'

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.order_statuses where tenant_id = '$TENANT_A';
    delete from public.memberships where tenant_id = '$TENANT_A';
    delete from public.tenants where id = '$TENANT_A';
    delete from public.profiles where id = '$OWNER_A';
    delete from auth.users where id = '$OWNER_A';
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
    'owner-conc@phase19.test', crypt('pw', gen_salt('bf')), now(),
    '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name) values ('$OWNER_A', 'Owner Conc');
  insert into public.tenants (id, name, slug, active)
    values ('$TENANT_A', 'Tenant Conc Phase19', 'tenant-conc-phase19', true);
  insert into public.memberships (tenant_id, user_id, role, active)
    values ('$TENANT_A', '$OWNER_A', 'owner', true);
  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values
    ('$STATUS_A', '$TENANT_A', 'A', 'status_a', true, false, false, false, true, 1),
    ('$STATUS_B', '$TENANT_A', 'B', 'status_b', false, true, false, false, true, 2),
    ('$STATUS_C', '$TENANT_A', 'C', 'status_c', false, false, false, false, true, 3);
"

run_session() {
  local target="$1"
  local out="$2"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    begin;
    select set_config('request.jwt.claim.sub', '$OWNER_A', true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select public.set_order_status_initial('$TENANT_A'::uuid, '$target'::uuid) #>> '{status,id}';
    commit;
  " >"$out" 2>&1 || true
}

OUT_B="$(mktemp)"
OUT_C="$(mktemp)"

run_session "$STATUS_B" "$OUT_B" &
PID_B=$!
run_session "$STATUS_C" "$OUT_C" &
PID_C=$!

wait "$PID_B" || true
wait "$PID_C" || true

INITIAL_COUNT="$(psql_value "
  select count(*) from public.order_statuses
  where tenant_id = '$TENANT_A' and is_initial = true and active = true;
")"

ACTIVE_INITIAL_INACTIVE="$(psql_value "
  select count(*) from public.order_statuses
  where tenant_id = '$TENANT_A' and is_initial = true and active = false;
")"

SECOND_INITIAL="$(psql_value "
  select count(*) from public.order_statuses
  where tenant_id = '$TENANT_A' and is_initial = true;
")"

if [[ "$INITIAL_COUNT" != "1" ]]; then
  echo "concurrency: expected exactly 1 active initial, got $INITIAL_COUNT" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  echo "--- C ---" >&2; cat "$OUT_C" >&2
  exit 1
fi

if [[ "$ACTIVE_INITIAL_INACTIVE" != "0" ]]; then
  echo "concurrency: found inactive initial" >&2
  exit 1
fi

if [[ "$SECOND_INITIAL" != "1" ]]; then
  echo "concurrency: expected exactly 1 is_initial row, got $SECOND_INITIAL" >&2
  exit 1
fi

# At least one of the concurrent calls must have succeeded.
if ! grep -Eq "$STATUS_B|$STATUS_C" "$OUT_B" && ! grep -Eq "$STATUS_B|$STATUS_C" "$OUT_C"; then
  echo "concurrency: neither session returned a status id" >&2
  echo "--- B ---" >&2; cat "$OUT_B" >&2
  echo "--- C ---" >&2; cat "$OUT_C" >&2
  exit 1
fi

echo "phase19_order_status_concurrency: ok (active_initial=$INITIAL_COUNT)"
