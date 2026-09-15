-- Kiosk V1: service-role mediated order insert, audit and tenant isolation.
-- Run after 20260915191521_kiosk_public_orders.sql.

begin;

do $phase12$
declare
  v_owner_demo uuid := 'ac000000-0000-4000-8000-000000000000';
  v_tenant_demo uuid := 'ac000000-0000-4000-8000-000000000001';
  v_tenant_sur4 uuid := 'ac000000-0000-4000-8000-000000000002';
  v_service_demo uuid := 'ac000000-0000-4000-8000-000000000011';
  v_service_sur4 uuid := 'ac000000-0000-4000-8000-000000000012';
  v_status_demo uuid := 'ac000000-0000-4000-8000-000000000021';
  v_status_sur4 uuid := 'ac000000-0000-4000-8000-000000000022';
  v_channel_demo uuid;
  v_channel_sur4 uuid;
  v_order_demo uuid := 'ac000000-0000-4000-8000-000000000041';
  v_order_internal uuid := 'ac000000-0000-4000-8000-000000000042';
  v_sqlstate text;
  v_count integer;
  v_reference text;
begin
  insert into public.tenants (id, name, slug, active) values
    (v_tenant_demo, 'DEMO Phase12', 'demo-phase12', true),
    (v_tenant_sur4, 'SUR4 Phase12', 'sur4-phase12', true);

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

  select id into v_channel_demo
  from public.entry_channels
  where tenant_id = v_tenant_demo and code = 'kiosk' and active = true;

  select id into v_channel_sur4
  from public.entry_channels
  where tenant_id = v_tenant_sur4 and code = 'kiosk' and active = true;

  if v_channel_demo is null or v_channel_sur4 is null then
    raise exception 'FAIL new tenants did not receive Kiosk channels';
  end if;

  -- Browser role has no direct read/write access to business tables.
  if has_table_privilege('anon', 'public.orders', 'SELECT')
     or has_table_privilege('anon', 'public.orders', 'INSERT')
     or has_table_privilege('anon', 'public.clients', 'SELECT')
     or has_table_privilege('anon', 'public.team_members', 'SELECT')
     or has_table_privilege('anon', 'public.services', 'SELECT')
     or has_table_privilege('anon', 'public.entry_channels', 'SELECT')
     or has_table_privilege('anon', 'public.order_statuses', 'SELECT') then
    raise exception 'FAIL anon gained direct access to private business data';
  end if;

  -- Server-mediated Kiosk insert succeeds without an Auth user.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';

  insert into public.orders (
    id,
    tenant_id,
    title,
    description,
    service_id,
    status_id,
    entry_channel_id,
    priority,
    notes,
    metadata,
    created_by
  ) values (
    v_order_demo,
    v_tenant_demo,
    'Pedido Kiosk DEMO',
    '200 tarjetas',
    v_service_demo,
    v_status_demo,
    v_channel_demo,
    'normal',
    'Solicitud Kiosk',
    jsonb_build_object(
      'source', 'kiosk',
      'kiosk', jsonb_build_object('submission_id', v_order_demo)
    ),
    null
  )
  returning reference into v_reference;

  execute 'reset role';

  if v_reference not like 'DEMOPHASE12-%' then
    raise exception 'FAIL unexpected Kiosk reference: %', v_reference;
  end if;

  select count(*) into v_count
  from public.orders o
  where o.id = v_order_demo
    and o.tenant_id = v_tenant_demo
    and o.service_id = v_service_demo
    and o.status_id = v_status_demo
    and o.entry_channel_id = v_channel_demo;
  if v_count <> 1 then
    raise exception 'FAIL DEMO Kiosk order configuration/isolation';
  end if;

  select count(*) into v_count
  from public.activity_log a
  where a.entity_type = 'order'
    and a.entity_id = v_order_demo
    and a.tenant_id = v_tenant_demo
    and a.user_id is null
    and a.metadata ->> 'source' = 'kiosk';
  if v_count <> 1 then
    raise exception 'FAIL Kiosk activity source or null actor';
  end if;

  -- Replacing the trigger must preserve normal authenticated order auditing.
  perform set_config('request.jwt.claim.sub', v_owner_demo::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  insert into public.orders (
    id,
    tenant_id,
    title,
    service_id,
    status_id,
    entry_channel_id,
    created_by
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
    and a.tenant_id = v_tenant_demo
    and a.user_id = v_owner_demo
    and a.metadata ->> 'source' = 'internal';
  if v_count <> 1 then
    raise exception 'FAIL authenticated internal order audit regression';
  end if;

  -- Composite tenant FKs reject a SUR4 service on a DEMO order.
  perform set_config('request.jwt.claim.role', 'service_role', true);
  execute 'set local role service_role';
  v_sqlstate := null;
  begin
    insert into public.orders (
      tenant_id, title, service_id, status_id, entry_channel_id, metadata
    ) values (
      v_tenant_demo,
      'Cross tenant',
      v_service_sur4,
      v_status_demo,
      v_channel_demo,
      '{"source":"kiosk"}'::jsonb
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is distinct from '23503' then
    raise exception 'FAIL cross-tenant service expected 23503 got %', v_sqlstate;
  end if;

  -- Anon cannot forge a Kiosk insert directly.
  perform set_config('request.jwt.claim.role', 'anon', true);
  execute 'set local role anon';
  v_sqlstate := null;
  begin
    insert into public.orders (
      tenant_id, title, service_id, status_id, entry_channel_id, metadata
    ) values (
      v_tenant_demo,
      'Forged anonymous order',
      v_service_demo,
      v_status_demo,
      v_channel_demo,
      '{"source":"kiosk"}'::jsonb
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  execute 'reset role';
  if v_sqlstate is null then
    raise exception 'FAIL anon forged a Kiosk order';
  end if;
end;
$phase12$;

rollback;
