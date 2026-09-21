-- Settings V1 · operational catalog guards (identity + Kiosk reserve).
-- Run after 20260921150000_settings_catalogs_harden_v1.sql.

begin;

do $phase20$
declare
  v_owner_a uuid := 'e2000000-0000-4000-8000-000000000001';
  v_staff_a uuid := 'e2000000-0000-4000-8000-000000000002';
  v_viewer_a uuid := 'e2000000-0000-4000-8000-000000000003';
  v_owner_b uuid := 'e2000000-0000-4000-8000-000000000004';
  v_admin_a uuid := 'e2000000-0000-4000-8000-000000000005';
  v_manager_a uuid := 'e2000000-0000-4000-8000-000000000006';
  v_tenant_a uuid := 'e2000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e2000000-0000-4000-8000-000000000012';
  v_channel_id uuid;
  v_kiosk_id uuid;
  v_type_id uuid;
  v_foreign_id uuid;
  v_sqlstate text;
  v_message text;
  v_name text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase20.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-a@phase20.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_manager_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'manager-a@phase20.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase20.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase20.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase20.test', crypt('pw', gen_salt('bf')), now(),
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
    (v_tenant_a, 'Tenant A Phase20', 'tenant-a-phase20', true),
    (v_tenant_b, 'Tenant B Phase20', 'tenant-b-phase20', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_admin_a, 'admin', true),
    (v_tenant_a, v_manager_a, 'manager', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  -- Seed as postgres (privileged): includes a dormant kiosk channel for A.
  insert into public.entry_channels (id, tenant_id, name, code, active, sort_order) values
    (gen_random_uuid(), v_tenant_a, 'Mostrador', 'counter', true, 1),
    (gen_random_uuid(), v_tenant_a, 'Kiosk', 'kiosk', false, 99),
    (gen_random_uuid(), v_tenant_b, 'Mostrador', 'counter', true, 1);

  insert into public.customer_types (id, tenant_id, name, active, sort_order) values
    (gen_random_uuid(), v_tenant_a, 'Particular', true, 1),
    (gen_random_uuid(), v_tenant_b, 'Particular', true, 1);

  insert into public.order_contexts (tenant_id, name, code, active, sort_order) values
    (v_tenant_a, 'Urgente', 'urgent', true, 1);
  insert into public.file_statuses (tenant_id, name, code, active, sort_order) values
    (v_tenant_a, 'Pendiente', 'pending', true, 1);
  insert into public.quote_statuses (tenant_id, name, code, active, sort_order) values
    (v_tenant_a, 'Borrador', 'draft', true, 1);
  insert into public.payment_statuses (tenant_id, name, code, active, sort_order) values
    (v_tenant_a, 'Pendiente', 'pending', true, 1);
  insert into public.delivery_methods (tenant_id, name, code, active, sort_order) values
    (v_tenant_a, 'Recogida', 'pickup', true, 1);
  insert into public.service_categories (tenant_id, name, active, sort_order) values
    (v_tenant_a, 'Impresión', true, 1);

  select id into v_channel_id from public.entry_channels
    where tenant_id = v_tenant_a and code = 'counter';
  select id into v_kiosk_id from public.entry_channels
    where tenant_id = v_tenant_a and code = 'kiosk';
  select id into v_type_id from public.customer_types
    where tenant_id = v_tenant_a limit 1;
  select id into v_foreign_id from public.entry_channels
    where tenant_id = v_tenant_b limit 1;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  -- A) Owner can create a normal entry channel.
  insert into public.entry_channels (tenant_id, name, code, active, sort_order)
  values (v_tenant_a, 'WhatsApp', 'whatsapp', true, 2)
  returning id into v_channel_id;

  -- B) Authenticated cannot INSERT code=kiosk.
  v_sqlstate := null;
  v_message := null;
  begin
    insert into public.entry_channels (tenant_id, name, code, active, sort_order)
    values (v_tenant_a, 'Kiosk 2', 'kiosk', true, 3);
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501'
     or position('kiosk_channel_reserved' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL B expected kiosk_channel_reserved, got % / %', v_sqlstate, v_message;
  end if;

  -- C) Authenticated cannot flip kiosk.active.
  v_sqlstate := null;
  v_message := null;
  begin
    update public.entry_channels
    set active = true
    where id = v_kiosk_id and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501'
     or position('kiosk_channel_active_immutable' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL C expected kiosk_channel_active_immutable, got % / %', v_sqlstate, v_message;
  end if;

  -- D) Name/sort of kiosk remain editable.
  update public.entry_channels
  set name = 'Kiosk público', sort_order = 50
  where id = v_kiosk_id and tenant_id = v_tenant_a;

  select name into v_name from public.entry_channels where id = v_kiosk_id;
  if v_name is distinct from 'Kiosk público' then
    raise exception 'FAIL D kiosk name update failed';
  end if;

  -- E) code is immutable.
  v_sqlstate := null;
  v_message := null;
  begin
    update public.entry_channels
    set code = 'forged'
    where id = v_channel_id and tenant_id = v_tenant_a;
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501'
     or position('catalog_code_immutable' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL E expected catalog_code_immutable, got % / %', v_sqlstate, v_message;
  end if;

  -- F) tenant_id is immutable.
  v_sqlstate := null;
  v_message := null;
  begin
    update public.entry_channels
    set tenant_id = v_tenant_b
    where id = v_channel_id;
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501'
     or position('catalog_tenant_immutable' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL F expected catalog_tenant_immutable, got % / %', v_sqlstate, v_message;
  end if;

  -- G) Rename keeps code.
  update public.entry_channels
  set name = 'WhatsApp empresa'
  where id = v_channel_id and tenant_id = v_tenant_a;

  if not exists (
    select 1 from public.entry_channels
    where id = v_channel_id and code = 'whatsapp' and name = 'WhatsApp empresa'
  ) then
    raise exception 'FAIL G rename changed code or failed';
  end if;

  -- H) UNIQUE (tenant_id, code) still protects duplicates.
  v_sqlstate := null;
  begin
    insert into public.entry_channels (tenant_id, name, code, active, sort_order)
    values (v_tenant_a, 'Otro WhatsApp', 'whatsapp', true, 9);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'FAIL H expected unique 23505, got %', v_sqlstate;
  end if;

  -- I) customer_types unique name + tenant immutable.
  v_sqlstate := null;
  begin
    insert into public.customer_types (tenant_id, name, active, sort_order)
    values (v_tenant_a, 'Particular', true, 2);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'FAIL I expected customer_types unique name 23505, got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  v_message := null;
  begin
    update public.customer_types
    set tenant_id = v_tenant_b
    where id = v_type_id;
  exception when others then
    v_sqlstate := sqlstate;
    v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501'
     or position('catalog_tenant_immutable' in coalesce(v_message, '')) = 0 then
    raise exception 'FAIL I2 expected catalog_tenant_immutable, got % / %', v_sqlstate, v_message;
  end if;

  -- J) Staff cannot write (RLS).
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  v_sqlstate := null;
  begin
    insert into public.customer_types (tenant_id, name, active, sort_order)
    values (v_tenant_a, 'VIP', true, 3);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is null then
    raise exception 'FAIL J staff write should be denied by RLS';
  end if;

  -- K) Viewer can read, not write.
  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  if not exists (
    select 1 from public.entry_channels where tenant_id = v_tenant_a
  ) then
    raise exception 'FAIL K viewer should read own tenant catalogs';
  end if;

  v_sqlstate := null;
  begin
    update public.entry_channels
    set name = 'Hack'
    where id = v_channel_id;
    if found then
      raise exception 'viewer write matched rows';
    end if;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is not null and v_sqlstate is distinct from '42501' then
    raise exception 'FAIL K unexpected viewer write error %', v_sqlstate;
  end if;

  if exists (
    select 1 from public.entry_channels
    where id = v_channel_id and name = 'Hack'
  ) then
    raise exception 'FAIL K viewer write should be denied';
  end if;

  -- L) Admin / manager can write.
  perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
  insert into public.service_categories (tenant_id, name, active, sort_order)
  values (v_tenant_a, 'Gran formato', true, 2);

  perform set_config('request.jwt.claim.sub', v_manager_a::text, true);
  update public.service_categories
  set active = false
  where tenant_id = v_tenant_a and name = 'Gran formato';

  -- M) Cross-tenant isolation: owner A cannot see/update B.
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  if exists (
    select 1 from public.entry_channels where tenant_id = v_tenant_b
  ) then
    raise exception 'FAIL M owner A must not see tenant B channels';
  end if;

  update public.entry_channels
  set name = 'Leak'
  where id = v_foreign_id;
  if found then
    raise exception 'FAIL M cross-tenant update must match zero rows';
  end if;

  -- N) Privileged bypass can mutate kiosk active (future dedicated RPC path).
  execute 'reset role';
  perform set_config('app.allow_kiosk_channel_mutation', 'true', true);
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  update public.entry_channels
  set active = true
  where id = v_kiosk_id and tenant_id = v_tenant_a;

  if not exists (
    select 1 from public.entry_channels
    where id = v_kiosk_id and active = true
  ) then
    raise exception 'FAIL N privileged kiosk active update failed';
  end if;

  -- Restore dormant kiosk for cleanliness inside the rolled-back txn.
  update public.entry_channels
  set active = false
  where id = v_kiosk_id;

  execute 'reset role';
end;
$phase20$;

rollback;
