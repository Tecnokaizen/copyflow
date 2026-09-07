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
    true
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

  return pg_catalog.jsonb_build_object(
    'tenant_id',
      v_tenant.id,
    'slug',
      v_tenant.slug,
    'name',
      v_tenant.name
  );
end;
$function$;

COMMENT ON FUNCTION public.create_organization(text, text, text) IS
  'DEFINER acotado: crea tenant + membership owner + tenant_settings + seed mínimo. Actor = auth.uid(). No aceptar user_id ni tenant_id del cliente.';

REVOKE ALL ON FUNCTION "public"."create_organization"(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."create_organization"(text, text, text) FROM "anon";

GRANT EXECUTE ON FUNCTION "public"."create_organization"(text, text, text)
  TO "authenticated", "postgres";
