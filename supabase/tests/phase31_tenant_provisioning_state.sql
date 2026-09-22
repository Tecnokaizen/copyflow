-- Tenant provisioning_state V1 · phase31

begin;

do $phase31$
declare
  v_owner uuid := 'e3100000-0000-4000-8000-000000000099';
  v_owner2 uuid := 'e3100000-0000-4000-8000-000000000098';
  v_owner3 uuid := 'e3100000-0000-4000-8000-000000000097';
  v_tenant uuid;
  v_internal uuid;
  v_disabled uuid;
  v_result jsonb;
  v_state text;
  v_active boolean;
  v_count integer;
  v_sqlstate text;
  v_basic_id uuid;
  v_demo_active boolean;
  v_sur4_active boolean;
  v_demo_state text;
  v_sur4_state text;
begin
  select t.active, t.provisioning_state
  into v_demo_active, v_demo_state
  from public.tenants t where t.slug = 'demo';
  select t.active, t.provisioning_state
  into v_sur4_active, v_sur4_state
  from public.tenants t where t.slug = 'sur4';

  -- A: column DEFAULT is ready; existing DEMO/SUR4 (if present) remain ready
  if v_demo_state is not null and v_demo_state is distinct from 'ready' then
    raise exception 'phase31 A: DEMO provisioning_state expected ready, got %', v_demo_state;
  end if;
  if v_sur4_state is not null and v_sur4_state is distinct from 'ready' then
    raise exception 'phase31 A: SUR4 provisioning_state expected ready, got %', v_sur4_state;
  end if;

  insert into public.tenants (name, slug, active)
  values ('Phase31 Default', 'phase31-default', true)
  returning provisioning_state into v_state;
  if v_state is distinct from 'ready' then
    raise exception 'phase31 A: DEFAULT provisioning_state expected ready, got %', v_state;
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner@phase31.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner2@phase31.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner3, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner3@phase31.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');
  insert into public.profiles (id, full_name) values
    (v_owner, 'Phase31'),
    (v_owner2, 'Phase31 B'),
    (v_owner3, 'Phase31 C');

  select p.id into v_basic_id from public.plans p where p.code = 'basic' limit 1;
  if v_basic_id is null then
    raise exception 'phase31: basic plan missing';
  end if;

  -- B: commercial create_organization
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  v_result := public.create_organization(
    'Phase31 Pending', 'phase31-pending', 'Europe/Madrid'
  );
  v_tenant := (v_result ->> 'tenant_id')::uuid;
  if coalesce((v_result ->> 'active')::boolean, true) is not false then
    raise exception 'phase31 B: active must be false';
  end if;
  if v_result ->> 'provisioning_state' is distinct from 'pending_billing' then
    raise exception 'phase31 B: provisioning_state must be pending_billing, got %', v_result;
  end if;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select t.active, t.provisioning_state into v_active, v_state
  from public.tenants t where t.id = v_tenant;
  if v_active is not false or v_state is distinct from 'pending_billing' then
    raise exception 'phase31 B: row state mismatch active=% state=%', v_active, v_state;
  end if;

  -- C: internal create
  v_result := public.create_internal_organization_v1(
    v_owner2, 'Phase31 Internal', 'phase31-internal', 'Europe/Madrid'
  );
  v_internal := (v_result ->> 'tenant_id')::uuid;
  if coalesce((v_result ->> 'active')::boolean, false) is not true then
    raise exception 'phase31 C: internal must be active';
  end if;
  if v_result ->> 'provisioning_state' is distinct from 'ready' then
    raise exception 'phase31 C: internal must be ready, got %', v_result;
  end if;

  -- D/E: authenticated cannot change provisioning_state / active on an operable tenant
  perform set_config('request.jwt.claim.sub', v_owner2::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('role', 'authenticated', true);

  v_sqlstate := null;
  begin
    update public.tenants
    set provisioning_state = 'pending_billing'
    where id = v_internal;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase31 D: expected 42501 changing provisioning_state, got %', v_sqlstate;
  end if;

  v_sqlstate := null;
  begin
    update public.tenants set active = false where id = v_internal;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'phase31 E: expected 42501 changing active, got %', v_sqlstate;
  end if;

  -- F: pending_billing + Stripe active/trialing => activate
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claim.sub', '', true);

  insert into public.subscriptions (
    tenant_id, plan_id, provider, provider_customer_id, provider_subscription_id,
    status, current_period_start, current_period_end, cancel_at_period_end, metadata
  ) values (
    v_tenant, v_basic_id, 'stripe', 'cus_phase31', 'sub_phase31_active',
    'active', now(), now() + interval '30 days', false, '{}'::jsonb
  );

  v_result := public.activate_tenant_after_billing_v1(v_tenant, 'sub_phase31_active');
  if v_result ->> 'outcome' <> 'activated' then
    raise exception 'phase31 F: expected activated, got %', v_result;
  end if;
  select t.active, t.provisioning_state into v_active, v_state
  from public.tenants t where t.id = v_tenant;
  if v_active is not true or v_state is distinct from 'ready' then
    raise exception 'phase31 F: expected ready+active, got active=% state=%', v_active, v_state;
  end if;

  -- G: ready + active=false must NOT reactivate via Stripe webhook path
  insert into public.tenants (id, name, slug, active, provisioning_state)
  values (
    'e3100000-0000-4000-8000-000000000011',
    'Phase31 Disabled', 'phase31-disabled', false, 'ready'
  );
  v_disabled := 'e3100000-0000-4000-8000-000000000011';
  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_disabled, v_owner3, 'owner', true);
  insert into public.subscriptions (
    tenant_id, plan_id, provider, provider_customer_id, provider_subscription_id,
    status, current_period_start, current_period_end, cancel_at_period_end, metadata
  ) values (
    v_disabled, v_basic_id, 'stripe', 'cus_phase31_d', 'sub_phase31_disabled',
    'active', now(), now() + interval '30 days', false, '{}'::jsonb
  );

  v_result := public.activate_tenant_after_billing_v1(v_disabled, 'sub_phase31_disabled');
  if v_result ->> 'outcome' <> 'not_eligible' then
    raise exception 'phase31 G: expected not_eligible, got %', v_result;
  end if;
  if v_result ->> 'reason' is distinct from 'tenant_not_pending_billing' then
    raise exception 'phase31 G: expected tenant_not_pending_billing, got %', v_result;
  end if;
  select t.active, t.provisioning_state into v_active, v_state
  from public.tenants t where t.id = v_disabled;
  if v_active is not false or v_state is distinct from 'ready' then
    raise exception 'phase31 G: disabled tenant mutated active=% state=%', v_active, v_state;
  end if;

  -- H: active=true + pending_billing forbidden by CHECK
  v_sqlstate := null;
  begin
    update public.tenants
    set provisioning_state = 'pending_billing', active = true
    where id = v_disabled;
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23514' then
    raise exception 'phase31 H: expected 23514 for pending_billing+active, got %', v_sqlstate;
  end if;

  -- I: DEMO/SUR4 unchanged
  if (select t.active from public.tenants t where t.slug = 'demo') is distinct from v_demo_active then
    raise exception 'phase31: DEMO active mutated';
  end if;
  if (select t.provisioning_state from public.tenants t where t.slug = 'demo') is distinct from v_demo_state then
    raise exception 'phase31: DEMO provisioning_state mutated';
  end if;
  if (select t.active from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_active then
    raise exception 'phase31: SUR4 active mutated';
  end if;
  if (select t.provisioning_state from public.tenants t where t.slug = 'sur4') is distinct from v_sur4_state then
    raise exception 'phase31: SUR4 provisioning_state mutated';
  end if;

  raise notice 'phase31_tenant_provisioning_state_ok';
end;
$phase31$;

rollback;
