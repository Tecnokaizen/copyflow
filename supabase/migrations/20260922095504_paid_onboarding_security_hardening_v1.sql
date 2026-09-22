-- Paid Onboarding security hardening V1
-- 1) Commercial-only create_organization (no client-selectable internal mode)
-- 2) Active-tenant authorization boundary for operational access
-- 3) Prevent authenticated self-activation of tenants.active
-- 4) Claimable webhook event processing for retryable failures
-- Does NOT modify DEMO/SUR4 data rows.

-- ---------------------------------------------------------------------------
-- 1. create_organization · commercial only for authenticated
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_organization(text, text, text, text);
DROP FUNCTION IF EXISTS public.create_organization(text, text, text);

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

  -- Public commercial onboarding always starts inactive.
  insert into public.tenants (name, slug, active)
  values (v_name, v_slug, false)
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
    'active', v_tenant.active
  );
end;
$function$;

COMMENT ON FUNCTION public.create_organization(text, text, text) IS
  'DEFINER authenticated: commercial onboarding only. Always tenants.active=false. No client-selectable provisioning mode. No MVP subscription.';

REVOKE ALL ON FUNCTION public.create_organization(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization(text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text)
  TO authenticated, postgres;

-- Optional ops/demo path: service-only, never granted to authenticated.
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

  insert into public.tenants (name, slug, active)
  values (v_name, v_slug, true)
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
    'active', v_tenant.active
  );
end;
$function$;

COMMENT ON FUNCTION public.create_internal_organization_v1(uuid, text, text, text) IS
  'DEFINER service-only: internal/ops provisioning with tenants.active=true. Never callable by authenticated.';

