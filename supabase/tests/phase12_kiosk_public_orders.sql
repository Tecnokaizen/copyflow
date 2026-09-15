-- Kiosk V1: purpose-bound HMAC, one-shot permits, opt-in and atomic submit.
-- Run after 20260915191521_kiosk_public_orders.sql.

begin;

select vault.create_secret(
  'phase12-kiosk-signing-secret-at-least-32-chars',
  'kiosk_signing_secret',
  'Kiosk phase12 test secret'
);

create or replace function pg_temp.kiosk_signature(
  p_secret text,
  p_purpose text,
  p_tenant_slug text,
  p_client_key text,
  p_issued_at bigint,
  p_binding text
)
returns text
language sql
immutable
as $$
  select encode(
    extensions.hmac(
      convert_to(
        'kiosk-v1|' || p_purpose || '|' || p_tenant_slug || '|' ||
        p_client_key || '|' || p_issued_at || '|' || p_binding,
        'UTF8'
      ),
      convert_to(p_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

do $phase12$
declare
  v_secret text := 'phase12-kiosk-signing-secret-at-least-32-chars';
  v_client_key text := repeat('a', 64);
  v_issued_at bigint := extract(epoch from now())::bigint;
  v_owner uuid := 'ac000000-0000-4000-8000-000000000000';
  v_owner_sur4 uuid := 'ac000000-0000-4000-8000-000000000010';
  v_tenant_demo uuid := 'ac000000-0000-4000-8000-000000000001';
  v_tenant_sur4 uuid := 'ac000000-0000-4000-8000-000000000002';
  v_service_demo uuid := 'ac000000-0000-4000-8000-000000000011';
  v_service_sur4 uuid := 'ac000000-0000-4000-8000-000000000012';
  v_status_demo uuid := 'ac000000-0000-4000-8000-000000000021';
  v_status_sur4 uuid := 'ac000000-0000-4000-8000-000000000022';
  v_channel_demo uuid := 'ac000000-0000-4000-8000-000000000031';
  v_order uuid := 'ac000000-0000-4000-8000-000000000041';
  v_internal_order uuid := 'ac000000-0000-4000-8000-000000000042';
  v_fingerprint text;
  v_cross_fingerprint text;
  v_permit uuid;
  v_permit_2 uuid;
  v_permit_3 uuid;
  v_binding text;
  v_signature text;
  v_bootstrap_signature text;
  v_result jsonb;
  v_count integer;
begin
  insert into public.tenants (id, name, slug, active) values
    (v_tenant_demo, 'DEMO Phase12', 'demo-phase12', true),
    (v_tenant_sur4, 'SUR4 Phase12', 'sur4-phase12', true);

  -- Migration and future tenant creation never opt tenants into Kiosk.
  select count(*) into v_count
  from public.entry_channels
  where tenant_id in (v_tenant_demo, v_tenant_sur4)
    and code = 'kiosk';
  if v_count <> 0 then
    raise exception 'FAIL Kiosk was auto-enabled';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner,
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
  values (v_owner, 'Owner DEMO');
  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant_demo, v_owner, 'owner', true);

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner_sur4,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    'owner-sur4@phase12.test',
    crypt('pw', gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Owner SUR4"}'::jsonb,
    now(), now(), '', '', '', ''
  );
  insert into public.profiles (id, full_name)
  values (v_owner_sur4, 'Owner SUR4');
  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant_sur4, v_owner_sur4, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.services (id, tenant_id, name, active, sort_order)
  values (v_service_demo, v_tenant_demo, 'Impresión DEMO', true, 1);
  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, active, sort_order
  ) values (
    v_status_demo, v_tenant_demo, 'Recibido', 'received', true, true, 1
  );
  -- Explicit configuration opts DEMO in. SUR4 remains disabled.
  insert into public.entry_channels (
    id, tenant_id, name, code, active, sort_order
  ) values (
    v_channel_demo, v_tenant_demo, 'Kiosk', 'kiosk', true, 1000
  );
  execute 'reset role';

  if kiosk_private.kiosk_payload_fingerprint(
    'Tarjetas',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'Ana',
    'ana@example.com',
    null,
    'Tarjetas',
    null,
    'Mate'
  ) <> 'f5822604bd71e597cb043d7bc8fa41548e0cd9f9e1c4faf66feaa74f4b75f58f' then
    raise exception 'FAIL Node/Postgres canonical fingerprint vector';
  end if;

  v_fingerprint := kiosk_private.kiosk_payload_fingerprint(
    '200 tarjetas',
    v_service_demo,
    'Ana Ruiz',
    'ana@example.com',
    null,
    '200 tarjetas',
    null,
    'Papel mate'
  );
  v_cross_fingerprint := kiosk_private.kiosk_payload_fingerprint(
    'Cross tenant',
    v_service_sur4,
    'Ana Ruiz',
    'ana@example.com',
    null,
    'Cross tenant',
    null,
    null
  );

  perform set_config('request.jwt.claim.sub', v_owner_sur4::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.services (id, tenant_id, name, active, sort_order)
  values (v_service_sur4, v_tenant_sur4, 'Impresión SUR4', true, 1);
  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, active, sort_order
  ) values (
    v_status_sur4, v_tenant_sur4, 'Pendiente', 'pending', true, true, 1
  );
  execute 'reset role';

  if has_table_privilege('anon', 'public.orders', 'SELECT')
     or has_table_privilege('anon', 'public.orders', 'INSERT')
     or has_table_privilege('anon', 'public.clients', 'SELECT')
     or has_table_privilege('anon', 'public.team_members', 'SELECT')
     or has_table_privilege('anon', 'public.services', 'SELECT') then
    raise exception 'FAIL anon gained business-table access';
  end if;
  if has_schema_privilege('anon', 'kiosk_private', 'USAGE') then
    raise exception 'FAIL anon has direct kiosk_private schema usage';
  end if;
  if has_function_privilege(
    'anon',
    'kiosk_private.submit_kiosk_order(text,text,bigint,text,text,text,uuid,uuid,text,uuid,text,text,text,text,timestamptz,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL anon can execute private submit directly';
  end if;
  if not has_function_privilege(
    'anon',
    'public.submit_kiosk_order(text,text,bigint,text,text,text,uuid,uuid,text,uuid,text,text,text,text,timestamptz,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL anon lacks minimal public submit wrapper';
  end if;
  if has_function_privilege(
    'service_role',
    'public.submit_kiosk_order(text,text,bigint,text,text,text,uuid,uuid,text,uuid,text,text,text,text,timestamptz,text)',
    'EXECUTE'
  ) then
    raise exception 'FAIL service_role can execute Kiosk submit';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';

  -- Purpose-bound bootstrap; cross-purpose and cross-tenant signatures fail.
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'bootstrap', 'demo-phase12', v_client_key,
    v_issued_at, 'bootstrap'
  );
  v_bootstrap_signature := v_signature;
  v_result := public.kiosk_bootstrap(
    'demo-phase12', v_client_key, v_issued_at,
    'bootstrap', 'bootstrap', v_signature
  );
  if v_result ->> 'status' <> 'ready'
     or v_result #>> '{tenant,name}' <> 'DEMO Phase12'
     or jsonb_array_length(v_result -> 'services') <> 1 then
    raise exception 'FAIL signed bootstrap: %', v_result;
  end if;

  v_result := public.admit_kiosk_request(
    'demo-phase12', v_client_key, v_issued_at,
    'bootstrap', 'bootstrap', v_signature
  );
  if v_result ->> 'status' <> 'not_found' then
    raise exception 'FAIL bootstrap signature crossed into admit: %', v_result;
  end if;

  v_result := public.kiosk_bootstrap(
    'sur4-phase12', v_client_key, v_issued_at,
    'bootstrap', 'bootstrap', v_signature
  );
  if v_result ->> 'status' <> 'not_found' then
    raise exception 'FAIL signature selected another tenant: %', v_result;
  end if;

  -- Admission happens before parsing and emits a one-shot permit.
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'admit', 'demo-phase12', v_client_key,
    v_issued_at, 'request'
  );
  v_result := public.admit_kiosk_request(
    'demo-phase12', v_client_key, v_issued_at,
    'admit', 'request', v_signature
  );
  if v_result ->> 'status' <> 'admitted' then
    raise exception 'FAIL admission: %', v_result;
  end if;
  v_permit := (v_result ->> 'permit')::uuid;

  v_result := public.submit_kiosk_order(
    'demo-phase12', v_client_key, v_issued_at,
    'bootstrap', 'bootstrap', v_bootstrap_signature,
    v_permit, v_order, '200 tarjetas',
    v_service_demo, 'Ana Ruiz', 'ana@example.com', null,
    '200 tarjetas', null, 'Papel mate'
  );
  if v_result ->> 'status' <> 'not_found' then
    raise exception 'FAIL bootstrap signature crossed into submit: %', v_result;
  end if;

  v_binding := v_permit::text || '|' || v_order::text || '|' || v_fingerprint;
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'submit', 'demo-phase12', v_client_key,
    v_issued_at, v_binding
  );
  v_result := public.submit_kiosk_order(
    'demo-phase12', v_client_key, v_issued_at,
    'submit', v_binding, v_signature,
    v_permit, v_order, '200 tarjetas',
    v_service_demo, 'Ana Ruiz', 'ana@example.com', null,
    '200 tarjetas', null, 'Papel mate'
  );
  if v_result ->> 'status' <> 'created' then
    raise exception 'FAIL submit: %', v_result;
  end if;

  -- Same permit is one-shot, even with the same signed payload.
  v_result := public.submit_kiosk_order(
    'demo-phase12', v_client_key, v_issued_at,
    'submit', v_binding, v_signature,
    v_permit, v_order, '200 tarjetas',
    v_service_demo, 'Ana Ruiz', 'ana@example.com', null,
    '200 tarjetas', null, 'Papel mate'
  );
  if v_result ->> 'status' <> 'invalid_request' then
    raise exception 'FAIL permit replay was accepted: %', v_result;
  end if;

  -- A fresh admission permits an idempotent order replay.
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'admit', 'demo-phase12', v_client_key,
    v_issued_at, 'request'
  );
  v_result := public.admit_kiosk_request(
    'demo-phase12', v_client_key, v_issued_at,
    'admit', 'request', v_signature
  );
  v_permit_2 := (v_result ->> 'permit')::uuid;
  v_binding := v_permit_2::text || '|' || v_order::text || '|' || v_fingerprint;
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'submit', 'demo-phase12', v_client_key,
    v_issued_at, v_binding
  );
  v_result := public.submit_kiosk_order(
    'demo-phase12', v_client_key, v_issued_at,
    'submit', v_binding, v_signature,
    v_permit_2, v_order, '200 tarjetas',
    v_service_demo, 'Ana Ruiz', 'ana@example.com', null,
    '200 tarjetas', null, 'Papel mate'
  );
  if v_result ->> 'status' <> 'replay' then
    raise exception 'FAIL fresh-permit replay: %', v_result;
  end if;

  -- Third permit: altered payload/submission and NULL fingerprint are rejected.
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'admit', 'demo-phase12', v_client_key,
    v_issued_at, 'request'
  );
  v_result := public.admit_kiosk_request(
    'demo-phase12', v_client_key, v_issued_at,
    'admit', 'request', v_signature
  );
  v_permit_3 := (v_result ->> 'permit')::uuid;
  v_binding := v_permit_3::text || '|' || v_order::text || '|' || v_fingerprint;
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'submit', 'demo-phase12', v_client_key,
    v_issued_at, v_binding
  );
  v_result := public.submit_kiosk_order(
    'demo-phase12', v_client_key, v_issued_at,
    'submit', v_binding, v_signature,
    v_permit_3, 'ac000000-0000-4000-8000-000000000099',
    'Otro', v_service_demo, 'Ana Ruiz',
    'ana@example.com', null, 'Otro', null, null
  );
  if v_result ->> 'status' <> 'not_found' then
    raise exception 'FAIL altered submission reused signature: %', v_result;
  end if;
  -- Keep the signed fingerprint but alter authorized fields: DB recomputation
  -- must reject and consume the one-shot permit.
  v_result := public.submit_kiosk_order(
    'demo-phase12', v_client_key, v_issued_at,
    'submit', v_binding, v_signature,
    v_permit_3, v_order, 'Alterado',
    v_service_demo, 'Ana Ruiz', 'ana@example.com', null,
    'Alterado', null, null
  );
  if v_result ->> 'status' <> 'not_found' then
    raise exception 'FAIL altered payload kept original fingerprint: %', v_result;
  end if;

  -- Fourth admission is consumed by a correctly signed cross-tenant service.
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'admit', 'demo-phase12', v_client_key,
    v_issued_at, 'request'
  );
  v_result := public.admit_kiosk_request(
    'demo-phase12', v_client_key, v_issued_at,
    'admit', 'request', v_signature
  );
  v_permit_3 := (v_result ->> 'permit')::uuid;
  v_binding :=
    v_permit_3::text ||
    '|ac000000-0000-4000-8000-000000000098|' ||
    v_cross_fingerprint;
  v_signature := pg_temp.kiosk_signature(
    v_secret, 'submit', 'demo-phase12', v_client_key,
    v_issued_at, v_binding
  );
  v_result := public.submit_kiosk_order(
    'demo-phase12', v_client_key, v_issued_at,
    'submit', v_binding, v_signature,
    v_permit_3, 'ac000000-0000-4000-8000-000000000098',
    'Cross tenant', v_service_sur4, 'Ana Ruiz',
    'ana@example.com', null, 'Cross tenant', null, null
  );
  if v_result ->> 'status' <> 'invalid_service' then
    raise exception 'FAIL cross-tenant service: %', v_result;
  end if;

  -- Admission five succeeds; sixth is rate-limited before DTO parse.
  for v_count in 5..6 loop
    v_signature := pg_temp.kiosk_signature(
      v_secret, 'admit', 'demo-phase12', v_client_key,
      v_issued_at, 'request'
    );
    v_result := public.admit_kiosk_request(
      'demo-phase12', v_client_key, v_issued_at,
      'admit', 'request', v_signature
    );
    if v_count <= 5 and v_result ->> 'status' <> 'admitted' then
      raise exception 'FAIL admission % should pass: %', v_count, v_result;
    end if;
    if v_count = 6 and v_result ->> 'status' <> 'rate_limited' then
      raise exception 'FAIL sixth admission bypassed 429: %', v_result;
    end if;
  end loop;

  execute 'reset role';

  select count(*) into v_count
  from public.orders o
  where o.id = v_order
    and o.tenant_id = v_tenant_demo
    and o.service_id = v_service_demo
    and o.status_id = v_status_demo
    and o.entry_channel_id = v_channel_demo;
  if v_count <> 1 then
    raise exception 'FAIL atomic tenant configuration';
  end if;

  select count(*) into v_count
  from public.activity_log a
  where a.entity_id = v_order
    and a.tenant_id = v_tenant_demo
    and a.user_id is null
    and a.metadata ->> 'source' = 'kiosk';
  if v_count <> 1 then
    raise exception 'FAIL Kiosk audit';
  end if;

  -- Internal authenticated order auditing remains unchanged.
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.orders (
    id, tenant_id, title, service_id, status_id, entry_channel_id, created_by
  ) values (
    v_internal_order, v_tenant_demo, 'Pedido interno', v_service_demo,
    v_status_demo, v_channel_demo, v_owner
  );
  execute 'reset role';

  select count(*) into v_count
  from public.activity_log a
  where a.entity_id = v_internal_order
    and a.user_id = v_owner
    and a.metadata ->> 'source' = 'internal';
  if v_count <> 1 then
    raise exception 'FAIL internal audit regression';
  end if;
end;
$phase12$;

rollback;
