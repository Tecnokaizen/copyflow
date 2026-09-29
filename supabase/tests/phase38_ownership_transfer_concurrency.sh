#!/usr/bin/env bash
# Two owners transfer the same active member in two different tenants.
# Both commits are valid: owner is tenant-scoped. Neither waits on a user lock.
set -euo pipefail

DB_URL="${1:?usage: phase38_ownership_transfer_concurrency.sh <database-url>}"
READY="$(mktemp)"
OWNER_A='a3810000-0000-4000-8000-000000000001'
OWNER_B='a3810000-0000-4000-8000-000000000002'
TARGET='a3810000-0000-4000-8000-000000000003'
TENANT_A='a3810000-0000-4000-8000-000000000011'
TENANT_B='a3810000-0000-4000-8000-000000000012'
LOCK_A="gestcopy.membership.tenant:${TENANT_A}"

cleanup() {
  rm -f "$READY" /tmp/phase38-session1.out /tmp/phase38-session2.out
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

psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase38-session1.out 2>&1 <<SQL &
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('${LOCK_A}', 0)
);
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
  echo "phase38 concurrency: session 1 did not take the tenant lock" >&2
  wait "$session1" || true
  cat /tmp/phase38-session1.out >&2
  exit 1
fi

started=$(date +%s)
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase38-session2.out 2>&1 <<SQL
begin;
select set_config('request.jwt.claim.sub', '${OWNER_B}', true);
set local role authenticated;
select public.transfer_tenant_ownership('${TENANT_B}'::uuid, '${TARGET}'::uuid);
reset role;
commit;
SQL
session2_code=$?
set -e
elapsed=$(( $(date +%s) - started ))

if [[ "$session2_code" -ne 0 ]]; then
  echo "phase38 concurrency: tenant B transfer failed" >&2
  cat /tmp/phase38-session2.out >&2
  wait "$session1" || true
  exit 1
fi

if [[ "$elapsed" -ge 4 ]]; then
  echo "phase38 concurrency: tenant B waited on a global lock (${elapsed}s)" >&2
  exit 1
fi

set +e
wait "$session1"
session1_code=$?
set -e

if grep -E -q '40P01|deadlock detected' /tmp/phase38-session1.out /tmp/phase38-session2.out; then
  echo "phase38 concurrency: deadlock" >&2
  cat /tmp/phase38-session1.out /tmp/phase38-session2.out >&2
  exit 1
fi

if [[ "$session1_code" -ne 0 ]]; then
  echo "phase38 concurrency: tenant A transfer failed" >&2
  cat /tmp/phase38-session1.out >&2
  exit 1
fi

owners="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select count(*)
  from public.memberships
  where user_id = '$TARGET' and role = 'owner' and active = true;
")"

if [[ "$owners" != "2" ]]; then
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
target_a="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$TENANT_A' and user_id = '$TARGET';
")"
target_b="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$TENANT_B' and user_id = '$TARGET';
")"

if [[ "$role_a" != "admin" || "$role_b" != "admin" || "$target_a" != "owner" || "$target_b" != "owner" ]]; then
  echo "phase38 concurrency: roles A=$role_a B=$role_b targetA=$target_a targetB=$target_b" >&2
  exit 1
fi

echo "phase38 ownership transfer concurrency OK"