REVOKE ALL ON FUNCTION public.create_internal_organization_v1(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_internal_organization_v1(uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.create_internal_organization_v1(uuid, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_internal_organization_v1(uuid, text, text, text)
  TO postgres, service_role;

-- ---------------------------------------------------------------------------
-- 2. Authorization helpers · membership vs active-tenant
-- ---------------------------------------------------------------------------
-- Membership-only (pending onboarding may SELECT own tenant/membership/subscription).
CREATE OR REPLACE FUNCTION public.is_tenant_membership (
  target_tenant_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = target_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_tenant_membership_role (
  target_tenant_id uuid,
  allowed_roles    text[]
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = target_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
      and m.role = any(allowed_roles)
  );
$function$;

-- Active-tenant helpers (explicit).
CREATE OR REPLACE FUNCTION public.is_active_tenant_member (
  target_tenant_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = target_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
      and t.active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.has_active_tenant_role (
  target_tenant_id uuid,
  allowed_roles    text[]
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.memberships m
    join public.tenants t on t.id = m.tenant_id
    where m.tenant_id = target_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
      and m.role = any(allowed_roles)
      and t.active = true
  );
$function$;

-- Redefine legacy helpers used by operational RLS + RPCs to require active tenant.
CREATE OR REPLACE FUNCTION public.is_tenant_member (
  target_tenant_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select public.is_active_tenant_member(target_tenant_id);
$function$;

CREATE OR REPLACE FUNCTION public.has_tenant_role (
  target_tenant_id uuid,
  allowed_roles    text[]
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select public.has_active_tenant_role(target_tenant_id, allowed_roles);
$function$;

REVOKE ALL ON FUNCTION public.is_tenant_membership(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_tenant_membership_role(uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_active_tenant_member(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_active_tenant_role(uuid, text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_tenant_membership(uuid)
  TO authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.has_tenant_membership_role(uuid, text[])
  TO authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_tenant_member(uuid)
  TO authenticated, postgres, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_tenant_role(uuid, text[])
  TO authenticated, postgres, service_role;

-- Pending owners retain minimum SELECT for onboarding resume (not operational data).
DROP POLICY IF EXISTS "tenants_select_member" ON public.tenants;
CREATE POLICY "tenants_select_member" ON public.tenants
  FOR SELECT TO authenticated
  USING (public.is_tenant_membership(id));

DROP POLICY IF EXISTS "memberships_select_same_tenant" ON public.memberships;
CREATE POLICY "memberships_select_same_tenant" ON public.memberships
  FOR SELECT TO authenticated
  USING (public.is_tenant_membership(tenant_id));

DROP POLICY IF EXISTS "subscriptions_select_owner_admin" ON public.subscriptions;
CREATE POLICY "subscriptions_select_owner_admin" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (
    public.has_tenant_membership_role(
      tenant_id,
      ARRAY['owner'::text, 'admin'::text]
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Prevent authenticated from flipping tenants.active
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_tenant_active_immutability()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
begin
  if new.active is not distinct from old.active then
    return new;
  end if;

  -- Any JWT-authenticated client is blocked from flipping tenants.active.
  -- Service-only activators (and postgres) run without auth.uid().
  if auth.uid() is not null then
    raise exception 'tenant active is immutable for authenticated clients'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

DROP TRIGGER IF EXISTS trg_tenants_active_immutable ON public.tenants;
CREATE TRIGGER trg_tenants_active_immutable
  BEFORE UPDATE OF active ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_tenant_active_immutability();

-- ---------------------------------------------------------------------------
-- 4. Webhook event claim / retry
-- ---------------------------------------------------------------------------
ALTER TABLE public.billing_webhook_events
  DROP CONSTRAINT IF EXISTS billing_webhook_events_status_check;

ALTER TABLE public.billing_webhook_events
  ADD CONSTRAINT billing_webhook_events_status_check
  CHECK (
    status = any (
      array[
        'received'::text,
        'processing'::text,
        'processed'::text,
        'ignored'::text,
        'failed'::text
      ]
    )
  );

ALTER TABLE public.billing_webhook_events
  ADD COLUMN IF NOT EXISTS retryable boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.claim_billing_webhook_event_v1 (
  p_provider text,
  p_provider_event_id text,
  p_event_type text,
  p_livemode boolean,
  p_provider_created_at timestamptz DEFAULT NULL,
  p_object_id text DEFAULT NULL
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_provider text := nullif(pg_catalog.btrim(coalesce(p_provider, '')), '');
  v_event_id text := nullif(pg_catalog.btrim(coalesce(p_provider_event_id, '')), '');
  v_row public.billing_webhook_events%rowtype;
  v_inserted boolean := false;
begin
  if v_provider is null or v_event_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_identity');
  end if;

  -- Serialize claims per provider event.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_provider || ':' || v_event_id, 23)
  );

  begin
    insert into public.billing_webhook_events (
      provider,
      provider_event_id,
      event_type,
      livemode,
      provider_created_at,
      object_id,
      status,
      retryable
    ) values (
      v_provider,
      v_event_id,
      coalesce(nullif(pg_catalog.btrim(p_event_type), ''), 'unknown'),
      coalesce(p_livemode, false),
      p_provider_created_at,
      nullif(pg_catalog.btrim(coalesce(p_object_id, '')), ''),
      'processing',
      false
    )
    returning * into v_row;
    v_inserted := true;
  exception
    when unique_violation then
      v_inserted := false;
  end;

  if v_inserted then
    return pg_catalog.jsonb_build_object(
      'outcome', 'claimed',
      'status', v_row.status,
      'provider_event_id', v_event_id
    );
  end if;

  select * into v_row
  from public.billing_webhook_events e
  where e.provider = v_provider
    and e.provider_event_id = v_event_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_row');
  end if;

  if v_row.status in ('processed', 'ignored') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_final',
      'status', v_row.status,
      'provider_event_id', v_event_id
    );
  end if;

  if v_row.status = 'processing'
     and v_row.received_at > (pg_catalog.now() - interval '2 minutes') then
    return pg_catalog.jsonb_build_object(
      'outcome', 'in_progress',
      'status', v_row.status,
      'provider_event_id', v_event_id
    );
  end if;

  -- failed (retryable or not) and stale processing → reclaim
  if v_row.status = 'failed' and v_row.retryable is not true then
    return pg_catalog.jsonb_build_object(
      'outcome', 'already_final',
      'status', v_row.status,
      'retryable', false,
      'error_code', v_row.error_code,
      'provider_event_id', v_event_id
    );
  end if;

  update public.billing_webhook_events e
  set
    status = 'processing',
    retryable = false,
    error_code = null,
    processed_at = null,
    event_type = coalesce(nullif(pg_catalog.btrim(p_event_type), ''), e.event_type),
    object_id = coalesce(
      nullif(pg_catalog.btrim(coalesce(p_object_id, '')), ''),
      e.object_id
    )
  where e.id = v_row.id
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'outcome', 'claimed',
    'status', v_row.status,
    'reclaimed', true,
    'provider_event_id', v_event_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_billing_webhook_event_v1 (
  p_provider text,
  p_provider_event_id text,
  p_status text,
  p_error_code text DEFAULT NULL,
  p_retryable boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_provider text := nullif(pg_catalog.btrim(coalesce(p_provider, '')), '');
  v_event_id text := nullif(pg_catalog.btrim(coalesce(p_provider_event_id, '')), '');
  v_status text := nullif(pg_catalog.btrim(coalesce(p_status, '')), '');
  v_row public.billing_webhook_events%rowtype;
begin
  if v_provider is null or v_event_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_identity');
  end if;

  if v_status not in ('processed', 'ignored', 'failed') then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_status');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_provider || ':' || v_event_id, 23)
  );

  update public.billing_webhook_events e
  set
    status = v_status,
    error_code = nullif(pg_catalog.btrim(coalesce(p_error_code, '')), ''),
    retryable = case when v_status = 'failed' then coalesce(p_retryable, false) else false end,
    processed_at = pg_catalog.now()
  where e.provider = v_provider
    and e.provider_event_id = v_event_id
  returning * into v_row;

  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'missing_row');
  end if;

  return pg_catalog.jsonb_build_object(
    'outcome', 'finalized',
    'status', v_row.status,
    'retryable', v_row.retryable,
    'provider_event_id', v_event_id
  );
end;
$function$;

REVOKE ALL ON FUNCTION public.claim_billing_webhook_event_v1(text, text, text, boolean, timestamptz, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_billing_webhook_event_v1(text, text, text, boolean, timestamptz, text) FROM anon;
REVOKE ALL ON FUNCTION public.claim_billing_webhook_event_v1(text, text, text, boolean, timestamptz, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_billing_webhook_event_v1(text, text, text, boolean, timestamptz, text)
  TO postgres, service_role;

REVOKE ALL ON FUNCTION public.finalize_billing_webhook_event_v1(text, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_billing_webhook_event_v1(text, text, text, text, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.finalize_billing_webhook_event_v1(text, text, text, text, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_billing_webhook_event_v1(text, text, text, text, boolean)
  TO postgres, service_role;
