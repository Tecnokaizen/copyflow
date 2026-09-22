-- Tenant provisioning_state V1
-- Separates provisioning lifecycle from administrative active and Stripe status.
-- Existing rows default to ready (including DEMO/SUR4 without slug-specific UPDATEs).

-- ---------------------------------------------------------------------------
-- 1. Column + invariants
-- ---------------------------------------------------------------------------
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS provisioning_state text NOT NULL DEFAULT 'ready';

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_provisioning_state_check;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_provisioning_state_check
  CHECK (
    provisioning_state = any (
      array['pending_billing'::text, 'ready'::text]
    )
  );

ALTER TABLE public.tenants
  DROP CONSTRAINT IF EXISTS tenants_pending_billing_requires_inactive;

ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_pending_billing_requires_inactive
  CHECK (
    provisioning_state <> 'pending_billing'
    OR active is false
  );

COMMENT ON COLUMN public.tenants.provisioning_state IS
  'Provisioning lifecycle: pending_billing (awaiting Stripe activation) | ready (provisioned). Distinct from tenants.active (admin availability) and subscriptions.status (commercial Stripe state).';

COMMENT ON COLUMN public.tenants.active IS
  'Administrative availability of the tenant. Distinct from provisioning_state and subscriptions.status.';

-- ---------------------------------------------------------------------------
-- 2. create_organization · commercial pending_billing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization (
  p_name     text,
  p_slug     text,
  p_timezone text DEFAULT 'Europe/Madrid'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_slug text;
  v_timezone text;
  v_full_name text;
  v_tenant public.tenants%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  if exists (
    select 1
    from public.memberships m
    where m.user_id = v_user_id
      and m.role = 'owner'
      and m.active = true
  ) then
    raise exception 'organization limit reached'
      using errcode = '54000';
  end if;

  v_name := nullif(pg_catalog.btrim(p_name), '');
  if v_name is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  v_slug := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, '')));
  v_slug := pg_catalog.regexp_replace(v_slug, '\s+', '-', 'g');

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if v_slug in (
    'app', 'www', 'api', 'admin', 'auth', 'dashboard', 'demo'
  ) then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if exists (
    select 1 from public.tenants t where t.slug = v_slug
  ) then
    raise exception 'slug already exists'
      using errcode = '23505';
  end if;

  v_timezone := nullif(pg_catalog.btrim(coalesce(p_timezone, '')), '');
  if v_timezone is null then
    v_timezone := 'Europe/Madrid';
  end if;

  select
    nullif(
      pg_catalog.btrim(
        coalesce(
          u.raw_user_meta_data ->> 'full_name',
          u.raw_user_meta_data ->> 'name',
          pg_catalog.split_part(coalesce(u.email, ''), '@', 1)
        )
      ),
      ''
    )
  into v_full_name
  from auth.users u
  where u.id = v_user_id;

  insert into public.profiles (id, full_name)
  values (v_user_id, v_full_name)
  on conflict (id) do nothing;

  insert into public.tenants (name, slug, active, provisioning_state)
  values (v_name, v_slug, false, 'pending_billing')
  returning * into v_tenant;

  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant.id, v_user_id, 'owner', true);

  insert into public.tenant_settings (
    tenant_id, business_name, timezone, locale, currency
  ) values (
    v_tenant.id, v_name, v_timezone, 'es-ES', 'EUR'
  );

  insert into public.order_statuses (
    tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values
    (v_tenant.id, 'Recibido', 'received', true, false, false, false, true, 1),
    (v_tenant.id, 'En proceso', 'in_progress', false, false, false, false, true, 2),
    (v_tenant.id, 'Listo', 'ready', false, true, false, false, true, 3),
    (v_tenant.id, 'Entregado', 'closed', false, false, true, false, true, 4),
    (v_tenant.id, 'Cancelado', 'cancelled', false, false, false, true, true, 5);

  insert into public.customer_types (tenant_id, name, active, sort_order)
  values
    (v_tenant.id, 'Particular', true, 1),
    (v_tenant.id, 'Empresa', true, 2);

  insert into public.entry_channels (tenant_id, name, code, active, sort_order)
  values
    (v_tenant.id, 'Mostrador', 'counter', true, 1),
    (v_tenant.id, 'Teléfono', 'phone', true, 2),
    (v_tenant.id, 'Email', 'email', true, 3),
    (v_tenant.id, 'Web', 'web', true, 4);

  insert into public.stores (tenant_id, name, active)
  values (v_tenant.id, 'Principal', true);

  return pg_catalog.jsonb_build_object(
    'tenant_id', v_tenant.id,
    'slug', v_tenant.slug,
    'name', v_tenant.name,
    'active', v_tenant.active,
    'provisioning_state', v_tenant.provisioning_state
  );
end;
$function$;

COMMENT ON FUNCTION public.create_organization(text, text, text) IS
  'DEFINER authenticated: commercial onboarding only. Always active=false and provisioning_state=pending_billing. No client-selectable provisioning.';

-- ---------------------------------------------------------------------------
-- 3. create_internal_organization_v1 · ready + active
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_internal_organization_v1 (
  p_user_id  uuid,
  p_name     text,
  p_slug     text,
  p_timezone text DEFAULT 'Europe/Madrid'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_name text;
  v_slug text;
  v_timezone text;
  v_tenant public.tenants%rowtype;
begin
  if p_user_id is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  v_name := nullif(pg_catalog.btrim(p_name), '');
  if v_name is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  v_slug := pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug, '')));
  v_slug := pg_catalog.regexp_replace(v_slug, '\s+', '-', 'g');

  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if exists (select 1 from public.tenants t where t.slug = v_slug) then
    raise exception 'slug already exists'
      using errcode = '23505';
  end if;

  v_timezone := nullif(pg_catalog.btrim(coalesce(p_timezone, '')), '');
  if v_timezone is null then
    v_timezone := 'Europe/Madrid';
  end if;

  insert into public.profiles (id, full_name)
  values (p_user_id, null)
  on conflict (id) do nothing;

  insert into public.tenants (name, slug, active, provisioning_state)
  values (v_name, v_slug, true, 'ready')
  returning * into v_tenant;

  insert into public.memberships (tenant_id, user_id, role, active)
  values (v_tenant.id, p_user_id, 'owner', true);

  insert into public.tenant_settings (
    tenant_id, business_name, timezone, locale, currency
  ) values (
    v_tenant.id, v_name, v_timezone, 'es-ES', 'EUR'
  );

  insert into public.order_statuses (
    tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values
    (v_tenant.id, 'Recibido', 'received', true, false, false, false, true, 1),
    (v_tenant.id, 'En proceso', 'in_progress', false, false, false, false, true, 2),
    (v_tenant.id, 'Listo', 'ready', false, true, false, false, true, 3),
    (v_tenant.id, 'Entregado', 'closed', false, false, true, false, true, 4),
    (v_tenant.id, 'Cancelado', 'cancelled', false, false, false, true, true, 5);

  insert into public.customer_types (tenant_id, name, active, sort_order)
  values
    (v_tenant.id, 'Particular', true, 1),
    (v_tenant.id, 'Empresa', true, 2);

  insert into public.entry_channels (tenant_id, name, code, active, sort_order)
  values
    (v_tenant.id, 'Mostrador', 'counter', true, 1),
    (v_tenant.id, 'Teléfono', 'phone', true, 2),
    (v_tenant.id, 'Email', 'email', true, 3),
    (v_tenant.id, 'Web', 'web', true, 4);

  insert into public.stores (tenant_id, name, active)
  values (v_tenant.id, 'Principal', true);

  return pg_catalog.jsonb_build_object(
    'tenant_id', v_tenant.id,
    'slug', v_tenant.slug,
    'name', v_tenant.name,
    'active', v_tenant.active,
    'provisioning_state', v_tenant.provisioning_state
  );
end;
$function$;

COMMENT ON FUNCTION public.create_internal_organization_v1(uuid, text, text, text) IS
  'DEFINER service-only: internal/ops provisioning with active=true and provisioning_state=ready. Never callable by authenticated.';

-- ---------------------------------------------------------------------------
-- 4. activate_tenant_after_billing_v1 · only pending_billing
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_tenant_after_billing_v1 (
  p_tenant_id uuid,
  p_provider_subscription_id text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_tenant public.tenants%rowtype;
  v_sub public.subscriptions%rowtype;
  v_provider_sub_id text;
begin
  if p_tenant_id is null then
    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'missing_tenant_id'
    );
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 17)
  );

  select * into v_tenant
  from public.tenants t
  where t.id = p_tenant_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected',
      'reason', 'tenant_not_found'
    );
  end if;

  if v_tenant.active is true then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_active',
      'tenant_id', v_tenant.id,
      'slug', v_tenant.slug,
      'provisioning_state', v_tenant.provisioning_state
    );
  end if;

  -- Administratively disabled (or already provisioned inactive): never reactivate via Stripe.
  if v_tenant.provisioning_state is distinct from 'pending_billing' then
    return pg_catalog.jsonb_build_object(
      'outcome', 'not_eligible',
      'reason', 'tenant_not_pending_billing',
      'tenant_id', p_tenant_id,
      'provisioning_state', v_tenant.provisioning_state,
      'active', v_tenant.active
    );
  end if;

  v_provider_sub_id := nullif(pg_catalog.btrim(coalesce(p_provider_subscription_id, '')), '');

  if v_provider_sub_id is not null then
    select * into v_sub
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.provider = 'stripe'
      and s.provider_subscription_id = v_provider_sub_id
    for share;
  else
    select * into v_sub
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.provider = 'stripe'
      and s.status in ('active', 'trialing')
    order by s.updated_at desc nulls last, s.created_at desc nulls last
    limit 1
    for share;
  end if;

  if not found then
    return pg_catalog.jsonb_build_object(
      'outcome', 'not_eligible',
      'reason', 'missing_stripe_subscription',
      'tenant_id', p_tenant_id
    );
  end if;

  if v_sub.status not in ('active', 'trialing') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'not_eligible',
      'reason', 'subscription_status_not_qualifying',
      'tenant_id', p_tenant_id,
      'subscription_status', v_sub.status
    );
  end if;

  update public.tenants t
  set
    active = true,
    provisioning_state = 'ready'
  where t.id = p_tenant_id
    and t.active is false
    and t.provisioning_state = 'pending_billing';

  return pg_catalog.jsonb_build_object(
    'outcome', 'activated',
    'tenant_id', p_tenant_id,
    'slug', v_tenant.slug,
    'provisioning_state', 'ready',
    'subscription_status', v_sub.status,
    'provider_subscription_id', v_sub.provider_subscription_id
  );
end;
$function$;

COMMENT ON FUNCTION public.activate_tenant_after_billing_v1(uuid, text) IS
  'DEFINER service-only: one-way activate only when pending_billing + inactive + Stripe active/trialing. Sets active=true and provisioning_state=ready. Never reactivates ready+inactive. Never deactivates.';

-- ---------------------------------------------------------------------------
-- 5. Immutability: active + provisioning_state for authenticated
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_tenant_active_immutability()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if new.active is not distinct from old.active
     and new.provisioning_state is not distinct from old.provisioning_state then
    return new;
  end if;

  -- JWT-authenticated clients cannot flip administrative/provisioning fields.
  -- Service-only activators (and postgres) run without auth.uid().
  if auth.uid() is not null then
    raise exception 'tenant active/provisioning_state is immutable for authenticated clients'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_tenants_active_immutable ON public.tenants;
CREATE TRIGGER trg_tenants_active_immutable
  BEFORE UPDATE OF active, provisioning_state ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tenant_active_immutability();

COMMENT ON FUNCTION public.enforce_tenant_active_immutability() IS
  'Blocks authenticated clients from changing tenants.active or tenants.provisioning_state.';
