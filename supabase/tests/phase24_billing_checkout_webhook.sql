-- Billing B2 · Basic storage 5 GiB + event ordering sync protections.

begin;

do $phase24$
declare
  v_owner uuid := 'e2400000-0000-4000-8000-000000000001';
  v_tenant uuid := 'e2400000-0000-4000-8000-000000000011';
  v_mvp_id uuid;
  v_basic_id uuid;
  v_sub_mvp uuid;
  v_sync jsonb;
  v_sub_id uuid;
  v_count int;
  v_limit bigint;
  v_demo_plan text;
  v_demo_provider text;
  v_demo_status text;
  v_sur4_plan text;
  v_sur4_provider text;
  v_sur4_status text;
  v_old timestamptz := timestamptz '2026-01-01 00:00:00+00';
  v_new timestamptz := timestamptz '2026-01-02 00:00:00+00';
  v_period_end timestamptz;
  v_custom_cancel timestamptz;
begin
  select p.code, s.provider, s.status
  into v_demo_plan, v_demo_provider, v_demo_status
  from public.tenants t
  join public.subscriptions s on s.tenant_id = t.id
  join public.plans p on p.id = s.plan_id
  where t.slug = 'demo'
  limit 1;

  select p.code, s.provider, s.status
  into v_sur4_plan, v_sur4_provider, v_sur4_status
  from public.tenants t
  join public.subscriptions s on s.tenant_id = t.id
  join public.plans p on p.id = s.plan_id
  where t.slug = 'sur4'
  limit 1;

  select id into v_basic_id from public.plans where code = 'basic';
  select id into v_mvp_id from public.plans where code = 'mvp';

  if v_basic_id is null or v_mvp_id is null then
    raise exception 'phase24: basic/mvp plan missing';
  end if;

  -- Basic storage = 5 GiB
  select pf.limit_value into v_limit
  from public.plan_features pf
  join public.features f on f.id = pf.feature_id
  where pf.plan_id = v_basic_id
    and f.code = 'storage_bytes'
    and pf.enabled is true;

  if v_limit is distinct from 5368709120::bigint then
    raise exception 'phase24: basic storage_bytes expected 5368709120, got %', v_limit;
  end if;

  if exists (
    select 1
    from public.plan_features pf
    join public.features f on f.id = pf.feature_id
    where pf.plan_id = v_mvp_id
      and f.code = 'storage_bytes'
  ) then
    raise exception 'phase24: mvp must not have storage_bytes';
  end if;

  -- provider_event_created_at column exists
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'provider_event_created_at'
  ) then
    raise exception 'phase24: provider_event_created_at missing';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner@phase24.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into public.profiles (id, full_name) values (v_owner, 'Phase24 Owner');
  insert into public.tenants (id, name, slug, active)
  values (v_tenant, 'Phase24 Tenant', 'phase24-tenant', true);
  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant, v_owner, 'owner', true);

  insert into public.subscriptions (
    tenant_id, plan_id, provider, status, cancel_at_period_end
  ) values (
    v_tenant, v_mvp_id, 'internal', 'active', false
  )
  returning id into v_sub_mvp;

  -- newer event wins
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase24',
    'sub_phase24',
    'active',
    now(),
    now() + interval '30 days',
    false,
    '{}'::jsonb,
    v_new
  );

  if coalesce((v_sync ->> 'stale')::boolean, false) then
    raise exception 'phase24: unexpected stale on fresh sync';
  end if;

  v_sub_id := (v_sync ->> 'subscription_id')::uuid;

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_mvp and status = 'canceled'
  ) then
    raise exception 'phase24: mvp current not canceled';
  end if;

  -- stale older event ignored
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase24',
    'sub_phase24',
    'past_due',
    now(),
    now() + interval '30 days',
    false,
    '{}'::jsonb,
    v_old
  );

  if coalesce((v_sync ->> 'stale')::boolean, false) is not true then
    raise exception 'phase24: expected stale=true for older event';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id
      and status = 'active'
      and provider_event_created_at = v_new
  ) then
    raise exception 'phase24: stale event overwrote newer state';
  end if;

  -- equal/newer event can update
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase24',
    'sub_phase24',
    'past_due',
    now(),
    now() + interval '30 days',
    true,
    '{}'::jsonb,
    v_new
  );

  if coalesce((v_sync ->> 'stale')::boolean, false) then
    raise exception 'phase24: same-created event should apply';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id and status = 'past_due' and cancel_at_period_end is true
  ) then
    raise exception 'phase24: same-created update did not apply';
  end if;

  select count(*)::int into v_count
  from public.subscriptions
  where tenant_id = v_tenant
    and status = any (array['trialing', 'active', 'past_due']);

  if v_count <> 1 then
    raise exception 'phase24: one-current broken (%)', v_count;
  end if;

  -- quota resolution for this disposable tenant with stripe current
  v_limit := public.resolve_tenant_storage_limit_bytes(v_tenant);
  if v_limit is distinct from 5368709120::bigint then
    raise exception 'phase24: basic current quota expected 5GiB, got %', v_limit;
  end if;

  -- cancel_at column exists
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'subscriptions'
      and column_name = 'cancel_at'
  ) then
    raise exception 'phase24: cancel_at column missing';
  end if;

  -- A: active + cancel_at_period_end=false + cancel_at=period_end
  v_period_end := now() + interval '14 days';
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase24',
    'sub_phase24',
    'active',
    now(),
    v_period_end,
    false,
    '{}'::jsonb,
    v_new + interval '1 hour',
    v_period_end
  );

  if coalesce((v_sync ->> 'stale')::boolean, false) then
    raise exception 'phase24: cancel_at sync unexpectedly stale';
  end if;

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id
      and status = 'active'
      and cancel_at_period_end is false
      and cancel_at is not distinct from v_period_end
  ) then
    raise exception 'phase24: cancel_at=period_end not persisted while active';
  end if;

  -- B: cancel_at_period_end=true still works
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase24',
    'sub_phase24',
    'active',
    now(),
    v_period_end,
    true,
    '{}'::jsonb,
    v_new + interval '2 hours',
    null
  );

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id
      and status = 'active'
      and cancel_at_period_end is true
      and cancel_at is null
  ) then
    raise exception 'phase24: cancel_at_period_end=true path broken';
  end if;

  -- C: no schedule
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase24',
    'sub_phase24',
    'active',
    now(),
    v_period_end,
    false,
    '{}'::jsonb,
    v_new + interval '3 hours',
    null
  );

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id
      and cancel_at_period_end is false
      and cancel_at is null
  ) then
    raise exception 'phase24: unscheduled cancellation not cleared';
  end if;

  -- D: custom cancel_at != period end
  v_custom_cancel := v_period_end + interval '7 days';
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase24',
    'sub_phase24',
    'active',
    now(),
    v_period_end,
    false,
    '{}'::jsonb,
    v_new + interval '4 hours',
    v_custom_cancel
  );

  if not exists (
    select 1 from public.subscriptions
    where id = v_sub_id
      and status = 'active'
      and cancel_at is not distinct from v_custom_cancel
      and cancel_at_period_end is false
  ) then
    raise exception 'phase24: custom cancel_at not persisted';
  end if;

  -- E: status stays active even if metadata mentions canceled_at
  v_sync := public.sync_billing_subscription_v1(
    v_tenant,
    v_basic_id,
    'stripe',
    'cus_phase24',
    'sub_phase24',
    'active',
    now(),
    v_period_end,
    false,
    jsonb_build_object('canceled_at_note', 'present_but_ignored'),
    v_new + interval '5 hours',
    v_period_end
  );

  if (v_sync ->> 'status') is distinct from 'active' then
    raise exception 'phase24: status must remain active when Stripe status is active';
  end if;

  delete from public.subscriptions where tenant_id = v_tenant;
  delete from public.memberships where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.profiles where id = v_owner;
  delete from auth.users where id = v_owner;

  if v_demo_plan is not null then
    if not exists (
      select 1
      from public.tenants t
      join public.subscriptions s on s.tenant_id = t.id
      join public.plans p on p.id = s.plan_id
      where t.slug = 'demo'
        and p.code = v_demo_plan
        and s.provider = v_demo_provider
        and s.status = v_demo_status
    ) then
      raise exception 'phase24: demo mutated';
    end if;
  end if;

  if v_sur4_plan is not null then
    if not exists (
      select 1
      from public.tenants t
      join public.subscriptions s on s.tenant_id = t.id
      join public.plans p on p.id = s.plan_id
      where t.slug = 'sur4'
        and p.code = v_sur4_plan
        and s.provider = v_sur4_provider
        and s.status = v_sur4_status
    ) then
      raise exception 'phase24: sur4 mutated';
    end if;
  end if;

  raise notice 'phase24_billing_checkout_webhook: ok';
end;
$phase24$;

rollback;
