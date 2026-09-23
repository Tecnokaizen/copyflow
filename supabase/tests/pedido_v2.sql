-- Self-contained local fixtures, no production data; always rolled back.
begin;
do $pedido_v2$
declare
  a uuid := gen_random_uuid();
  b uuid := gen_random_uuid();
  owner_a uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid();
  staff_a uuid := gen_random_uuid();
  viewer_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  state_a uuid := gen_random_uuid();
  file_state_a uuid := gen_random_uuid();
  file_state_b uuid := gen_random_uuid();
  order_a uuid := gen_random_uuid();
  affected integer;
  denied boolean;
  current_actor uuid;
  layout jsonb := '{"version":1,"placements":{"client":"primary","service":"primary","description":"primary","store":"primary","due_at":"primary","priority":"primary","assigned_team_member":"primary","entry_channel":"more","title":"hidden","order_context":"more","notes":"hidden","file_status":"primary","files":"more"}}';
begin
  insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
  select u, u::text || '@pedido-v2.test', '{}'::jsonb, '{}'::jsonb
  from unnest(array[owner_a, admin_a, staff_a, viewer_a, owner_b]) u;
  insert into public.profiles (id, full_name)
  select u, 'Pedido V2 test' from unnest(array[owner_a, admin_a, staff_a, viewer_a, owner_b]) u;
  insert into public.tenants (id, name, slug, active) values
    (a, 'DEMO test', 'pedido-v2-demo', true), (b, 'SUR4 test', 'pedido-v2-sur4', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (a, owner_a, 'owner', true), (a, admin_a, 'admin', true),
    (a, staff_a, 'staff', true), (a, viewer_a, 'viewer', true), (b, owner_b, 'owner', true);
  insert into public.tenant_settings (tenant_id, preferences) values
    (a, '{"unrelated":"keep"}'), (b, '{"unrelated":"sur4"}');
  insert into public.order_statuses (id, tenant_id, name, code, is_initial, active)
    values (state_a, a, 'Recibido', 'received', true, true);
  insert into public.file_statuses (id, tenant_id, name, code, active) values
    (file_state_a, a, 'Pendiente', 'pending', true), (file_state_b, b, 'Listo', 'ready', true);

  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  execute 'set local role authenticated';
  update public.tenant_settings set preferences = preferences || jsonb_build_object('quick_order_layout_v1', layout) where tenant_id = a;
  if (select preferences #>> '{quick_order_layout_v1,placements,title}' from public.tenant_settings where tenant_id = a) <> 'hidden' then
    raise exception 'FAIL hidden not persisted';
  end if;
  if (select preferences ->> 'unrelated' from public.tenant_settings where tenant_id = a) <> 'keep' then
    raise exception 'FAIL adjacent preferences changed';
  end if;
  update public.tenant_settings set preferences = '{}' where tenant_id = b;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL cross-tenant settings write'; end if;
  if exists(select 1 from public.file_statuses where tenant_id = b) then
    raise exception 'FAIL cross-tenant file statuses visible';
  end if;
  execute 'reset role';

  foreach current_actor in array array[admin_a, staff_a, viewer_a] loop
    perform set_config('request.jwt.claim.sub', current_actor::text, true);
    execute 'set local role authenticated';
    denied := false;
    begin
      update public.tenant_settings set preferences = jsonb_set(preferences, '{quick_order_layout_v1,placements,title}', '"primary"') where tenant_id = a;
      get diagnostics affected = row_count;
      denied := affected = 0;
    exception when insufficient_privilege then denied := true;
    end;
    if not denied then raise exception 'FAIL non-owner changed hidden'; end if;
    execute 'reset role';
  end loop;

  perform set_config('request.jwt.claim.sub', staff_a::text, true);
  execute 'set local role authenticated';
  insert into public.orders (id, tenant_id, title, status_id, file_status_id, created_by)
    values (order_a, a, 'Pedido V2', state_a, file_state_a, staff_a);
  if (select file_status_id from public.orders where id = order_a) is distinct from file_state_a then
    raise exception 'FAIL file status not persisted';
  end if;
  if exists(select 1 from public.order_files where order_id = order_a) then
    raise exception 'FAIL operational file status created physical files';
  end if;
  denied := false;
  begin
    insert into public.orders (tenant_id, title, status_id, file_status_id, created_by)
      values (a, 'Foreign status', state_a, file_state_b, staff_a);
  exception when foreign_key_violation then denied := true;
  end;
  if not denied then raise exception 'FAIL foreign tenant status accepted'; end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', owner_b::text, true);
  execute 'set local role authenticated';
  if exists(select 1 from public.orders where id = order_a) then
    raise exception 'FAIL SUR4 can read DEMO order';
  end if;
  if (select preferences ->> 'unrelated' from public.tenant_settings where tenant_id = b) <> 'sur4' then
    raise exception 'FAIL SUR4 preferences changed';
  end if;
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', viewer_a::text, true);
  execute 'set local role authenticated';
  denied := false;
  begin
    insert into public.orders (tenant_id, title, status_id, file_status_id, created_by)
      values (a, 'Viewer forbidden', state_a, file_state_a, viewer_a);
  exception when insufficient_privilege then denied := true;
  end;
  if not denied then raise exception 'FAIL viewer created order'; end if;
  execute 'reset role';
  raise notice 'PASS pedido_v2: hidden, owner-only, tenant isolation, file statuses, staff/viewer';
end;
$pedido_v2$;
rollback;
