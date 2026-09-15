-- Kiosk V1: service-role mediated order insert, audit and tenant isolation.
-- Run after 20260915191521_kiosk_public_orders.sql.

begin;

do $phase12$
declare
  v_tenant_demo uuid := 'ac000000-0000-4000-8000-000000000001';
  v_tenant_sur4 uuid := 'ac000000-0000-4000-8000-000000000002';
  v_service_demo uuid := 'ac000000-0000-4000-8000-000000000011';
  v_service_sur4 uuid := 'ac000000-0000-4000-8000-000000000012';
  v_status_demo uuid := 'ac000000-0000-4000-8000-000000000021';
  v_status_sur4 uuid := 'ac000000-0000-4000-8000-000000000022';
  v_channel_demo uuid := 'ac000000-0000-4000-8000-000000000031';
  v_channel_sur4 uuid := 'ac000000-0000-4000-8000-000000000032';
  v_order_demo uuid := 'ac000000-0000-4000-8000-000000000041';
  v_sqlstate text;
  v_count integer;
  v_reference text;
begin
  insert into public.tenants (id, name, slug, active) values
    (v_tenant_demo, 'DEMO Phase12', 'demo-phase12', true),
    (v_tenant_sur4, 'SUR4 Phase12', 'sur4-phase12', true);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_demo, v_tenant_demo, 'Impresión DEMO', true, 1),
    (v_service_sur4, v_tenant_sur4, 'Impresión SUR4', true, 1);

  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, active, sort_order
  ) values
    (v_status_demo, v_tenant_demo, 'Recibido', 'received', true, true, 1),
    (v_status_sur4, v_tenant_sur4, 'Pendiente', 'pending', true, true, 1);

  insert into public.entry_channels (
    id, tenant_id, name, code, active, sort_order
  ) values
    (v_channel_demo, v_tenant_demo, 'Kiosk', 'kiosk', true, 1),
    (v_channel_sur4, v_tenant_sur4, 'Kiosk', 'kiosk', true, 1);

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
