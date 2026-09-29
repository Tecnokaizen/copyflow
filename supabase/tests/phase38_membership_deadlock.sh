#!/usr/bin/env bash
# Transfer vs membership mutations on one tenant must not deadlock (40P01).
# All three RPCs take gestcopy.membership.tenant:<tenant> before row locks.
set -euo pipefail

DB_URL="${1:?usage: phase38_membership_deadlock.sh <database-url>}"
OWNER='a3820000-0000-4000-8000-000000000001'
OWNER_B='a3820000-0000-4000-8000-000000000002'
ADMIN='a3820000-0000-4000-8000-000000000003'
STAFF='a3820000-0000-4000-8000-000000000004'
TENANT='a3820000-0000-4000-8000-000000000011'
LOCK_KEY="gestcopy.membership.tenant:${TENANT}"

cleanup() {
  rm -f /tmp/phase38-deadlock-ready /tmp/phase38-deadlock-s1.out /tmp/phase38-deadlock-s2.out
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.activity_log where tenant_id = '$TENANT';
    delete from public.memberships where tenant_id = '$TENANT';
    delete from public.tenants where id = '$TENANT';
    delete from public.profiles where id in ('$OWNER', '$OWNER_B', '$ADMIN', '$STAFF');
    delete from auth.users where id in ('$OWNER', '$OWNER_B', '$ADMIN', '$STAFF');
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
  ('$OWNER', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner@phase38d.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Owner"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('$OWNER_B', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner-b@phase38d.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Owner B"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('$ADMIN', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'admin@phase38d.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Admin"}'::jsonb,
   now(), now(), '', '', '', ''),
  ('$STAFF', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'staff@phase38d.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Staff"}'::jsonb,
   now(), now(), '', '', '', '');
insert into public.profiles (id, full_name) values
  ('$OWNER', 'Owner'),
  ('$OWNER_B', 'Owner B'),
  ('$ADMIN', 'Admin'),
  ('$STAFF', 'Staff');
insert into public.tenants (id, name, slug, active) values
  ('$TENANT', 'Phase38 Deadlock', 'phase38-deadlock', true);
SQL

reset_memberships() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
delete from public.activity_log where tenant_id = '$TENANT';
delete from public.memberships where tenant_id = '$TENANT';
insert into public.memberships (tenant_id, user_id, role, active) values
  ('$TENANT', '$OWNER', 'owner', true),
  ('$TENANT', '$OWNER_B', 'owner', true),
  ('$TENANT', '$ADMIN', 'admin', true),
  ('$TENANT', '$STAFF', 'staff', true);
SQL
}

reject_deadlock() {
  if grep -E -q '40P01|deadlock detected' /tmp/phase38-deadlock-s1.out /tmp/phase38-deadlock-s2.out; then
    echo "phase38 deadlock: 40P01 in $1" >&2
    cat /tmp/phase38-deadlock-s1.out /tmp/phase38-deadlock-s2.out >&2
    exit 1
  fi
}

run_against_transfer() {
  local label="$1"
  local actor2="$2"
  local statement="$3"
  rm -f /tmp/phase38-deadlock-ready
  : > /tmp/phase38-deadlock-s1.out
  : > /tmp/phase38-deadlock-s2.out

  psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase38-deadlock-s1.out 2>&1 <<SQL &
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('${LOCK_KEY}', 0)
);
\\! touch /tmp/phase38-deadlock-ready
select pg_sleep(5);
select set_config('request.jwt.claim.sub', '${OWNER}', true);
set local role authenticated;
select public.transfer_tenant_ownership('${TENANT}'::uuid, '${ADMIN}'::uuid);
reset role;
commit;
SQL
  local session1=$!

  local ready=0
  for _ in $(seq 1 50); do
    if [[ -f /tmp/phase38-deadlock-ready ]]; then
      ready=1
      break
    fi
    sleep 0.1
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "phase38 deadlock: $label session 1 did not take the tenant lock" >&2
    wait "$session1" || true
    cat /tmp/phase38-deadlock-s1.out >&2
    exit 1
  fi

  set +e
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase38-deadlock-s2.out 2>&1 <<SQL
begin;
select set_config('request.jwt.claim.sub', '${actor2}', true);
set local role authenticated;
${statement}
reset role;
commit;
SQL
  local session2_code=$?
  set -e
  set +e
  wait "$session1"
  local session1_code=$?
  set -e

  reject_deadlock "$label"
  if [[ "$session1_code" -ne 0 || "$session2_code" -ne 0 ]]; then
    echo "phase38 deadlock: $label failed s1=$session1_code s2=$session2_code" >&2
    cat /tmp/phase38-deadlock-s1.out /tmp/phase38-deadlock-s2.out >&2
    exit 1
  fi
}

reset_memberships
run_against_transfer \
  "transfer vs set_active" \
  "$OWNER" \
  "select public.set_tenant_membership_active('${TENANT}'::uuid, '${STAFF}'::uuid, false);"

staff_active="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select active::text from public.memberships
  where tenant_id = '$TENANT' and user_id = '$STAFF';
")"
admin_role="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$TENANT' and user_id = '$ADMIN';
")"
if [[ "$staff_active" != "false" || "$admin_role" != "owner" ]]; then
  echo "phase38 deadlock: set_active result staff_active=$staff_active admin=$admin_role" >&2
  exit 1
fi

reset_memberships
run_against_transfer \
  "transfer vs update_role" \
  "$OWNER" \
  "select public.update_tenant_membership_role('${TENANT}'::uuid, '${STAFF}'::uuid, 'viewer');"

staff_role="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$TENANT' and user_id = '$STAFF';
")"
if [[ "$staff_role" != "viewer" ]]; then
  echo "phase38 deadlock: update_role left staff as $staff_role" >&2
  exit 1
fi

reset_memberships
run_against_transfer \
  "transfer vs transfer" \
  "$OWNER_B" \
  "select public.transfer_tenant_ownership('${TENANT}'::uuid, '${STAFF}'::uuid);"

pair="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select user_id::text || ':' || role
  from public.memberships
  where tenant_id = '$TENANT'
    and user_id in ('$OWNER', '$OWNER_B', '$ADMIN', '$STAFF')
  order by user_id;
")"
expected="${OWNER}:admin
${OWNER_B}:admin
${ADMIN}:owner
${STAFF}:owner"
if [[ "$pair" != "$expected" ]]; then
  echo "phase38 deadlock: same-tenant transfers left:" >&2
  echo "$pair" >&2
  exit 1
fi

echo "phase38 membership deadlock OK"
