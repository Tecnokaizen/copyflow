#!/usr/bin/env bash
# Membership mutation concurrency / deadlock.
# transfer, role change and deactivation of one tenant share
# gestcopy.membership.tenant:<tenant_id> and must not raise 40P01.
# A second tenant must keep progressing while the first lock is held.
set -euo pipefail

DB_URL="${1:?usage: phase39_membership_mutation_deadlock.sh <database-url>}"

OWNER='a3930000-0000-4000-8000-000000000001'
OWNER_B='a3930000-0000-4000-8000-000000000002'
ADMIN='a3930000-0000-4000-8000-000000000003'
STAFF='a3930000-0000-4000-8000-000000000004'
TENANT='a3930000-0000-4000-8000-000000000011'
LOCK_KEY="gestcopy.membership.tenant:${TENANT}"

ISO_OWNER_A='a3931000-0000-4000-8000-000000000001'
ISO_TARGET_A='a3931000-0000-4000-8000-000000000002'
ISO_OWNER_B='a3931000-0000-4000-8000-000000000003'
ISO_SHARED='a3931000-0000-4000-8000-000000000004'
ISO_TENANT_A='a3931000-0000-4000-8000-000000000011'
ISO_TENANT_B='a3931000-0000-4000-8000-000000000012'
ISO_LOCK_KEY="gestcopy.membership.tenant:${ISO_TENANT_A}"

cleanup() {
  rm -f /tmp/phase39-deadlock-ready /tmp/phase39-deadlock-s1.out /tmp/phase39-deadlock-s2.out \
    /tmp/phase39-isolation-ready /tmp/phase39-isolation-s1.out /tmp/phase39-isolation-s2.out
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    delete from public.activity_log where tenant_id in ('$TENANT', '$ISO_TENANT_A', '$ISO_TENANT_B');
    delete from public.memberships where tenant_id in ('$TENANT', '$ISO_TENANT_A', '$ISO_TENANT_B');
    delete from public.tenants where id in ('$TENANT', '$ISO_TENANT_A', '$ISO_TENANT_B');
    delete from public.profiles where id in (
      '$OWNER', '$OWNER_B', '$ADMIN', '$STAFF',
      '$ISO_OWNER_A', '$ISO_TARGET_A', '$ISO_OWNER_B', '$ISO_SHARED'
    );
    delete from auth.users where id in (
      '$OWNER', '$OWNER_B', '$ADMIN', '$STAFF',
      '$ISO_OWNER_A', '$ISO_TARGET_A', '$ISO_OWNER_B', '$ISO_SHARED'
    );
  " >/dev/null || true
}

trap cleanup EXIT
cleanup

insert_user() {
  local id="$1"
  local email="$2"
  local name="$3"
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) values (
  '$id', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '$email', crypt('pw', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"$name"}'::jsonb,
  now(), now(), '', '', '', ''
);
insert into public.profiles (id, full_name) values ('$id', '$name');
SQL
}

insert_user "$OWNER" "owner@phase39d.test" "Owner"
insert_user "$OWNER_B" "owner-b@phase39d.test" "Owner B"
insert_user "$ADMIN" "admin@phase39d.test" "Admin"
insert_user "$STAFF" "staff@phase39d.test" "Staff"
insert_user "$ISO_OWNER_A" "iso-owner-a@phase39d.test" "Iso Owner A"
insert_user "$ISO_TARGET_A" "iso-target-a@phase39d.test" "Iso Target A"
insert_user "$ISO_OWNER_B" "iso-owner-b@phase39d.test" "Iso Owner B"
insert_user "$ISO_SHARED" "iso-shared@phase39d.test" "Iso Shared"

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into public.tenants (id, name, slug, active) values
  ('$TENANT', 'Phase39 Deadlock', 'phase39-deadlock', true),
  ('$ISO_TENANT_A', 'Phase39 Iso A', 'phase39-iso-a', true),
  ('$ISO_TENANT_B', 'Phase39 Iso B', 'phase39-iso-b', true);
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
  if grep -E -q '40P01|deadlock detected' /tmp/phase39-deadlock-s1.out /tmp/phase39-deadlock-s2.out; then
    echo "phase39 deadlock: 40P01 in $1" >&2
    cat /tmp/phase39-deadlock-s1.out /tmp/phase39-deadlock-s2.out >&2
    exit 1
  fi
}

run_against_transfer() {
  local label="$1"
  local actor2="$2"
  local statement="$3"
  rm -f /tmp/phase39-deadlock-ready
  : > /tmp/phase39-deadlock-s1.out
  : > /tmp/phase39-deadlock-s2.out

  psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase39-deadlock-s1.out 2>&1 <<SQL &
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('${LOCK_KEY}', 0)
);
\\! touch /tmp/phase39-deadlock-ready
select pg_sleep(4);
select set_config('request.jwt.claim.sub', '${OWNER}', true);
set local role authenticated;
select public.transfer_tenant_ownership('${TENANT}'::uuid, '${ADMIN}'::uuid);
reset role;
commit;
SQL
  local session1=$!

  local ready=0
  for _ in $(seq 1 50); do
    if [[ -f /tmp/phase39-deadlock-ready ]]; then
      ready=1
      break
    fi
    sleep 0.1
  done
  if [[ "$ready" -ne 1 ]]; then
    echo "phase39 deadlock: $label session 1 did not take the tenant lock" >&2
    wait "$session1" || true
    cat /tmp/phase39-deadlock-s1.out >&2
    exit 1
  fi

  set +e
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase39-deadlock-s2.out 2>&1 <<SQL
begin;
set local statement_timeout = '20s';
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
    echo "phase39 deadlock: $label failed s1=$session1_code s2=$session2_code" >&2
    cat /tmp/phase39-deadlock-s1.out /tmp/phase39-deadlock-s2.out >&2
    exit 1
  fi
}

