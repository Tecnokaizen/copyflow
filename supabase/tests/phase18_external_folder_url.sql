-- A1 regression: external_folder_url via change_order_content_v2
-- Tenant isolation, archived, stale version, activity, row_version.

begin;

do $phase18$
declare
  v_owner_a uuid := 'e1000000-0000-4000-8000-000000000001';
  v_owner_b uuid := 'e1000000-0000-4000-8000-000000000002';
  v_tenant_a uuid := 'e1000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e1000000-0000-4000-8000-000000000012';
  v_status_initial_a uuid := 'e1000000-0000-4000-8000-000000000021';
  v_status_closed_a uuid := 'e1000000-0000-4000-8000-000000000022';
  v_status_initial_b uuid := 'e1000000-0000-4000-8000-000000000023';
  v_service_a uuid := 'e1000000-0000-4000-8000-000000000031';
  v_service_b uuid := 'e1000000-0000-4000-8000-000000000032';
  v_order_open uuid := 'e1000000-0000-4000-8000-000000000061';
  v_order_archived uuid := 'e1000000-0000-4000-8000-000000000062';
  v_order_b uuid := 'e1000000-0000-4000-8000-000000000063';
  v_sqlstate text;
  v_result jsonb;
  v_version bigint;
  v_version_2 bigint;
  v_url text;
  v_count integer;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase18.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase18.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase18', 'tenant-a-phase18', true),
    (v_tenant_b, 'Tenant B Phase18', 'tenant-b-phase18', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.order_statuses (
    id, tenant_id, name, code, active, sort_order,
    is_initial, is_ready, is_closed, is_cancelled
  ) values
    (v_status_initial_a, v_tenant_a, 'Recibido', 'received', true, 1, true, false, false, false),
    (v_status_closed_a, v_tenant_a, 'Entregado', 'closed', true, 2, false, false, true, false);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_a, v_tenant_a, 'Servicio A', true, 1);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values
    (v_order_open, v_tenant_a, 'Open', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_archived, v_tenant_a, 'Archived', v_service_a, v_status_closed_a, v_owner_a);

  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.order_statuses (
    id, tenant_id, name, code, active, sort_order,
    is_initial, is_ready, is_closed, is_cancelled
  ) values
    (v_status_initial_b, v_tenant_b, 'Recibido', 'received', true, 1, true, false, false, false);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_b, v_tenant_b, 'Servicio B', true, 1);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values
    (v_order_b, v_tenant_b, 'Other tenant', v_service_b, v_status_initial_b, v_owner_b);

  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  perform public.archive_order(v_order_archived, v_tenant_a);

  -- A can set external_folder_url
  v_result := public.change_order_content_v2(
    v_order_open,
    'external_folder_url',
    'https://drive.google.com/folder/abc',
    v_tenant_a,
    0
  );

  if v_result->>'field' is distinct from 'external_folder_url' then
    raise exception 'FAIL set field metadata';
  end if;

  select external_folder_url, row_version
  into v_url, v_version
  from public.orders
  where id = v_order_open;

  if v_url is distinct from 'https://drive.google.com/folder/abc' then
    raise exception 'FAIL url not saved (%)', v_url;
  end if;

  if v_version is distinct from 1 then
    raise exception 'FAIL row_version not bumped (%)', v_version;
  end if;

  select count(*) into v_count
  from public.activity_log
  where entity_id = v_order_open
    and action = 'order.content_changed'
    and metadata->>'field' = 'external_folder_url';

  if v_count <> 1 then
    raise exception 'FAIL activity expected 1 got %', v_count;
  end if;

  -- Stale expected_version
  begin
    perform public.change_order_content_v2(
      v_order_open,
      'external_folder_url',
      'https://example.com/stale',
      v_tenant_a,
      0
    );
    raise exception 'FAIL stale should reject';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if v_sqlstate is distinct from 'GCO01' then
        raise exception 'FAIL stale expected GCO01 got %', v_sqlstate;
      end if;
  end;

  -- Clear URL with current version
  v_result := public.change_order_content_v2(
    v_order_open,
    'external_folder_url',
    '',
    v_tenant_a,
    1
  );

  select external_folder_url, row_version
  into v_url, v_version_2
  from public.orders
  where id = v_order_open;

  if v_url is not null then
    raise exception 'FAIL clear url expected null got %', v_url;
  end if;

  if v_version_2 is distinct from 2 then
    raise exception 'FAIL clear row_version (%)', v_version_2;
  end if;

  select row_version into v_version from public.orders where id = v_order_archived;

  begin
    perform public.change_order_content_v2(
      v_order_archived,
      'external_folder_url',
      'https://example.com/archived',
      v_tenant_a,
      v_version
    );
    raise exception 'FAIL archived should reject';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if v_sqlstate is distinct from '42501' then
        raise exception 'FAIL archived expected 42501 got %', v_sqlstate;
      end if;
  end;

  -- Tenant B cannot mutate tenant A order
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);

  begin
    perform public.change_order_content_v2(
      v_order_open,
      'external_folder_url',
      'https://evil.example/x',
      v_tenant_a,
      2
    );
    raise exception 'FAIL cross-tenant should reject';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if v_sqlstate not in ('42501', 'P0002') then
        raise exception 'FAIL cross-tenant expected 42501/P0002 got %', v_sqlstate;
      end if;
  end;

  -- Reject invalid scheme at RPC layer
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);

  begin
    perform public.change_order_content_v2(
      v_order_open,
      'external_folder_url',
      'javascript:alert(1)',
      v_tenant_a,
      2
    );
    raise exception 'FAIL javascript url should reject';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if v_sqlstate is distinct from '22023' then
        raise exception 'FAIL invalid url expected 22023 got %', v_sqlstate;
      end if;
  end;

  raise notice 'PASS phase18 external_folder_url content';
end;
$phase18$;

rollback;
