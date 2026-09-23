-- Quotes V1 · tenant isolation, roles, feature gate, references and conversion.

begin;

do $phase33$
declare
  v_owner_a uuid := 'e3300000-0000-4000-8000-000000000001';
  v_admin_a uuid := 'e3300000-0000-4000-8000-000000000002';
  v_manager_a uuid := 'e3300000-0000-4000-8000-000000000003';
  v_staff_a uuid := 'e3300000-0000-4000-8000-000000000004';
  v_viewer_a uuid := 'e3300000-0000-4000-8000-000000000005';
  v_owner_b uuid := 'e3300000-0000-4000-8000-000000000006';
  v_tenant_a uuid := 'e3300000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e3300000-0000-4000-8000-000000000012';
  v_client_b uuid := 'e3300000-0000-4000-8000-000000000021';
  v_service_b uuid := 'e3300000-0000-4000-8000-000000000022';
  v_member_b uuid := 'e3300000-0000-4000-8000-000000000023';
  v_draft_a uuid;
  v_draft_b uuid;
  v_pending_a uuid;
  v_quote uuid;
  v_quote_2 uuid;
  v_reference text;
  v_reference_2 text;
  v_count int;
  v_sqlstate text;
  v_convert jsonb;
  v_convert_2 jsonb;
  v_order uuid;
  v_order_b uuid;
  v_status_b uuid;
  v_label text;
  v_payload jsonb;
  v_founder uuid := 'e3300000-0000-4000-8000-000000000031';
  v_internal_user uuid := 'e3300000-0000-4000-8000-000000000032';
  v_org jsonb;
  v_new_tenant uuid;
  v_feature boolean;
