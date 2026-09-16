-- Quick Order Layout V1: existing tenant_settings RLS contract.
-- Requires the non-production DEMO and SUR4 tenant fixtures.
-- All writes are rolled back.

begin;

do $quick_order_layout$
declare
  v_demo uuid;
  v_sur4 uuid;
  v_demo_owner uuid := gen_random_uuid();
  v_demo_manager uuid := gen_random_uuid();
  v_demo_staff uuid := gen_random_uuid();
  v_demo_viewer uuid := gen_random_uuid();
  v_sur4_owner uuid := gen_random_uuid();
  v_count integer;
  v_original_demo jsonb;
  v_original_sur4 jsonb;
begin
  select id into strict v_demo
  from public.tenants
  where slug = 'demo';

  select id into strict v_sur4
  from public.tenants
  where slug = 'sur4';

  select preferences into v_original_demo
  from public.tenant_settings
  where tenant_id = v_demo;

  select preferences into v_original_sur4
  from public.tenant_settings
  where tenant_id = v_sur4;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_demo_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'quick-layout-owner-demo@test.invalid', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_demo_manager, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'quick-layout-manager-demo@test.invalid', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_demo_staff, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'quick-layout-staff-demo@test.invalid', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_demo_viewer, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'quick-layout-viewer-demo@test.invalid', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_sur4_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'quick-layout-owner-sur4@test.invalid', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_demo_owner, 'Quick Layout DEMO Owner'),
    (v_demo_manager, 'Quick Layout DEMO Manager'),
    (v_demo_staff, 'Quick Layout DEMO Staff'),
    (v_demo_viewer, 'Quick Layout DEMO Viewer'),
    (v_sur4_owner, 'Quick Layout SUR4 Owner');

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_demo, v_demo_owner, 'owner', true),
    (v_demo, v_demo_manager, 'manager', true),
    (v_demo, v_demo_staff, 'staff', true),
    (v_demo, v_demo_viewer, 'viewer', true),
    (v_sur4, v_sur4_owner, 'owner', true);

  -- Owner can update only their own tenant settings.
  perform set_config('request.jwt.claim.sub', v_demo_owner::text, true);
  execute 'set local role authenticated';
  update public.tenant_settings
  set preferences = preferences || jsonb_build_object(
    'quick_order_layout_v1',
    jsonb_build_object(
      'version', 1,
      'placements', jsonb_build_object(
        'client', 'more',
        'service', 'primary',
        'description', 'primary',
        'store', 'primary',
        'due_at', 'primary',
        'priority', 'primary',
        'assigned_team_member', 'primary',
        'entry_channel', 'more',
        'title', 'primary',
        'order_context', 'more',
        'notes', 'more'
      )
    )
  )
  where tenant_id = v_demo;
  get diagnostics v_count = row_count;
  execute 'reset role';

  if v_count <> 1 then
    raise exception 'FAIL DEMO owner update: expected 1 row, got %', v_count;
  end if;

  -- Manager, staff and viewer can read the resolved preference but cannot write.
  perform set_config('request.jwt.claim.sub', v_demo_manager::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count
  from public.tenant_settings
  where tenant_id = v_demo;
  if v_count <> 1 then
    raise exception 'FAIL DEMO manager read: expected 1 row, got %', v_count;
  end if;
  update public.tenant_settings
  set preferences = '{}'::jsonb
  where tenant_id = v_demo;
  get diagnostics v_count = row_count;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FAIL DEMO manager update: expected 0 rows, got %', v_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_demo_staff::text, true);
  execute 'set local role authenticated';
  update public.tenant_settings
  set preferences = '{}'::jsonb
  where tenant_id = v_demo;
  get diagnostics v_count = row_count;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FAIL DEMO staff update: expected 0 rows, got %', v_count;
  end if;

  perform set_config('request.jwt.claim.sub', v_demo_viewer::text, true);
  execute 'set local role authenticated';
  update public.tenant_settings
  set preferences = '{}'::jsonb
  where tenant_id = v_demo;
  get diagnostics v_count = row_count;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FAIL DEMO viewer update: expected 0 rows, got %', v_count;
  end if;

  -- DEMO owner cannot read or update SUR4 settings.
  perform set_config('request.jwt.claim.sub', v_demo_owner::text, true);
  execute 'set local role authenticated';
  select count(*) into v_count
  from public.tenant_settings
  where tenant_id = v_sur4;
  if v_count <> 0 then
    raise exception 'FAIL cross-tenant read: DEMO owner saw SUR4';
  end if;
  update public.tenant_settings
  set preferences = '{}'::jsonb
  where tenant_id = v_sur4;
  get diagnostics v_count = row_count;
  execute 'reset role';
  if v_count <> 0 then
    raise exception 'FAIL cross-tenant update: DEMO owner changed SUR4';
  end if;

  -- Neighboring preference keys and SUR4 remain untouched before rollback.
  if not (
    (select preferences from public.tenant_settings where tenant_id = v_demo)
    @> (v_original_demo - 'quick_order_layout_v1')
  ) then
    raise exception 'FAIL DEMO neighboring preferences changed';
  end if;

  if (select preferences from public.tenant_settings where tenant_id = v_sur4)
     is distinct from v_original_sur4 then
    raise exception 'FAIL SUR4 preferences changed';
  end if;

  raise notice 'quick order layout RLS DEMO/SUR4 OK';
end;
$quick_order_layout$;

rollback;
