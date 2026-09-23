#!/usr/bin/env bash
# Parallel quote references and a single converted order.
set -euo pipefail

DB_URL="${1:?usage: phase33_quotes_concurrency.sh <database-url>}"
TENANT="e3310000-0000-4000-8000-000000000011"
OWNER="e3310000-0000-4000-8000-000000000001"
QUOTE=""

psql_at() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "$1"
}

cleanup() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL || true
delete from public.tenants where id = '${TENANT}';
delete from auth.users where id = '${OWNER}';
SQL
}
trap cleanup EXIT

psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) values (
  '${OWNER}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'owner@phase33-concurrent.test', crypt('pw', gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
);
insert into public.profiles (id, full_name) values ('${OWNER}', 'Concurrent');
insert into public.tenants (id, name, slug, active)
values ('${TENANT}', 'Phase33 Concurrent', 'phase33conc', true);
insert into public.memberships (tenant_id, user_id, role, active)
values ('${TENANT}', '${OWNER}', 'owner', true);
select public.seed_quote_statuses('${TENANT}'::uuid);
insert into public.order_statuses (
  tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
) values (
  '${TENANT}', 'Recibido', 'received', true, false, false, false, true, 1
);
select public.set_tenant_feature('phase33conc', 'quotes', true, null);
SQL

insert_quote() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    select set_config('request.jwt.claim.sub', '${OWNER}', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
    set role authenticated;
    insert into public.quotes (tenant_id, description, status_id)
    select '${TENANT}', 'Paralelo', id
    from public.quote_statuses
    where tenant_id = '${TENANT}' and code = 'draft';
  " >/dev/null
}

for _ in 1 2 3 4 5 6 7 8; do
  insert_quote &
done
wait

COUNT="$(psql_at "select count(*) from public.quotes where tenant_id = '${TENANT}'")"
DISTINCT="$(psql_at "select count(distinct reference) from public.quotes where tenant_id = '${TENANT}'")"
if [[ "$COUNT" != "8" || "$DISTINCT" != "8" ]]; then
  echo "phase33 concurrency: expected 8 unique references, got ${COUNT} / ${DISTINCT}" >&2
  exit 1
fi

QUOTE="$(psql_at "select id from public.quotes where tenant_id = '${TENANT}' order by reference limit 1")"

convert_quote() {
  psql "$DB_URL" -v ON_ERROR_STOP=1 -qAtc "
    select set_config('request.jwt.claim.sub', '${OWNER}', false);
    select set_config('request.jwt.claim.role', 'authenticated', false);
    set role authenticated;
    select public.convert_quote_to_order('${QUOTE}'::uuid) ->> 'order_id';
  " >"$1"
}

convert_quote /tmp/phase33-convert-a.txt &
convert_quote /tmp/phase33-convert-b.txt &
wait

ORDERS="$(psql_at "select count(*) from public.orders where tenant_id = '${TENANT}'")"
LINKED="$(psql_at "select count(distinct converted_order_id) from public.quotes where id = '${QUOTE}' and converted_order_id is not null")"
if [[ "$ORDERS" != "1" || "$LINKED" != "1" ]]; then
  echo "phase33 concurrency: expected 1 order, got orders=${ORDERS} linked=${LINKED}" >&2
  exit 1
fi

REPLAY="$(psql_at "
  select set_config('request.jwt.claim.sub', '${OWNER}', false);
  select set_config('request.jwt.claim.role', 'authenticated', false);
  set role authenticated;
  select public.convert_quote_to_order('${QUOTE}'::uuid) ->> 'order_id';
" | tail -n 1)"
STORED="$(psql_at "select converted_order_id::text from public.quotes where id = '${QUOTE}'")"
if [[ "$REPLAY" != "$STORED" ]]; then
  echo "phase33 concurrency: replay ${REPLAY} != ${STORED}" >&2
  exit 1
fi

echo "phase33 concurrency ok"