begin
  if position(
    'seed_quote_statuses' in pg_get_functiondef(
      'public.create_organization(text,text,text)'::regprocedure
    )
  ) = 0 then
    raise exception 'phase33: create_organization does not seed quote statuses';
  end if;

  if position(
    'seed_quote_statuses' in pg_get_functiondef(
      'public.create_internal_organization_v1(uuid,text,text,text)'::regprocedure
    )
  ) = 0 then
    raise exception 'phase33: create_internal_organization_v1 does not seed quote statuses';
  end if;

  select count(*)::int into v_count
  from public.plan_features pf
  join public.features f on f.id = pf.feature_id
  join public.plans p on p.id = pf.plan_id
  where f.code = 'quotes'
    and p.code in ('mvp', 'basic');

  if v_count <> 0 then
    raise exception 'phase33: quotes must not be attached to mvp or basic';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase33.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-a@phase33.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_manager_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'manager-a@phase33.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase33.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase33.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase33.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_admin_a, 'Admin A'),
    (v_manager_a, 'Manager A'),
    (v_staff_a, 'Staff A'),
    (v_viewer_a, 'Viewer A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Phase33 A', 'phase33a', true),
    (v_tenant_b, 'Phase33 B', 'phase33b', true);

  perform public.seed_quote_statuses(v_tenant_a);
  perform public.seed_quote_statuses(v_tenant_b);

  select count(*)::int into v_count
  from public.quote_statuses
  where tenant_id = v_tenant_a
    and code in ('draft', 'pending', 'accepted', 'rejected');

  if v_count <> 4 then
    raise exception 'phase33: expected four quote statuses, got %', v_count;
  end if;

  select count(*)::int into v_count
  from public.quote_statuses
  where tenant_id = v_tenant_a
    and code = 'sent';
  if v_count <> 1 then
    raise exception 'phase33: expected sent status, got %', v_count;
  end if;

  select name into v_label
  from public.quote_statuses
  where tenant_id = v_tenant_a
    and code = 'pending';
  if v_label is distinct from 'En revisión' then
    raise exception 'phase33: pending default name was %', v_label;
  end if;

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_admin_a, 'admin', true),
    (v_tenant_a, v_manager_a, 'manager', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  insert into public.order_statuses (
    tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values
    (v_tenant_a, 'Recibido', 'received', true, false, false, false, true, 1),
    (v_tenant_b, 'Recibido', 'received', true, false, false, false, true, 1);

  select id into v_status_b
  from public.order_statuses
  where tenant_id = v_tenant_b and is_initial is true;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into public.orders (tenant_id, title, status_id)
  values (v_tenant_b, 'Pedido B', v_status_b)
  returning id into v_order_b;

  insert into public.clients (id, tenant_id, name) values
    (v_client_b, v_tenant_b, 'Cliente B');
  insert into public.services (id, tenant_id, name) values
    (v_service_b, v_tenant_b, 'Servicio B');
  insert into public.team_members (id, tenant_id, name) values
    (v_member_b, v_tenant_b, 'Persona B');

  select id into v_draft_a
  from public.quote_statuses
  where tenant_id = v_tenant_a and code = 'draft';
  select id into v_draft_b
  from public.quote_statuses
  where tenant_id = v_tenant_b and code = 'draft';
  select id into v_pending_a
  from public.quote_statuses
  where tenant_id = v_tenant_a and code = 'pending';

  if public.tenant_has_feature(v_tenant_a, 'quotes') then
    raise exception 'phase33: feature must start disabled';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  v_sqlstate := null;
  begin
    insert into public.quotes (tenant_id, description, status_id)
    values (v_tenant_a, 'Bloqueado', v_draft_a);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase33: feature off insert expected 42501, got %', v_sqlstate;
  end if;

  execute 'reset role';
  perform public.set_tenant_feature('phase33a', 'quotes', true, null);
  if not public.tenant_has_feature(v_tenant_a, 'quotes') then
    raise exception 'phase33: override did not enable quotes';
  end if;

  execute 'set local role authenticated';
  insert into public.quotes (tenant_id, description, status_id)
  values (v_tenant_a, 'Primer presupuesto', v_draft_a)
  returning id, reference into v_quote, v_reference;

  insert into public.quotes (tenant_id, description, status_id)
  values (v_tenant_a, 'Segundo presupuesto', v_draft_a)
  returning id, reference into v_quote_2, v_reference_2;

  if v_reference <> 'PHASE33A-P0001' or v_reference_2 <> 'PHASE33A-P0002' then
    raise exception 'phase33: unexpected references % / %', v_reference, v_reference_2;
  end if;

  v_sqlstate := null;
  begin
    insert into public.quotes (tenant_id, reference, description, status_id)
    values (v_tenant_a, 'HACK-1', 'No', v_draft_a);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase33: client reference expected 42501, got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    insert into public.quotes (tenant_id, description, status_id, client_id)
    values (v_tenant_a, 'Cliente ajeno', v_draft_a, v_client_b);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'phase33: foreign client expected 23503, got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    insert into public.quotes (tenant_id, description, status_id, service_id)
    values (v_tenant_a, 'Servicio ajeno', v_draft_a, v_service_b);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'phase33: foreign service expected 23503, got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    insert into public.quotes (tenant_id, description, status_id, assigned_team_member_id)
    values (v_tenant_a, 'Responsable ajeno', v_draft_a, v_member_b);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'phase33: foreign assignee expected 23503, got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    insert into public.quotes (tenant_id, description, status_id)
    values (v_tenant_a, 'Estado ajeno', v_draft_b);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'phase33: foreign status expected 23503, got %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_manager_a::text, true);
  v_sqlstate := null;
  begin
    insert into public.quotes (tenant_id, description, status_id)
    values (v_tenant_a, 'Manager', v_draft_a);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase33: manager insert expected 42501, got %', v_sqlstate;
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  v_sqlstate := null;
  begin
    update public.quotes set description = 'Staff' where id = v_quote;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is not null then
    raise exception 'phase33: staff update should be filtered, got %', v_sqlstate;
  end if;
  execute 'reset role';
  if exists (
    select 1 from public.quotes where id = v_quote and description = 'Staff'
  ) then
    raise exception 'phase33: staff updated a quote';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  select count(*)::int into v_count from public.quotes where tenant_id = v_tenant_a;
  if v_count <> 0 then
    raise exception 'phase33: viewer can read quotes';
  end if;

  execute 'reset role';
  perform public.set_tenant_feature('phase33b', 'quotes', true, null);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  select count(*)::int into v_count from public.quotes where id = v_quote;
  if v_count <> 0 then
    raise exception 'phase33: tenant B can read tenant A';
  end if;

  v_sqlstate := null;
  begin
    update public.quotes set notes = 'B' where id = v_quote;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is not null then
    raise exception 'phase33: tenant B update should be filtered, got %', v_sqlstate;
  end if;
  execute 'reset role';
  if exists (
    select 1 from public.quotes where id = v_quote and notes = 'B'
  ) then
    raise exception 'phase33: tenant B updated tenant A';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
  update public.quotes
  set description = 'Actualizado por admin'
  where id = v_quote
    and row_version = 0;

  if not exists (
    select 1
    from public.quotes
    where id = v_quote
      and description = 'Actualizado por admin'
      and row_version = 1
  ) then
    raise exception 'phase33: admin update did not bump row_version';
  end if;

  update public.quotes
  set status_id = v_pending_a
  where id = v_quote
    and row_version = 1;

  select count(*)::int into v_count
  from public.activity_log
  where tenant_id = v_tenant_a
    and entity_type = 'quote'
    and entity_id = v_quote
    and action = 'quote.status_changed';
  if v_count <> 1 then
    raise exception 'phase33: missing status activity';
  end if;

  v_convert := public.convert_quote_to_order(v_quote);
  v_convert_2 := public.convert_quote_to_order(v_quote);
  if (v_convert ->> 'ok')::boolean is not true
     or (v_convert ->> 'created')::boolean is not true
     or (v_convert_2 ->> 'created')::boolean is not false
     or v_convert ->> 'order_id' is distinct from v_convert_2 ->> 'order_id' then
    raise exception 'phase33: conversion was not idempotent % / %', v_convert, v_convert_2;
  end if;

  v_order := (v_convert ->> 'order_id')::uuid;
  select count(*)::int into v_count
  from public.orders
  where tenant_id = v_tenant_a
    and id = v_order
    and priority = 'normal'
    and due_at is null
    and entry_channel_id is null
    and store_id is null;
  if v_count <> 1 then
    raise exception 'phase33: converted order did not keep official defaults';
  end if;

  select count(*)::int into v_count
  from public.activity_log
  where tenant_id = v_tenant_a
    and action = 'quote.converted'
    and entity_id = v_quote;
  if v_count <> 1 then
    raise exception 'phase33: missing conversion activity';
  end if;

  v_sqlstate := null;
  begin
    update public.quotes
    set converted_order_id = null
    where id = v_quote;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase33: clearing conversion expected 42501, got %', v_sqlstate;
  end if;

  execute 'reset role';
  perform public.set_tenant_feature('phase33a', 'quotes', false, null);
  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);

  select count(*)::int into v_count from public.quotes where id = v_quote;
  if v_count <> 0 then
    raise exception 'phase33: feature off still lists quotes';
  end if;

  v_convert := public.convert_quote_to_order(v_quote);
  if v_convert ->> 'error' is distinct from 'not_found' then
    raise exception 'phase33: feature off convert leaked %', v_convert;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.set_tenant_feature('phase33a', 'quotes', true, null);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase33: authenticated set_tenant_feature expected 42501, got %', v_sqlstate;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform public.set_tenant_feature('phase33a', 'quotes', true, null);

  v_sqlstate := null;
  begin
    update public.quotes
    set converted_order_id = v_order_b
    where id = v_quote;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23503' then
    raise exception 'phase33: foreign converted order expected 23503, got %', v_sqlstate;
  end if;

  execute 'set local role authenticated';
  v_payload := public.list_activity_log(
    v_tenant_a, 'quote', null, null, null, null, 1, 25
  );
  select event ->> 'entity_label' into v_label
  from pg_catalog.jsonb_array_elements(v_payload -> 'events') event
  where event ->> 'action' = 'quote.created'
  limit 1;

  if v_label is distinct from 'PHASE33A-P0001'
     and v_label is distinct from 'PHASE33A-P0002' then
    raise exception 'phase33: activity label was %', v_label;
  end if;

  -- Cross-tenant RPC: owner A must not learn tenant B's feature.
  execute 'reset role';
  perform public.set_tenant_feature('phase33b', 'quotes', true, null);
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  v_feature := public.tenant_has_feature(v_tenant_b, 'quotes');
  if v_feature is distinct from false then
    raise exception 'phase33: owner A resolved tenant B feature as %', v_feature;
  end if;

  v_feature := public.tenant_has_feature(v_tenant_a, 'quotes');
  if v_feature is distinct from true then
    raise exception 'phase33: owner A could not resolve own feature';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  v_feature := public.tenant_has_feature(v_tenant_b, 'quotes');
  if v_feature is distinct from true then
    raise exception 'phase33: postgres could not resolve tenant B feature';
  end if;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_feature := public.tenant_has_feature(v_tenant_b, 'quotes');
  if v_feature is distinct from true then
    raise exception 'phase33: service_role could not resolve tenant B feature';
  end if;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_sqlstate := null;
  begin
    update public.quotes
    set archived_at = pg_catalog.now()
    where id = v_quote;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase33: archived_at update expected 42501, got %', v_sqlstate;
  end if;

  -- Commercial and internal provisioning both seed quote statuses.
  execute 'reset role';
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_founder, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'founder@phase33.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_internal_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'internal@phase33.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  perform set_config('request.jwt.claim.sub', v_founder::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_org := public.create_organization(
    'Phase33 Commercial', 'phase33-commercial', 'Europe/Madrid'
  );
  v_new_tenant := (v_org ->> 'tenant_id')::uuid;
  if coalesce((v_org ->> 'active')::boolean, true) is not false
     or v_org ->> 'provisioning_state' is distinct from 'pending_billing' then
    raise exception 'phase33: commercial provisioning changed, got %', v_org;
  end if;

  execute 'reset role';
  select count(*)::int into v_count
  from public.quote_statuses
  where tenant_id = v_new_tenant
    and code in ('draft', 'pending', 'accepted', 'rejected');
  if v_count <> 4 then
    raise exception 'phase33: commercial tenant missing quote statuses, got %', v_count;
  end if;

  select name into v_label
  from public.quote_statuses
  where tenant_id = v_new_tenant
    and code = 'sent';
  if v_label is distinct from 'Enviado' then
    raise exception 'phase33: commercial seed missing sent, got %', v_label;
  end if;

  execute 'set local role authenticated';
  v_sqlstate := null;
  begin
    perform public.create_internal_organization_v1(
      v_internal_user, 'Phase33 Internal', 'phase33-internal', 'Europe/Madrid'
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase33: authenticated internal provisioning expected 42501, got %', v_sqlstate;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  v_org := public.create_internal_organization_v1(
    v_internal_user, 'Phase33 Internal', 'phase33-internal', 'Europe/Madrid'
  );
  v_new_tenant := (v_org ->> 'tenant_id')::uuid;
  if coalesce((v_org ->> 'active')::boolean, false) is not true
     or v_org ->> 'provisioning_state' is distinct from 'ready' then
    raise exception 'phase33: internal provisioning changed, got %', v_org;
  end if;

  select count(*)::int into v_count
  from public.quote_statuses
  where tenant_id = v_new_tenant
    and code in ('draft', 'pending', 'accepted', 'rejected');
  if v_count <> 4 then
    raise exception 'phase33: internal tenant missing quote statuses, got %', v_count;
  end if;

  select name into v_label
  from public.quote_statuses
  where tenant_id = v_new_tenant
    and code = 'sent';
  if v_label is distinct from 'Enviado' then
    raise exception 'phase33: internal seed missing sent, got %', v_label;
  end if;

  -- Custom pending names stay. Only the untouched default "Pendiente" is renamed.
  insert into public.tenants (id, name, slug, active) values
    ('e3300000-0000-4000-8000-000000000041', 'Phase33 Custom', 'phase33custom', true),
    ('e3300000-0000-4000-8000-000000000042', 'Phase33 Default Name', 'phase33defaultname', true);
  insert into public.quote_statuses (tenant_id, name, code, active, sort_order) values
    ('e3300000-0000-4000-8000-000000000041', 'En curso del cliente', 'pending', true, 20),
    ('e3300000-0000-4000-8000-000000000041', 'Borrador', 'draft', true, 10),
    ('e3300000-0000-4000-8000-000000000042', 'Pendiente', 'pending', true, 20);

  update public.quote_statuses
  set name = 'En revisión'
  where code = 'pending'
    and name = 'Pendiente';

  select name into v_label
  from public.quote_statuses
  where tenant_id = 'e3300000-0000-4000-8000-000000000041'
    and code = 'pending';
  if v_label is distinct from 'En curso del cliente' then
    raise exception 'phase33: customized pending name was overwritten, got %', v_label;
  end if;

  select name into v_label
  from public.quote_statuses
  where tenant_id = 'e3300000-0000-4000-8000-000000000042'
    and code = 'pending';
  if v_label is distinct from 'En revisión' then
    raise exception 'phase33: default pending name was not renamed, got %', v_label;
  end if;

  select count(*)::int into v_count
  from public.quote_statuses
  where tenant_id = 'e3300000-0000-4000-8000-000000000041'
    and code = 'draft';
  if v_count <> 1 then
    raise exception 'phase33: rename removed a referenced status';
  end if;

  execute 'reset role';
end;
$phase33$;

rollback;
