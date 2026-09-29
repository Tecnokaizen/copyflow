#!/usr/bin/env bash
# Two transfers that promote the same user in different tenants.
# The user lock shared with create_organization must leave exactly one owner membership.
set -euo pipefail

DB_URL="${1:?usage: phase38_ownership_transfer_concurrency.sh <database-url>}"
READY="$(mktemp)"
OWNER_A='a3810000-0000-4000-8000-000000000001'
OWNER_B='a3810000-0000-4000-8000-000000000002'
TARGET='a3810000-0000-4000-8000-000000000003'
TENANT_A='a3810000-0000-4000-8000-000000000011'
TENANT_B='a3810000-0000-4000-8000-000000000012'

cleanup() {
  rm -f "$READY"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.activity_log where tenant_id in ('$TENANT_A', '$TENANT_B');
    delete from public.memberships where tenant_id in ('$TENANT_A', '$TENANT_B');
    delete from public.tenants where id in ('$TENANT_A', '$TENANT_B');
    delete from public.profiles where id in ('$OWNER_A', '$OWNER_B', '$TARGET');
    delete from auth.users where id in ('$OWNER_A', '$OWNER_B', '$TARGET');
  " >/dev/null || true
}

trap cleanup EXIT
cleanup

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) values
  ('$OWNER_A', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner-a@phase38c.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Owner A"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('$OWNER_B', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner-b@phase38c.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Owner B"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('$TARGET', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'target@phase38c.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Target"}'::jsonb,
   now(), now(), '', '', '', '');
insert into public.profiles (id, full_name) values
  ('$OWNER_A', 'Owner A'),
  ('$OWNER_B', 'Owner B'),
  ('$TARGET', 'Target');
insert into public.tenants (id, name, slug, active) values
  ('$TENANT_A', 'Phase38 Conc A', 'phase38-conc-a', true),
  ('$TENANT_B', 'Phase38 Conc B', 'phase38-conc-b', true);
insert into public.memberships (tenant_id, user_id, role, active) values
  ('$TENANT_A', '$OWNER_A', 'owner', true),
  ('$TENANT_A', '$TARGET', 'admin', true),
  ('$TENANT_B', '$OWNER_B', 'owner', true),
  ('$TENANT_B', '$TARGET', 'admin', true);
SQL

psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase38-session1.out <<SQL &
begin;
select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('${TARGET}', 0));
\\! touch ${READY}
select pg_sleep(5);
select set_config('request.jwt.claim.sub', '${OWNER_A}', true);
set local role authenticated;
select public.transfer_tenant_ownership('${TENANT_A}'::uuid, '${TARGET}'::uuid);
reset role;
commit;
SQL
session1=$!

for _ in $(seq 1 50); do
  if [[ -f "$READY" ]]; then
    break
  fi
  sleep 0.1
done

if [[ ! -f "$READY" ]]; then
  echo "phase38 concurrency: session 1 did not take the user lock" >&2
  wait "$session1" || true
  exit 1
fi

set +e
session2_out="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL 2>&1
begin;
select set_config('request.jwt.claim.sub', '${OWNER_B}', true);
set local role authenticated;
select public.transfer_tenant_ownership('${TENANT_B}'::uuid, '${TARGET}'::uuid);
reset role;
commit;
SQL
)"
session2_code=$?
set -e

wait "$session1"

if [[ "$session2_code" -eq 0 ]]; then
  echo "phase38 concurrency: second transfer succeeded" >&2
  echo "$session2_out" >&2
  exit 1
fi

if ! grep -q "organization limit reached" <<<"$session2_out"; then
  echo "phase38 concurrency: expected organization limit, got:" >&2
  echo "$session2_out" >&2
  exit 1
fi

owners="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select count(*)
  from public.memberships
  where user_id = '$TARGET' and role = 'owner' and active = true;
")"

if [[ "$owners" != "1" ]]; then
  echo "phase38 concurrency: target owner memberships=$owners" >&2
  exit 1
fi

role_a="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$TENANT_A' and user_id = '$OWNER_A';
")"
role_b="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$TENANT_B' and user_id = '$OWNER_B';
")"

if [[ "$role_a" != "admin" || "$role_b" != "owner" ]]; then
  echo "phase38 concurrency: actor roles A=$role_a B=$role_b" >&2
  exit 1
fi

echo "phase38 ownership transfer concurrency OK"
