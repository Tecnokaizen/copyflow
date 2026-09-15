-- Kiosk V1: signed least-privilege RPC, opt-in, atomic validation and rate.
-- Run after 20260915191521_kiosk_public_orders.sql.

begin;

select vault.create_secret(
  'phase12-kiosk-signing-secret-at-least-32-chars',
  'kiosk_signing_secret',
  'Kiosk phase12 test secret'
);

do $phase12$
declare
  v_secret text := 'phase12-kiosk-signing-secret-at-least-32-chars';
  v_client_address text := '203.0.113.8';
  v_client_key text;
  v_issued_at bigint := extract(epoch from now())::bigint;
  v_demo_signature text;
  v_sur4_signature text;
  v_owner_demo uuid := 'ac000000-0000-4000-8000-000000000000';
  v_tenant_demo uuid := 'ac000000-0000-4000-8000-000000000001';
  v_tenant_sur4 uuid := 'ac000000-0000-4000-8000-000000000002';
  v_service_demo uuid := 'ac000000-0000-4000-8000-000000000011';
  v_service_sur4 uuid := 'ac000000-0000-4000-8000-000000000012';
  v_status_demo uuid := 'ac000000-0000-4000-8000-000000000021';
  v_status_sur4 uuid := 'ac000000-0000-4000-8000-000000000022';
  v_channel_demo uuid := 'ac000000-0000-4000-8000-000000000031';
  v_order_demo uuid := 'ac000000-0000-4000-8000-000000000041';
  v_order_internal uuid := 'ac000000-0000-4000-8000-000000000042';
  v_rate_order uuid;
  v_result jsonb;
  v_count integer;
