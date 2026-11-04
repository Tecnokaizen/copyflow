-- Order invoice tracking V1 (20261104120000): «Requiere factura» /
-- «Factura entregada» through change_order_invoice_v1.
-- Historical orders stay NULL, valid combinations, invalid combinations,
-- normalisation, idempotency, stale/archived, tenant isolation (RPC and RLS),
-- direct writes refused, CHECK constraint. Rollback-only.

begin;

do $phase66$
declare
  v_owner_a uuid := 'e6600000-0000-4000-8000-000000000001';
  v_owner_b uuid := 'e6600000-0000-4000-8000-000000000002';
  v_tenant_a uuid := 'e6600000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e6600000-0000-4000-8000-000000000012';
  v_status_initial_a uuid := 'e6600000-0000-4000-8000-000000000021';
  v_status_closed_a uuid := 'e6600000-0000-4000-8000-000000000022';
  v_service_a uuid := 'e6600000-0000-4000-8000-000000000031';
  v_order uuid := 'e6600000-0000-4000-8000-000000000061';
  v_order_archived uuid := 'e6600000-0000-4000-8000-000000000062';
  v_sqlstate text;
  v_result jsonb;
  v_required boolean;
  v_delivered boolean;
  v_version bigint;
  v_count integer;
  v_total numeric;
  v_payment uuid;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase66.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase66.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase66', 'tenant-a-phase66', true),
    (v_tenant_b, 'Tenant B Phase66', 'tenant-b-phase66', true);

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
    (v_order, v_tenant_a, 'Open', v_service_a, v_status_initial_a, v_owner_a),
    (v_order_archived, v_tenant_a, 'Archived', v_service_a, v_status_closed_a, v_owner_a);

  perform public.archive_order(v_order_archived, v_tenant_a);

  -- A new (or historical) order: «Sin indicar».
  select invoice_required, invoice_delivered, row_version, total_amount, payment_status_id
  into v_required, v_delivered, v_version, v_total, v_payment
  from public.orders where id = v_order;
  if v_required is not null or v_delivered is not null or v_version <> 0 then
    raise exception 'FAIL new order expected NULL/NULL v0, got %/% v%', v_required, v_delivered, v_version;
  end if;

  -- Requiere factura: No (delivered sent as NULL).
  v_result := public.change_order_invoice_v1(v_order, false, null, v_tenant_a, 0);
  if (v_result->'order'->>'invoice_required') is distinct from 'false'
     or v_result->'order'->'invoice_delivered' is distinct from 'null'::jsonb
     or v_result->>'version' is distinct from '1' then
    raise exception 'FAIL required=false result %', v_result;
  end if;

  -- No + Entregada: No → stored as NULL (not applicable).
  v_result := public.change_order_invoice_v1(v_order, false, false, v_tenant_a, 1);
  if v_result->>'version' is distinct from '1' then
    raise exception 'FAIL normalised no-op should not bump version: %', v_result;
  end if;

  -- Requiere factura: Sí, entrega sin indicar.
  v_result := public.change_order_invoice_v1(v_order, true, null, v_tenant_a, 1);
  if v_result->>'version' is distinct from '2' then
    raise exception 'FAIL required=true version %', v_result;
  end if;

  -- Entregada: No, luego Sí.
  v_result := public.change_order_invoice_v1(v_order, true, false, v_tenant_a, 2);
  v_result := public.change_order_invoice_v1(v_order, true, true, v_tenant_a, 3);
  select invoice_required, invoice_delivered, row_version
  into v_required, v_delivered, v_version
  from public.orders where id = v_order;
  if v_required is distinct from true or v_delivered is distinct from true or v_version <> 4 then
    raise exception 'FAIL Sí/Sí expected, got %/% v%', v_required, v_delivered, v_version;
  end if;

  -- Same values: idempotent (no UPDATE, no version bump).
  v_result := public.change_order_invoice_v1(v_order, true, true, v_tenant_a, 4);
  if v_result->>'version' is distinct from '4' then
    raise exception 'FAIL idempotent call bumped version: %', v_result;
  end if;

  -- Invalid combinations: delivered=true without required=true.
  foreach v_required in array array[false, null]::boolean[] loop
    begin
      perform public.change_order_invoice_v1(v_order, v_required, true, v_tenant_a, 4);
      raise exception 'FAIL delivered without required should reject';
    exception when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate;
      if v_sqlstate is distinct from '22023' then
        raise exception 'FAIL invalid combination expected 22023 got %', v_sqlstate;
      end if;
    end;
  end loop;

  -- Sí → No: delivery normalised to NULL.
  v_result := public.change_order_invoice_v1(v_order, false, null, v_tenant_a, 4);
  select invoice_required, invoice_delivered, row_version
  into v_required, v_delivered, v_version
  from public.orders where id = v_order;
  if v_required is distinct from false or v_delivered is not null or v_version <> 5 then
    raise exception 'FAIL Sí→No expected false/NULL v5, got %/% v%', v_required, v_delivered, v_version;
  end if;

  -- Back to «Sin indicar».
  v_result := public.change_order_invoice_v1(v_order, null, null, v_tenant_a, 5);
  select invoice_required, invoice_delivered into v_required, v_delivered
  from public.orders where id = v_order;
  if v_required is not null or v_delivered is not null then
    raise exception 'FAIL back to NULL failed: %/%', v_required, v_delivered;
  end if;

  -- Nothing else changed.
  if (select (total_amount, payment_status_id) is distinct from (v_total, v_payment)
      from public.orders where id = v_order) then
    raise exception 'FAIL invoice RPC touched amounts or payment';
  end if;

  -- Stale version.
  begin
    perform public.change_order_invoice_v1(v_order, true, null, v_tenant_a, 0);
    raise exception 'FAIL stale should reject';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate is distinct from 'GCO01' then
      raise exception 'FAIL stale expected GCO01 got %', v_sqlstate;
    end if;
  end;

  -- Missing version.
  begin
    perform public.change_order_invoice_v1(v_order, true, null, v_tenant_a, null);
    raise exception 'FAIL missing version should reject';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate is distinct from '22023' then
      raise exception 'FAIL missing version expected 22023 got %', v_sqlstate;
    end if;
  end;

  -- Archived orders are read-only.
  select row_version into v_version from public.orders where id = v_order_archived;
  begin
    perform public.change_order_invoice_v1(v_order_archived, true, null, v_tenant_a, v_version);
    raise exception 'FAIL archived should reject';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate is distinct from '42501' then
      raise exception 'FAIL archived expected 42501 got %', v_sqlstate;
    end if;
  end;

  -- Direct PATCH through PostgREST is refused by the R5 write guard.
  begin
    update public.orders set invoice_required = true where id = v_order;
    raise exception 'FAIL direct update should reject';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate is distinct from '42501' then
      raise exception 'FAIL direct update expected 42501 got %', v_sqlstate;
    end if;
  end;

  -- Tenant B: cannot write nor read tenant A invoice states.
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  begin
    perform public.change_order_invoice_v1(v_order, true, null, v_tenant_a, 6);
    raise exception 'FAIL cross-tenant (tenant A id) should reject';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate is distinct from '42501' then
      raise exception 'FAIL cross-tenant expected 42501 got %', v_sqlstate;
    end if;
  end;
  begin
    perform public.change_order_invoice_v1(v_order, true, null, v_tenant_b, 6);
    raise exception 'FAIL cross-tenant (own tenant id) should reject';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate is distinct from 'P0002' then
      raise exception 'FAIL cross-tenant own id expected P0002 got %', v_sqlstate;
    end if;
  end;
  select count(*) into v_count from public.orders where id = v_order;
  if v_count <> 0 then
    raise exception 'FAIL RLS: tenant B can read tenant A order';
  end if;

  -- Unauthenticated callers.
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    perform public.change_order_invoice_v1(v_order, true, null, v_tenant_a, 6);
    raise exception 'FAIL anonymous should reject';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate is distinct from '28000' then
      raise exception 'FAIL anonymous expected 28000 got %', v_sqlstate;
    end if;
  end;

  execute 'reset role';

  -- anon cannot even execute the RPC.
  if has_function_privilege('anon', 'public.change_order_invoice_v1(uuid, boolean, boolean, uuid, bigint)', 'execute') then
    raise exception 'FAIL anon can execute change_order_invoice_v1';
  end if;

  -- The CHECK holds even for the technical owner.
  begin
    update public.orders set invoice_required = false, invoice_delivered = true where id = v_order;
    raise exception 'FAIL check constraint should reject';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate is distinct from '23514' then
      raise exception 'FAIL check expected 23514 got %', v_sqlstate;
    end if;
  end;

  raise notice 'PASS phase66 order invoice tracking';
end;
$phase66$;

rollback;