reset_memberships
run_against_transfer \
  "transfer vs update_role" \
  "$OWNER" \
  "select public.update_tenant_membership_role('${TENANT}'::uuid, '${STAFF}'::uuid, 'viewer');"

staff_role="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$TENANT' and user_id = '$STAFF';
")"
admin_role="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$TENANT' and user_id = '$ADMIN';
")"
owner_count="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select count(*) from public.memberships
  where tenant_id = '$TENANT' and role = 'owner' and active = true;
")"
if [[ "$staff_role" != "viewer" || "$admin_role" != "owner" || "$owner_count" -lt 1 ]]; then
  echo "phase39 deadlock: update_role left staff=$staff_role admin=$admin_role owners=$owner_count" >&2
  exit 1
fi

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
  echo "phase39 deadlock: set_active left staff_active=$staff_active admin=$admin_role" >&2
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
  echo "phase39 deadlock: same-tenant transfers left:" >&2
  echo "$pair" >&2
  exit 1
fi

owner_count="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select count(*) from public.memberships
  where tenant_id = '$TENANT' and role = 'owner' and active = true;
")"
if [[ "$owner_count" -lt 1 ]]; then
  echo "phase39 deadlock: tenant left without owner" >&2
  exit 1
fi

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into public.memberships (tenant_id, user_id, role, active) values
  ('$ISO_TENANT_A', '$ISO_OWNER_A', 'owner', true),
  ('$ISO_TENANT_A', '$ISO_TARGET_A', 'admin', true),
  ('$ISO_TENANT_A', '$ISO_SHARED', 'staff', true),
  ('$ISO_TENANT_B', '$ISO_OWNER_B', 'owner', true),
  ('$ISO_TENANT_B', '$ISO_SHARED', 'admin', true);
SQL

rm -f /tmp/phase39-isolation-ready
: > /tmp/phase39-isolation-s1.out
: > /tmp/phase39-isolation-s2.out

psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase39-isolation-s1.out 2>&1 <<SQL &
begin;
select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('${ISO_LOCK_KEY}', 0)
);
\\! touch /tmp/phase39-isolation-ready
select pg_sleep(4);
select set_config('request.jwt.claim.sub', '${ISO_OWNER_A}', true);
set local role authenticated;
select public.transfer_tenant_ownership('${ISO_TENANT_A}'::uuid, '${ISO_TARGET_A}'::uuid);
reset role;
commit;
SQL
session_a=$!

ready=0
for _ in $(seq 1 50); do
  if [[ -f /tmp/phase39-isolation-ready ]]; then
    ready=1
    break
  fi
  sleep 0.1
done
if [[ "$ready" -ne 1 ]]; then
  echo "phase39 isolation: tenant A lock was not acquired" >&2
  wait "$session_a" || true
  cat /tmp/phase39-isolation-s1.out >&2
  exit 1
fi

started_ms="$(python3 -c 'import time; print(int(time.time()*1000))')"
set +e
psql "$DB_URL" -v ON_ERROR_STOP=1 -q >/tmp/phase39-isolation-s2.out 2>&1 <<SQL
begin;
set local statement_timeout = '8s';
select set_config('request.jwt.claim.sub', '${ISO_OWNER_B}', true);
set local role authenticated;
select public.transfer_tenant_ownership('${ISO_TENANT_B}'::uuid, '${ISO_SHARED}'::uuid);
reset role;
commit;
SQL
session_b_code=$?
set -e
finished_ms="$(python3 -c 'import time; print(int(time.time()*1000))')"
elapsed_ms=$((finished_ms - started_ms))

set +e
wait "$session_a"
session_a_code=$?
set -e

if grep -E -q '40P01|deadlock detected' /tmp/phase39-isolation-s1.out /tmp/phase39-isolation-s2.out; then
  echo "phase39 isolation: 40P01" >&2
  cat /tmp/phase39-isolation-s1.out /tmp/phase39-isolation-s2.out >&2
  exit 1
fi
if [[ "$session_a_code" -ne 0 || "$session_b_code" -ne 0 ]]; then
  echo "phase39 isolation failed a=$session_a_code b=$session_b_code elapsed=${elapsed_ms}ms" >&2
  cat /tmp/phase39-isolation-s1.out /tmp/phase39-isolation-s2.out >&2
  exit 1
fi
if [[ "$elapsed_ms" -ge 2500 ]]; then
  echo "phase39 isolation: tenant B waited ${elapsed_ms}ms on tenant A lock" >&2
  exit 1
fi

iso_a="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$ISO_TENANT_A' and user_id = '$ISO_TARGET_A';
")"
iso_b="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$ISO_TENANT_B' and user_id = '$ISO_SHARED';
")"
iso_shared_a="$(psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
  select role from public.memberships
  where tenant_id = '$ISO_TENANT_A' and user_id = '$ISO_SHARED';
")"
if [[ "$iso_a" != "owner" || "$iso_b" != "owner" || "$iso_shared_a" != "staff" ]]; then
  echo "phase39 isolation roles a_target=$iso_a b_shared=$iso_b a_shared=$iso_shared_a" >&2
  exit 1
fi

echo "phase39 membership mutation concurrency OK"