begin
  v_client_key := encode(
    extensions.hmac(
      convert_to('client|' || v_client_address, 'UTF8'),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_demo_signature := encode(
    extensions.hmac(
      convert_to(
        'kiosk-v1|demo-phase12|' || v_client_key || '|' || v_issued_at,
        'UTF8'
      ),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  v_sur4_signature := encode(
    extensions.hmac(
      convert_to(
        'kiosk-v1|sur4-phase12|' || v_client_key || '|' || v_issued_at,
        'UTF8'
      ),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_demo, 'DEMO Phase12', 'demo-phase12', true),
    (v_tenant_sur4, 'SUR4 Phase12', 'sur4-phase12', true);

  -- Kiosk must not be enabled by migration or tenant creation.
  select count(*) into v_count
  from public.entry_channels
  where tenant_id in (v_tenant_demo, v_tenant_sur4)
    and code = 'kiosk';
  if v_count <> 0 then
    raise exception 'FAIL Kiosk was auto-enabled for new tenants';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner_demo,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'owner-demo@phase12.test',
    crypt('pw', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Owner DEMO"}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name)
  values (v_owner_demo, 'Owner DEMO');
  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant_demo, v_owner_demo, 'owner', true);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_demo, v_tenant_demo, 'Impresión DEMO', true, 1),
    (v_service_sur4, v_tenant_sur4, 'Impresión SUR4', true, 1);
  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, active, sort_order
  ) values
    (v_status_demo, v_tenant_demo, 'Recibido', 'received', true, true, 1),
    (v_status_sur4, v_tenant_sur4, 'Pendiente', 'pending', true, true, 1);

  -- Explicit tenant configuration opts DEMO in; SUR4 stays disabled.
  insert into public.entry_channels (
    id, tenant_id, name, code, active, sort_order
  ) values (
    v_channel_demo, v_tenant_demo, 'Kiosk', 'kiosk', true, 1000
  );

  if has_table_privilege('anon', 'public.orders', 'SELECT')
     or has_table_privilege('anon', 'public.orders', 'INSERT')
     or has_table_privilege('anon', 'public.clients', 'SELECT')
     or has_table_privilege('anon', 'public.team_members', 'SELECT')
     or has_table_privilege('anon', 'public.services', 'SELECT') then
    raise exception 'FAIL anon gained direct business-table access';
  end if;

  if has_function_privilege(
    'service_role',
    'public.submit_kiosk_order(text,text,bigint,text,uuid,text,text,uuid,text,text,text,text,timestamptz,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL service_role can execute Kiosk submission';
  end if;

  execute 'set local role anon';

  v_result := public.kiosk_bootstrap(
    'demo-phase12', v_client_key, v_issued_at, v_demo_signature
  );
  if v_result ->> 'status' <> 'ready'
     or v_result #>> '{tenant,name}' <> 'DEMO Phase12'
     or jsonb_array_length(v_result -> 'services') <> 1 then
    raise exception 'FAIL DEMO signed bootstrap: %', v_result;
  end if;

  v_result := public.kiosk_bootstrap(
    'sur4-phase12', v_client_key, v_issued_at, v_sur4_signature
  );
  if v_result ->> 'status' <> 'unavailable' then
    raise exception 'FAIL SUR4 should remain opt-out: %', v_result;
  end if;

  v_result := public.submit_kiosk_order(
    'sur4-phase12',
    v_client_key,
    v_issued_at,
    v_sur4_signature,
    'ac000000-0000-4000-8000-000000000049',
    repeat('c', 64),
    'Pedido bloqueado',
    v_service_sur4,
    'Cliente SUR4',
    null,
    '600123123',
    'Pedido bloqueado',
    null,
    null
  );
  if v_result ->> 'status' <> 'unavailable' then
    raise exception 'FAIL opt-out submit should be unavailable: %', v_result;
  end if;

  -- A DEMO signature cannot be reused to select SUR4 directly.
  v_result := public.kiosk_bootstrap(
    'sur4-phase12', v_client_key, v_issued_at, v_demo_signature
  );
  if v_result ->> 'status' <> 'not_found' then
    raise exception 'FAIL signature allowed arbitrary tenant: %', v_result;
  end if;

  v_result := public.submit_kiosk_order(
    'demo-phase12',
    v_client_key,
    v_issued_at,
    v_demo_signature,
    v_order_demo,
    repeat('f', 64),
    '200 tarjetas',
    v_service_demo,
    'Ana Ruiz',
    'ana@example.com',
    null,
    '200 tarjetas',
    null,
    'Papel mate'
  );
  if v_result ->> 'status' <> 'created' then
    raise exception 'FAIL Kiosk create: %', v_result;
  end if;

  -- Same transaction function owns validation + insert and replay.
  v_result := public.submit_kiosk_order(
    'demo-phase12',
    v_client_key,
    v_issued_at,
    v_demo_signature,
    v_order_demo,
    repeat('f', 64),
    '200 tarjetas',
    v_service_demo,
    'Ana Ruiz',
    'ana@example.com',
    null,
    '200 tarjetas',
    null,
    'Papel mate'
  );
  if v_result ->> 'status' <> 'replay' then
    raise exception 'FAIL Kiosk replay: %', v_result;
  end if;

  v_result := public.submit_kiosk_order(
    'demo-phase12',
    v_client_key,
    v_issued_at,
    v_demo_signature,
    'ac000000-0000-4000-8000-000000000043',
    repeat('e', 64),
    'Cross tenant',
    v_service_sur4,
    'Ana Ruiz',
    'ana@example.com',
    null,
    'Cross tenant',
    null,
    null
  );
  if v_result ->> 'status' <> 'invalid_service' then
    raise exception 'FAIL cross-tenant service: %', v_result;
  end if;

  foreach v_rate_order in array array[
    'ac000000-0000-4000-8000-000000000044'::uuid,
    'ac000000-0000-4000-8000-000000000045'::uuid,
    'ac000000-0000-4000-8000-000000000046'::uuid,
    'ac000000-0000-4000-8000-000000000047'::uuid
  ] loop
    v_result := public.submit_kiosk_order(
      'demo-phase12',
      v_client_key,
      v_issued_at,
      v_demo_signature,
      v_rate_order,
      repeat('a', 64),
      'Pedido rate',
      v_service_demo,
      'Ana Ruiz',
      'ana@example.com',
      null,
      'Pedido rate',
      null,
      null
    );
    if v_result ->> 'status' <> 'created' then
      raise exception 'FAIL distributed rate setup: %', v_result;
    end if;
  end loop;

  v_result := public.submit_kiosk_order(
    'demo-phase12',
    v_client_key,
    v_issued_at,
    v_demo_signature,
    'ac000000-0000-4000-8000-000000000048',
    repeat('b', 64),
    'Sixth request',
    v_service_demo,
    'Ana Ruiz',
    'ana@example.com',
    null,
    'Sixth request',
    null,
    null
  );
  if v_result ->> 'status' <> 'rate_limited' then
    raise exception 'FAIL distributed rate limit: %', v_result;
  end if;

  execute 'reset role';

  select count(*) into v_count
  from public.orders o
  where o.id = v_order_demo
    and o.tenant_id = v_tenant_demo
    and o.service_id = v_service_demo
    and o.status_id = v_status_demo
    and o.entry_channel_id = v_channel_demo;
  if v_count <> 1 then
    raise exception 'FAIL atomic tenant configuration on Kiosk order';
  end if;

  select count(*) into v_count
  from public.orders o
  where o.id = 'ac000000-0000-4000-8000-000000000049';
  if v_count <> 0 then
    raise exception 'FAIL opt-out validation left a partial order';
  end if;

  select count(*) into v_count
  from public.activity_log a
  where a.entity_id = v_order_demo
    and a.tenant_id = v_tenant_demo
    and a.user_id is null
    and a.metadata ->> 'source' = 'kiosk';
  if v_count <> 1 then
    raise exception 'FAIL Kiosk activity source/null actor';
  end if;

  -- Replacing the audit trigger preserves internal authenticated behavior.
  perform set_config('request.jwt.claim.sub', v_owner_demo::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.orders (
    id, tenant_id, title, service_id, status_id, entry_channel_id, created_by
  ) values (
    v_order_internal,
    v_tenant_demo,
    'Pedido interno',
    v_service_demo,
    v_status_demo,
    v_channel_demo,
    v_owner_demo
  );
  execute 'reset role';

  select count(*) into v_count
  from public.activity_log a
  where a.entity_id = v_order_internal
    and a.user_id = v_owner_demo
    and a.metadata ->> 'source' = 'internal';
  if v_count <> 1 then
    raise exception 'FAIL internal order audit regression';
  end if;
end;
$phase12$;

rollback;
