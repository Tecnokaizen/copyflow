-- Paid Onboarding V1
-- - create_organization: commercial tenants start active=false (default)
-- - activate_tenant_after_billing_v1: service-only one-way activation
-- Does NOT modify DEMO/SUR4 rows.

-- ---------------------------------------------------------------------------
-- create_organization · provisioning mode
-- Drop the prior 3-arg signature so PostgREST resolves a single function
-- with a defaulted 4th parameter (commercial).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_organization(text, text, text);

CREATE OR REPLACE FUNCTION public.create_organization (
  p_name     text,
  p_slug     text,
  p_timezone text DEFAULT 'Europe/Madrid'::text,
  p_provisioning_mode text DEFAULT 'commercial'::text
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
  v_mode text;
  v_tenant_active boolean;
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

  v_mode := pg_catalog.lower(pg_catalog.btrim(coalesce(p_provisioning_mode, 'commercial')));
  if v_mode not in ('commercial', 'internal') then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  -- commercial = paid onboarding (inactive until Stripe webhook activates)
  -- internal = ops/demo-style provisioning (available immediately)
  v_tenant_active := (v_mode = 'internal');

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
    'app',
    'www',
    'api',
    'admin',
    'auth',
    'dashboard',
    'demo'
  ) then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.tenants t
    where t.slug = v_slug
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

  insert into public.profiles (
    id,
    full_name
  )
  values (
    v_user_id,
    v_full_name
  )
  on conflict (id) do nothing;

  insert into public.tenants (
    name,
    slug,
    active
  )
  values (
    v_name,
    v_slug,
    v_tenant_active
  )
  returning * into v_tenant;

  insert into public.memberships (
    tenant_id,
    user_id,
    role,
    active
  )
  values (
    v_tenant.id,
    v_user_id,
    'owner',
    true
  );

  insert into public.tenant_settings (
    tenant_id,
    business_name,
    timezone,
    locale,
    currency
  )
  values (
    v_tenant.id,
    v_name,
    v_timezone,
    'es-ES',
    'EUR'
  );

  insert into public.order_statuses (
    tenant_id,
    name,
    code,
    is_initial,
    is_ready,
    is_closed,
    is_cancelled,
    active,
    sort_order
  )
  values
    (
      v_tenant.id,
      'Recibido',
      'received',
      true,
      false,
      false,
      false,
      true,
      1
    ),
    (
      v_tenant.id,
      'En proceso',
      'in_progress',
      false,
      false,
      false,
      false,
      true,
      2
    ),
    (
      v_tenant.id,
      'Listo',
      'ready',
      false,
      true,
      false,
      false,
      true,
      3
    ),
    (
      v_tenant.id,
      'Entregado',
      'closed',
      false,
      false,
      true,
      false,
      true,
      4
    ),
    (
      v_tenant.id,
      'Cancelado',
      'cancelled',
      false,
      false,
      false,
      true,
      true,
      5
    );

  insert into public.customer_types (
    tenant_id,
    name,
    active,
    sort_order
  )
  values
    (v_tenant.id, 'Particular', true, 1),
    (v_tenant.id, 'Empresa', true, 2);

  insert into public.entry_channels (
    tenant_id,
    name,
    code,
    active,
    sort_order
  )
  values
    (v_tenant.id, 'Mostrador', 'counter', true, 1),
    (v_tenant.id, 'Teléfono', 'phone', true, 2),
    (v_tenant.id, 'Email', 'email', true, 3),
    (v_tenant.id, 'Web', 'web', true, 4);

  insert into public.stores (
    tenant_id,
    name,
    active
  )
  values (
    v_tenant.id,
    'Principal',
    true
  );

  -- Commercial onboarding must NOT create an internal/mvp subscription.
  -- Stripe Basic is attached later via verified webhook sync.

  return pg_catalog.jsonb_build_object(
    'tenant_id',
      v_tenant.id,
    'slug',
      v_tenant.slug,
    'name',
      v_tenant.name,
    'active',
      v_tenant.active,
    'provisioning_mode',
      v_mode
  );
end;
$function$;

COMMENT ON FUNCTION public.create_organization(text, text, text, text) IS
  'DEFINER: crea tenant + owner + seed mínimo. commercial (default)=active false sin subscription MVP; internal=active true. Actor=auth.uid(). Máx. una membership owner activa por usuario.';

-- Keep 3-arg overload working via default on 4th param (Postgres uses the
-- 4-arg signature with defaults). Drop any stale 3-arg-only grants and
-- re-grant the current signature.
REVOKE ALL ON FUNCTION public.create_organization(text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization(text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, text)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- activate_tenant_after_billing_v1 · service-only, one-way
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

  -- Serialize activation attempts per tenant.
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
      'slug', v_tenant.slug
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
  set active = true
  where t.id = p_tenant_id
    and t.active is false;

  return pg_catalog.jsonb_build_object(
    'outcome', 'activated',
    'tenant_id', p_tenant_id,
    'slug', v_tenant.slug,
    'subscription_status', v_sub.status,
    'provider_subscription_id', v_sub.provider_subscription_id
  );
end;
$function$;

COMMENT ON FUNCTION public.activate_tenant_after_billing_v1(uuid, text) IS
  'DEFINER service-only: one-way tenants.active=true when a local Stripe subscription is active/trialing. Never deactivates. Idempotent.';

REVOKE ALL ON FUNCTION public.activate_tenant_after_billing_v1(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.activate_tenant_after_billing_v1(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.activate_tenant_after_billing_v1(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.activate_tenant_after_billing_v1(uuid, text)
  TO postgres, service_role;
