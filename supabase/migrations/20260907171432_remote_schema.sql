SET local check_function_bodies = off;

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "service_role";

CREATE EXTENSION "pg_trgm" SCHEMA "public";

CREATE TABLE "public"."activity_log" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"       uuid                     NOT NULL,
  "user_id"         uuid,
  "team_member_id"  uuid,
  "action"          text                     NOT NULL,
  "entity_type"     text                     NOT NULL,
  "entity_id"       uuid,
  "previous_values" jsonb,
  "new_values"      jsonb,
  "metadata"        jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "activity_log_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."activity_log"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."clients" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        uuid                     NOT NULL,
  "customer_type_id" uuid,
  "name"             text                     NOT NULL,
  "contact_name"     text,
  "company_name"     text,
  "tax_id"           text,
  "email"            text,
  "phone"            text,
  "notes"            text,
  "active"           boolean                  NOT NULL DEFAULT true,
  "metadata"         jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_by"       uuid,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "clients_pkey" PRIMARY KEY (id),
  CONSTRAINT "clients_tenant_id_id_unique" UNIQUE (tenant_id, id)
);

ALTER TABLE "public"."clients"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."customer_types" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "customer_types_pkey" PRIMARY KEY (id),
  CONSTRAINT "customer_types_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "customer_types_unique_name" UNIQUE (tenant_id, name)
);

ALTER TABLE "public"."customer_types"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."delivery_methods" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "code"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "delivery_methods_pkey" PRIMARY KEY (id),
  CONSTRAINT "delivery_methods_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "delivery_methods_unique_code" UNIQUE (tenant_id, code)
);

ALTER TABLE "public"."delivery_methods"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."entry_channels" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "code"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "entry_channels_pkey" PRIMARY KEY (id),
  CONSTRAINT "entry_channels_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "entry_channels_unique_code" UNIQUE (tenant_id, code)
);

ALTER TABLE "public"."entry_channels"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."features" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"        text                     NOT NULL,
  "name"        text                     NOT NULL,
  "description" text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "features_code_unique" UNIQUE (code),
  CONSTRAINT "features_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."features"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."file_statuses" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "code"       text                     NOT NULL,
  "color"      text,
  "active"     boolean                  NOT NULL DEFAULT true,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "file_statuses_pkey" PRIMARY KEY (id),
  CONSTRAINT "file_statuses_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "file_statuses_unique_code" UNIQUE (tenant_id, code)
);

ALTER TABLE "public"."file_statuses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."memberships" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "role"       text                     NOT NULL DEFAULT 'staff'::text,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "memberships_pkey" PRIMARY KEY (id),
  CONSTRAINT "memberships_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'staff'::text, 'viewer'::text]))),
  CONSTRAINT "memberships_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "memberships_unique_user_tenant" UNIQUE (tenant_id, user_id)
);

ALTER TABLE "public"."memberships"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."order_contexts" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "code"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "order_contexts_pkey" PRIMARY KEY (id),
  CONSTRAINT "order_contexts_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "order_contexts_unique_code" UNIQUE (tenant_id, code)
);

ALTER TABLE "public"."order_contexts"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."order_number_counters" (
  "tenant_id"   uuid                     NOT NULL,
  "last_number" bigint                   NOT NULL DEFAULT 0,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "order_number_counters_last_number_check" CHECK ((last_number >= 0)),
  CONSTRAINT "order_number_counters_pkey" PRIMARY KEY (tenant_id)
);

ALTER TABLE "public"."order_number_counters"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."order_statuses" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"    uuid                     NOT NULL,
  "name"         text                     NOT NULL,
  "code"         text                     NOT NULL,
  "color"        text,
  "is_initial"   boolean                  NOT NULL DEFAULT false,
  "is_ready"     boolean                  NOT NULL DEFAULT false,
  "is_closed"    boolean                  NOT NULL DEFAULT false,
  "is_cancelled" boolean                  NOT NULL DEFAULT false,
  "active"       boolean                  NOT NULL DEFAULT true,
  "sort_order"   integer                  NOT NULL DEFAULT 0,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "order_statuses_pkey" PRIMARY KEY (id),
  CONSTRAINT "order_statuses_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "order_statuses_unique_code" UNIQUE (tenant_id, code)
);

ALTER TABLE "public"."order_statuses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."orders" (
  "id"                           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"                    uuid                     NOT NULL,
  "reference"                    text                     NOT NULL,
  "title"                        text                     NOT NULL,
  "description"                  text,
  "client_id"                    uuid,
  "service_id"                   uuid,
  "assigned_team_member_id"      uuid,
  "status_id"                    uuid                     NOT NULL,
  "entry_channel_id"             uuid,
  "order_context_id"             uuid,
  "file_status_id"               uuid,
  "quote_status_id"              uuid,
  "payment_status_id"            uuid,
  "delivery_method_id"           uuid,
  "priority"                     text                     NOT NULL DEFAULT 'normal'::text,
  "received_at"                  timestamp with time zone NOT NULL DEFAULT now(),
  "due_at"                       timestamp with time zone,
  "ready_at"                     timestamp with time zone,
  "delivered_at"                 timestamp with time zone,
  "customer_notification_status" text                     NOT NULL DEFAULT 'not_notified'::text,
  "customer_notified_at"         timestamp with time zone,
  "customer_notified_by"         uuid,
  "external_folder_url"          text,
  "notes"                        text,
  "requirements_override"        jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "metadata"                     jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_by"                   uuid,
  "created_at"                   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                   timestamp with time zone NOT NULL DEFAULT now(),
  "archived_at"                  timestamp with time zone,
  CONSTRAINT "orders_customer_notification_status_check" CHECK ((customer_notification_status = ANY (ARRAY['not_notified'::text, 'notified'::text, 'notified_no_pickup'::text]))),
  CONSTRAINT "orders_pkey" PRIMARY KEY (id),
  CONSTRAINT "orders_priority_check" CHECK ((priority = ANY (ARRAY['normal'::text, 'high'::text, 'urgent'::text]))),
  CONSTRAINT "orders_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "orders_unique_reference" UNIQUE (tenant_id, reference)
);

ALTER TABLE "public"."orders"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."payment_statuses" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "code"       text                     NOT NULL,
  "color"      text,
  "active"     boolean                  NOT NULL DEFAULT true,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payment_statuses_pkey" PRIMARY KEY (id),
  CONSTRAINT "payment_statuses_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "payment_statuses_unique_code" UNIQUE (tenant_id, code)
);

ALTER TABLE "public"."payment_statuses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."plan_features" (
  "plan_id"     uuid                     NOT NULL,
  "feature_id"  uuid                     NOT NULL,
  "enabled"     boolean                  NOT NULL DEFAULT true,
  "limit_value" bigint,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "plan_features_limit_value_check" CHECK (((limit_value IS NULL) OR (limit_value >= 0))),
  CONSTRAINT "plan_features_pkey" PRIMARY KEY (plan_id, feature_id)
);

ALTER TABLE "public"."plan_features"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."plans" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "code"          text                     NOT NULL,
  "name"          text                     NOT NULL,
  "description"   text,
  "price_monthly" numeric(12,2),
  "price_yearly"  numeric(12,2),
  "currency"      text                     NOT NULL DEFAULT 'EUR'::text,
  "active"        boolean                  NOT NULL DEFAULT true,
  "sort_order"    integer                  NOT NULL DEFAULT 0,
  "metadata"      jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "plans_code_unique" UNIQUE (code),
  CONSTRAINT "plans_pkey" PRIMARY KEY (id),
  CONSTRAINT "plans_price_monthly_check" CHECK (((price_monthly IS NULL) OR (price_monthly >= (0)::numeric))),
  CONSTRAINT "plans_price_yearly_check" CHECK (((price_yearly IS NULL) OR (price_yearly >= (0)::numeric)))
);

ALTER TABLE "public"."plans"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "full_name"  text,
  "phone"      text,
  "avatar_url" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."quote_statuses" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "code"       text                     NOT NULL,
  "color"      text,
  "active"     boolean                  NOT NULL DEFAULT true,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "quote_statuses_pkey" PRIMARY KEY (id),
  CONSTRAINT "quote_statuses_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "quote_statuses_unique_code" UNIQUE (tenant_id, code)
);

ALTER TABLE "public"."quote_statuses"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."service_categories" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "sort_order" integer                  NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "service_categories_pkey" PRIMARY KEY (id),
  CONSTRAINT "service_categories_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "service_categories_unique_name" UNIQUE (tenant_id, name)
);

ALTER TABLE "public"."service_categories"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."services" (
  "id"                         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"                  uuid                     NOT NULL,
  "category_id"                uuid,
  "name"                       text                     NOT NULL,
  "description"                text,
  "standard_lead_time_minutes" integer,
  "requires_file"              boolean                  NOT NULL DEFAULT false,
  "requires_design"            boolean                  NOT NULL DEFAULT false,
  "requires_quote"             boolean                  NOT NULL DEFAULT false,
  "active"                     boolean                  NOT NULL DEFAULT true,
  "sort_order"                 integer                  NOT NULL DEFAULT 0,
  "metadata"                   jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"                 timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "services_pkey" PRIMARY KEY (id),
  CONSTRAINT "services_standard_lead_time_check" CHECK (((standard_lead_time_minutes IS NULL) OR (standard_lead_time_minutes >= 0))),
  CONSTRAINT "services_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "services_unique_name" UNIQUE (tenant_id, name)
);

ALTER TABLE "public"."services"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."subscriptions" (
  "id"                       uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"                uuid                     NOT NULL,
  "plan_id"                  uuid                     NOT NULL,
  "provider"                 text,
  "provider_customer_id"     text,
  "provider_subscription_id" text,
  "status"                   text                     NOT NULL,
  "current_period_start"     timestamp with time zone,
  "current_period_end"       timestamp with time zone,
  "cancel_at_period_end"     boolean                  NOT NULL DEFAULT false,
  "metadata"                 jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"               timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"               timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "subscriptions_pkey" PRIMARY KEY (id),
  CONSTRAINT "subscriptions_status_check"
    CHECK ((status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text, 'canceled'::text, 'unpaid'::text, 'incomplete'::text, 'paused'::text])))
);

ALTER TABLE "public"."subscriptions"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."team_members" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"          uuid                     NOT NULL,
  "user_id"            uuid,
  "name"               text                     NOT NULL,
  "email"              text,
  "phone"              text,
  "job_title"          text,
  "department"         text,
  "active"             boolean                  NOT NULL DEFAULT true,
  "can_receive_orders" boolean                  NOT NULL DEFAULT true,
  "notes"              text,
  "metadata"           jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "team_members_pkey" PRIMARY KEY (id),
  CONSTRAINT "team_members_tenant_id_id_unique" UNIQUE (tenant_id, id),
  CONSTRAINT "team_members_unique_user_tenant" UNIQUE (tenant_id, user_id)
);

ALTER TABLE "public"."team_members"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tenant_domains" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   uuid                     NOT NULL,
  "hostname"    text                     NOT NULL,
  "domain_type" text                     NOT NULL DEFAULT 'subdomain'::text,
  "is_primary"  boolean                  NOT NULL DEFAULT false,
  "verified"    boolean                  NOT NULL DEFAULT false,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_domains_hostname_unique" UNIQUE (hostname),
  CONSTRAINT "tenant_domains_pkey" PRIMARY KEY (id),
  CONSTRAINT "tenant_domains_type_check" CHECK ((domain_type = ANY (ARRAY['subdomain'::text, 'custom'::text])))
);

ALTER TABLE "public"."tenant_domains"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tenant_settings" (
  "tenant_id"     uuid                     NOT NULL,
  "business_name" text,
  "logo_url"      text,
  "timezone"      text                     NOT NULL DEFAULT 'Europe/Madrid'::text,
  "locale"        text                     NOT NULL DEFAULT 'es-ES'::text,
  "currency"      text                     NOT NULL DEFAULT 'EUR'::text,
  "branding"      jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "preferences"   jsonb                    NOT NULL DEFAULT '{}'::jsonb,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tenant_settings_pkey" PRIMARY KEY (tenant_id)
);

ALTER TABLE "public"."tenant_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."tenants" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "slug"       text                     NOT NULL,
  "active"     boolean                  NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "tenants_pkey" PRIMARY KEY (id),
  CONSTRAINT "tenants_slug_format" CHECK ((slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'::text)),
  CONSTRAINT "tenants_slug_unique" UNIQUE (slug)
);

ALTER TABLE "public"."tenants"
  ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.assign_order_client (
  p_order_id  uuid,
  p_client_id uuid,
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();

  v_order public.orders%rowtype;
  v_client_json jsonb := null;

begin

  -- ----------------------------------------------------------
  -- Autenticación
  -- ----------------------------------------------------------

  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ----------------------------------------------------------
  -- Argumentos obligatorios
  -- ----------------------------------------------------------

  if p_order_id is null
     or p_tenant_id is null then
    raise exception 'p_order_id and p_tenant_id are required'
      using errcode = '22023';
  end if;


  -- ----------------------------------------------------------
  -- Rol operativo dentro del tenant
  -- ----------------------------------------------------------

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ----------------------------------------------------------
  -- Pedido tenant-aware + bloqueo
  -- ----------------------------------------------------------

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;


  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;


  -- ----------------------------------------------------------
  -- Cliente tenant-aware
  --
  -- NULL está permitido.
  -- Si hay cliente, debe existir, pertenecer al tenant
  -- y estar activo.
  -- ----------------------------------------------------------

  if p_client_id is not null then

    select pg_catalog.jsonb_build_object(
      'id', c.id,
      'customer_type_id', c.customer_type_id,
      'customer_type_name', ct.name,
      'name', c.name,
      'contact_name', c.contact_name,
      'company_name', c.company_name,
      'tax_id', c.tax_id,
      'email', c.email,
      'phone', c.phone,
      'notes', c.notes
    )
    into v_client_json

    from public.clients c

    left join public.customer_types ct
      on ct.id = c.customer_type_id
     and ct.tenant_id = c.tenant_id

    where c.id = p_client_id
      and c.tenant_id = p_tenant_id
      and c.active = true;


    if not found then
      raise exception 'client not found'
        using errcode = 'P0002';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- Idempotencia
  --
  -- Si ya tiene ese mismo cliente, no hacemos UPDATE.
  -- Evita escrituras/auditoría innecesarias.
  -- ----------------------------------------------------------

  if v_order.client_id is not distinct from p_client_id then

    return pg_catalog.jsonb_build_object(

      'order',

      pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'client_id', v_order.client_id
      ),

      'client',
      v_client_json

    );

  end if;


  -- ----------------------------------------------------------
  -- Asignar / cambiar / quitar
  -- ----------------------------------------------------------

  update public.orders
  set client_id = p_client_id

  where id = p_order_id
    and tenant_id = p_tenant_id

  returning *
  into v_order;


  if not found then
    raise exception 'could not update order client'
      using errcode = 'P0001';
  end if;


  -- ----------------------------------------------------------
  -- Respuesta
  -- ----------------------------------------------------------

  return pg_catalog.jsonb_build_object(

    'order',

    pg_catalog.jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'client_id', v_order.client_id
    ),

    'client',
    v_client_json

  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.change_order_content (
  p_order_id  uuid,
  p_field     text,
  p_value     text,
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_normalized_value text;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_field is null
     or p_tenant_id is null then
    raise exception 'p_order_id, p_field and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if p_field not in (
    'title',
    'description',
    'notes'
  ) then
    raise exception 'invalid order content field'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;


  -- =======================================================
  -- TÍTULO
  -- Obligatorio y no vacío.
  -- =======================================================

  if p_field = 'title' then

    if p_value is null
       or pg_catalog.btrim(p_value) = '' then
      raise exception 'title cannot be empty'
        using errcode = '22023';
    end if;

    v_normalized_value := pg_catalog.btrim(p_value);

    if v_order.title is not distinct from v_normalized_value then
      return pg_catalog.jsonb_build_object(
        'order',
        pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'title', v_order.title,
          'description', v_order.description,
          'notes', v_order.notes
        ),
        'field', p_field,
        'value', v_order.title
      );
    end if;

    update public.orders
    set title = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- DESCRIPCIÓN
  -- Vacío => NULL
  -- =======================================================

  elsif p_field = 'description' then

    if p_value is null
       or pg_catalog.btrim(p_value) = '' then
      v_normalized_value := null;
    else
      v_normalized_value := pg_catalog.btrim(p_value);
    end if;

    if v_order.description is not distinct from v_normalized_value then
      return pg_catalog.jsonb_build_object(
        'order',
        pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'title', v_order.title,
          'description', v_order.description,
          'notes', v_order.notes
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_order.description)
      );
    end if;

    update public.orders
    set description = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- NOTAS
  -- Vacío => NULL
  -- =======================================================

  elsif p_field = 'notes' then

    if p_value is null
       or pg_catalog.btrim(p_value) = '' then
      v_normalized_value := null;
    else
      v_normalized_value := pg_catalog.btrim(p_value);
    end if;

    if v_order.notes is not distinct from v_normalized_value then
      return pg_catalog.jsonb_build_object(
        'order',
        pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'title', v_order.title,
          'description', v_order.description,
          'notes', v_order.notes
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_order.notes)
      );
    end if;

    update public.orders
    set notes = v_normalized_value
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;

  end if;


  if not found then
    raise exception 'could not update order content'
      using errcode = 'P0001';
  end if;


  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'title', v_updated.title,
      'description', v_updated.description,
      'notes', v_updated.notes
    ),
    'field', p_field,
    'value',
      case p_field
        when 'title'
          then pg_catalog.to_jsonb(v_updated.title)
        when 'description'
          then pg_catalog.to_jsonb(v_updated.description)
        when 'notes'
          then pg_catalog.to_jsonb(v_updated.notes)
        else 'null'::jsonb
      end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.change_order_details (
  p_order_id  uuid,
  p_field     text,
  p_value     text,
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;

  v_value_uuid uuid;
  v_due_at timestamptz;
  v_priority text;

  v_value_code text;
  v_value_name text;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_field is null
     or p_tenant_id is null then
    raise exception 'p_order_id, p_field and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if p_field not in (
    'priority',
    'service_id',
    'entry_channel_id',
    'assigned_team_member_id',
    'order_context_id',
    'due_at'
  ) then
    raise exception 'invalid order detail field'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;


  -- =======================================================
  -- PRIORIDAD
  -- =======================================================

  if p_field = 'priority' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      raise exception 'priority cannot be null'
        using errcode = '22023';
    end if;

    v_priority := pg_catalog.lower(pg_catalog.btrim(p_value));

    if v_priority not in ('normal', 'high', 'urgent') then
      raise exception 'invalid priority'
        using errcode = '22023';
    end if;

    if v_order.priority is not distinct from v_priority then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value', v_priority
      );
    end if;

    update public.orders
    set priority = v_priority
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- SERVICIO
  -- =======================================================

  elsif p_field = 'service_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid service_id'
            using errcode = '22023';
      end;

      select null::text, name
      into v_value_code, v_value_name
      from public.services
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid service for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.service_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'name', v_value_name
            )
          end
      );
    end if;

    update public.orders
    set service_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- CANAL DE ENTRADA
  -- =======================================================

  elsif p_field = 'entry_channel_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid entry_channel_id'
            using errcode = '22023';
      end;

      select code, name
      into v_value_code, v_value_name
      from public.entry_channels
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid entry channel for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.entry_channel_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'code', v_value_code,
              'name', v_value_name
            )
          end
      );
    end if;

    update public.orders
    set entry_channel_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- RESPONSABLE
  -- =======================================================

  elsif p_field = 'assigned_team_member_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid assigned_team_member_id'
            using errcode = '22023';
      end;

      select null::text, name
      into v_value_code, v_value_name
      from public.team_members
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid team member for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.assigned_team_member_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'name', v_value_name
            )
          end
      );
    end if;

    update public.orders
    set assigned_team_member_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- CONTEXTO
  -- =======================================================

  elsif p_field = 'order_context_id' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_value_uuid := null;
      v_value_code := null;
      v_value_name := null;
    else
      begin
        v_value_uuid := pg_catalog.btrim(p_value)::uuid;
      exception
        when invalid_text_representation then
          raise exception 'invalid order_context_id'
            using errcode = '22023';
      end;

      select code, name
      into v_value_code, v_value_name
      from public.order_contexts
      where id = v_value_uuid
        and tenant_id = p_tenant_id
        and active = true;

      if not found then
        raise exception 'invalid order context for current tenant'
          using errcode = '22023';
      end if;
    end if;

    if v_order.order_context_id is not distinct from v_value_uuid then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value',
          case
            when v_value_uuid is null then 'null'::jsonb
            else pg_catalog.jsonb_build_object(
              'id', v_value_uuid,
              'code', v_value_code,
              'name', v_value_name
            )
          end
      );
    end if;

    update public.orders
    set order_context_id = v_value_uuid
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;


  -- =======================================================
  -- FECHA PREVISTA
  -- =======================================================

  elsif p_field = 'due_at' then

    if p_value is null or pg_catalog.btrim(p_value) = '' then
      v_due_at := null;
    else
      begin
        v_due_at := pg_catalog.btrim(p_value)::timestamptz;
      exception
        when invalid_datetime_format
          or datetime_field_overflow then
          raise exception 'invalid due_at'
            using errcode = '22023';
      end;
    end if;

    if v_order.due_at is not distinct from v_due_at then
      return pg_catalog.jsonb_build_object(
        'order', pg_catalog.jsonb_build_object(
          'id', v_order.id,
          'reference', v_order.reference,
          'priority', v_order.priority,
          'service_id', v_order.service_id,
          'entry_channel_id', v_order.entry_channel_id,
          'assigned_team_member_id', v_order.assigned_team_member_id,
          'order_context_id', v_order.order_context_id,
          'due_at', v_order.due_at
        ),
        'field', p_field,
        'value', pg_catalog.to_jsonb(v_due_at)
      );
    end if;

    update public.orders
    set due_at = v_due_at
    where id = v_order.id
      and tenant_id = p_tenant_id
    returning * into v_updated;

  end if;


  if not found then
    raise exception 'could not update order details'
      using errcode = 'P0001';
  end if;


  -- =======================================================
  -- RESPUESTA
  -- =======================================================

  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'priority', v_updated.priority,
      'service_id', v_updated.service_id,
      'entry_channel_id', v_updated.entry_channel_id,
      'assigned_team_member_id', v_updated.assigned_team_member_id,
      'order_context_id', v_updated.order_context_id,
      'due_at', v_updated.due_at
    ),
    'field', p_field,
    'value',
      case
        when p_field = 'priority'
          then pg_catalog.to_jsonb(v_updated.priority)

        when p_field = 'due_at'
          then pg_catalog.to_jsonb(v_updated.due_at)

        when v_value_uuid is null
          then 'null'::jsonb

        else pg_catalog.jsonb_build_object(
          'id', v_value_uuid,
          'code', v_value_code,
          'name', v_value_name
        )
      end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.change_order_management (
  p_order_id  uuid,
  p_field     text,
  p_value_id  uuid,
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
  v_value_code text;
  v_value_name text;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_field is null
     or p_tenant_id is null then
    raise exception 'p_order_id, p_field and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if p_field not in (
    'file_status_id',
    'quote_status_id',
    'payment_status_id',
    'delivery_method_id'
  ) then
    raise exception 'invalid management field'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  -- -------------------------------------------------------
  -- Validar que la opción pertenece al catálogo correcto,
  -- al mismo tenant y está activa.
  -- NULL está permitido para limpiar el campo.
  -- -------------------------------------------------------

  if p_value_id is not null then

    case p_field

      when 'file_status_id' then
        select code, name
        into v_value_code, v_value_name
        from public.file_statuses
        where id = p_value_id
          and tenant_id = p_tenant_id
          and active = true;

      when 'quote_status_id' then
        select code, name
        into v_value_code, v_value_name
        from public.quote_statuses
        where id = p_value_id
          and tenant_id = p_tenant_id
          and active = true;

      when 'payment_status_id' then
        select code, name
        into v_value_code, v_value_name
        from public.payment_statuses
        where id = p_value_id
          and tenant_id = p_tenant_id
          and active = true;

      when 'delivery_method_id' then
        select code, name
        into v_value_code, v_value_name
        from public.delivery_methods
        where id = p_value_id
          and tenant_id = p_tenant_id
          and active = true;

    end case;

    if not found then
      raise exception 'invalid management option for current tenant'
        using errcode = '22023';
    end if;

  end if;

  -- -------------------------------------------------------
  -- Idempotencia: mismo valor = no UPDATE, no activity_log
  -- -------------------------------------------------------

  if
    (p_field = 'file_status_id'
      and v_order.file_status_id is not distinct from p_value_id)
    or
    (p_field = 'quote_status_id'
      and v_order.quote_status_id is not distinct from p_value_id)
    or
    (p_field = 'payment_status_id'
      and v_order.payment_status_id is not distinct from p_value_id)
    or
    (p_field = 'delivery_method_id'
      and v_order.delivery_method_id is not distinct from p_value_id)
  then
    return pg_catalog.jsonb_build_object(
      'order',
      pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'file_status_id', v_order.file_status_id,
        'quote_status_id', v_order.quote_status_id,
        'payment_status_id', v_order.payment_status_id,
        'delivery_method_id', v_order.delivery_method_id
      ),
      'field', p_field,
      'value',
        case
          when p_value_id is null then 'null'::jsonb
          else pg_catalog.jsonb_build_object(
            'id', p_value_id,
            'code', v_value_code,
            'name', v_value_name
          )
        end
    );
  end if;

  -- -------------------------------------------------------
  -- Actualizar únicamente el campo solicitado.
  -- Sin SQL dinámico.
  -- -------------------------------------------------------

  update public.orders
  set
    file_status_id = case
      when p_field = 'file_status_id'
        then p_value_id
      else file_status_id
    end,

    quote_status_id = case
      when p_field = 'quote_status_id'
        then p_value_id
      else quote_status_id
    end,

    payment_status_id = case
      when p_field = 'payment_status_id'
        then p_value_id
      else payment_status_id
    end,

    delivery_method_id = case
      when p_field = 'delivery_method_id'
        then p_value_id
      else delivery_method_id
    end

  where id = v_order.id
    and tenant_id = p_tenant_id
  returning * into v_updated;

  if not found then
    raise exception 'could not update order management'
      using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'file_status_id', v_updated.file_status_id,
      'quote_status_id', v_updated.quote_status_id,
      'payment_status_id', v_updated.payment_status_id,
      'delivery_method_id', v_updated.delivery_method_id
    ),
    'field', p_field,
    'value',
      case
        when p_value_id is null then 'null'::jsonb
        else pg_catalog.jsonb_build_object(
          'id', p_value_id,
          'code', v_value_code,
          'name', v_value_name
        )
      end
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.change_order_notification_status (
  p_order_id            uuid,
  p_notification_status text,
  p_tenant_id           uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_order public.orders%rowtype;
  v_updated public.orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null
     or p_notification_status is null
     or p_tenant_id is null then
    raise exception
      'p_order_id, p_notification_status and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if p_notification_status not in (
    'not_notified',
    'notified',
    'notified_no_pickup'
  ) then
    raise exception 'invalid customer notification status'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  -- Mismo valor: operación idempotente, sin UPDATE ni activity_log.
  if v_order.customer_notification_status
       is not distinct from p_notification_status then
    return pg_catalog.jsonb_build_object(
      'order',
      pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'customer_notification_status',
          v_order.customer_notification_status,
        'customer_notified_at',
          v_order.customer_notified_at,
        'customer_notified_by',
          v_order.customer_notified_by
      )
    );
  end if;

  update public.orders
  set
    customer_notification_status = p_notification_status,

    customer_notified_at = case
      when p_notification_status = 'not_notified'
        then null

      -- Primera notificación real.
      when v_order.customer_notified_at is null
        then v_now

      -- Si ya estaba avisado, conservamos cuándo se avisó.
      else v_order.customer_notified_at
    end,

    customer_notified_by = case
      when p_notification_status = 'not_notified'
        then null

      -- Primera notificación real.
      when v_order.customer_notified_by is null
        then v_user_id

      -- Pasar Avisado -> Avisado pero no viene no cambia
      -- quién realizó originalmente el aviso.
      else v_order.customer_notified_by
    end

  where id = v_order.id
    and tenant_id = p_tenant_id
  returning * into v_updated;

  if not found then
    raise exception 'could not update order'
      using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'order',
    pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'customer_notification_status',
        v_updated.customer_notification_status,
      'customer_notified_at',
        v_updated.customer_notified_at,
      'customer_notified_by',
        v_updated.customer_notified_by
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.change_order_status (
  p_order_id  uuid,
  p_status_id uuid,
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_order public.orders%rowtype;
  v_new_status public.order_statuses%rowtype;
  v_updated public.orders%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_order_id is null or p_status_id is null or p_tenant_id is null then
    raise exception 'p_order_id, p_status_id and p_tenant_id are required'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;

  select *
  into v_new_status
  from public.order_statuses
  where id = p_status_id
    and tenant_id = p_tenant_id
    and active = true;

  if not found then
    raise exception 'invalid order status'
      using errcode = '22023';
  end if;

  if v_order.status_id is not distinct from v_new_status.id then
    return pg_catalog.jsonb_build_object(
      'order', pg_catalog.jsonb_build_object(
        'id', v_order.id,
        'reference', v_order.reference,
        'status_id', v_order.status_id,
        'ready_at', v_order.ready_at,
        'delivered_at', v_order.delivered_at
      ),
      'status', pg_catalog.jsonb_build_object(
        'id', v_new_status.id,
        'tenant_id', v_new_status.tenant_id,
        'code', v_new_status.code,
        'name', v_new_status.name,
        'is_ready', v_new_status.is_ready,
        'is_closed', v_new_status.is_closed,
        'is_cancelled', v_new_status.is_cancelled
      )
    );
  end if;

  update public.orders
  set
    status_id = v_new_status.id,
    updated_at = v_now,
    ready_at = case
      when v_new_status.is_ready is true and ready_at is null then v_now
      else ready_at
    end,
    delivered_at = case
      when v_new_status.is_closed is true
        and v_new_status.is_cancelled is not true
        and delivered_at is null then v_now
      else delivered_at
    end
  where id = v_order.id
    and tenant_id = p_tenant_id
  returning * into v_updated;

  if not found then
    raise exception 'could not update order'
      using errcode = 'P0001';
  end if;

  return pg_catalog.jsonb_build_object(
    'order', pg_catalog.jsonb_build_object(
      'id', v_updated.id,
      'reference', v_updated.reference,
      'status_id', v_updated.status_id,
      'ready_at', v_updated.ready_at,
      'delivered_at', v_updated.delivered_at
    ),
    'status', pg_catalog.jsonb_build_object(
      'id', v_new_status.id,
      'tenant_id', v_new_status.tenant_id,
      'code', v_new_status.code,
      'name', v_new_status.name,
      'is_ready', v_new_status.is_ready,
      'is_closed', v_new_status.is_closed,
      'is_cancelled', v_new_status.is_cancelled
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.check_client_duplicates (
  p_tenant_id         uuid,
  p_email             text DEFAULT NULL::text,
  p_phone             text DEFAULT NULL::text,
  p_tax_id            text DEFAULT NULL::text,
  p_exclude_client_id uuid DEFAULT NULL::uuid
)
  RETURNS TABLE (
    client_id    uuid,
    client_name  text,
    contact_name text,
    company_name text,
    email        text,
    phone        text,
    tax_id       text,
    email_match  boolean,
    phone_match  boolean,
    tax_id_match boolean
  )
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  v_email text;
  v_phone text;
  v_tax_id text;
begin

  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;


  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
  ) then
    raise exception 'Tenant access denied'
      using errcode = '42501';
  end if;


  v_email := public.normalize_client_email(p_email);
  v_phone := public.normalize_client_phone(p_phone);
  v_tax_id := public.normalize_client_tax_id(p_tax_id);


  if v_email is null
     and v_phone is null
     and v_tax_id is null then
    return;
  end if;


  return query
  select
    c.id,
    c.name,
    c.contact_name,
    c.company_name,
    c.email,
    c.phone,
    c.tax_id,

    (
      v_email is not null
      and public.normalize_client_email(c.email) = v_email
    ),

    (
      v_phone is not null
      and public.normalize_client_phone(c.phone) = v_phone
    ),

    (
      v_tax_id is not null
      and public.normalize_client_tax_id(c.tax_id) = v_tax_id
    )

  from public.clients c

  where
    c.tenant_id = p_tenant_id

    and (
      p_exclude_client_id is null
      or c.id <> p_exclude_client_id
    )

    and (
      (
        v_email is not null
        and public.normalize_client_email(c.email) = v_email
      )

      or (
        v_phone is not null
        and public.normalize_client_phone(c.phone) = v_phone
      )

      or (
        v_tax_id is not null
        and public.normalize_client_tax_id(c.tax_id) = v_tax_id
      )
    )

  order by c.name;

end;
$function$;

CREATE OR REPLACE FUNCTION public.create_client (
  p_customer_type_id uuid,
  p_name             text,
  p_contact_name     text,
  p_company_name     text,
  p_tax_id           text,
  p_email            text,
  p_phone            text,
  p_notes            text,
  p_tenant_id        uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_client public.clients%rowtype;
  v_duplicate public.clients%rowtype;

  v_name text;
  v_contact_name text;
  v_company_name text;
  v_tax_id text;
  v_email text;
  v_phone text;
  v_notes text;

  v_email_normalized text;
  v_phone_normalized text;
  v_tax_id_normalized text;

  v_email_match boolean;
  v_phone_match boolean;
  v_tax_id_match boolean;
begin

  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null then
    raise exception 'p_tenant_id is required'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  v_name := nullif(pg_catalog.btrim(p_name), '');

  if v_name is null then
    raise exception 'client name cannot be empty'
      using errcode = '22023';
  end if;

  v_contact_name := nullif(pg_catalog.btrim(p_contact_name), '');
  v_company_name := nullif(pg_catalog.btrim(p_company_name), '');
  v_tax_id := nullif(pg_catalog.btrim(p_tax_id), '');
  v_email := nullif(pg_catalog.btrim(p_email), '');
  v_phone := nullif(pg_catalog.btrim(p_phone), '');
  v_notes := nullif(pg_catalog.btrim(p_notes), '');

  v_email_normalized :=
    public.normalize_client_email(v_email);

  v_phone_normalized :=
    public.normalize_client_phone(v_phone);

  v_tax_id_normalized :=
    public.normalize_client_tax_id(v_tax_id);


  -- Tipo de cliente dentro del tenant
  if p_customer_type_id is not null then

    perform 1
    from public.customer_types
    where id = p_customer_type_id
      and tenant_id = p_tenant_id
      and active = true;

    if not found then
      raise exception 'invalid customer type for current tenant'
        using errcode = '22023';
    end if;

  end if;


  -- Duplicados fuertes
  select *
  into v_duplicate
  from public.clients c
  where c.tenant_id = p_tenant_id
    and (
      (
        v_email_normalized is not null
        and public.normalize_client_email(c.email)
          = v_email_normalized
      )
      or
      (
        v_phone_normalized is not null
        and public.normalize_client_phone(c.phone)
          = v_phone_normalized
      )
      or
      (
        v_tax_id_normalized is not null
        and public.normalize_client_tax_id(c.tax_id)
          = v_tax_id_normalized
      )
    )
  order by c.created_at
  limit 1;


  if found then

    v_email_match :=
      v_email_normalized is not null
      and public.normalize_client_email(v_duplicate.email)
        = v_email_normalized;

    v_phone_match :=
      v_phone_normalized is not null
      and public.normalize_client_phone(v_duplicate.phone)
        = v_phone_normalized;

    v_tax_id_match :=
      v_tax_id_normalized is not null
      and public.normalize_client_tax_id(v_duplicate.tax_id)
        = v_tax_id_normalized;

    raise exception 'client_duplicate'
      using
        errcode = '23505',

        detail = pg_catalog.jsonb_build_object(
          'client_id', v_duplicate.id,
          'client_name', v_duplicate.name,
          'email', v_duplicate.email,
          'phone', v_duplicate.phone,
          'tax_id', v_duplicate.tax_id,
          'email_match', v_email_match,
          'phone_match', v_phone_match,
          'tax_id_match', v_tax_id_match
        )::text,

        hint = 'Use the existing client instead of creating a duplicate';

  end if;


  -- Alta
  begin

    insert into public.clients (
      tenant_id,
      customer_type_id,
      name,
      contact_name,
      company_name,
      tax_id,
      email,
      phone,
      notes,
      active,
      created_by
    )
    values (
      p_tenant_id,
      p_customer_type_id,
      v_name,
      v_contact_name,
      v_company_name,
      v_tax_id,
      v_email,
      v_phone,
      v_notes,
      true,
      v_user_id
    )
    returning *
    into v_client;

  exception
    when unique_violation then

      raise exception 'client_duplicate'
        using
          errcode = '23505',
          hint =
            'A client with the same email, phone or tax ID already exists';

  end;


  return pg_catalog.jsonb_build_object(
    'client',
    pg_catalog.to_jsonb(v_client)
      - 'metadata'
      - 'created_by'
  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.create_client_and_assign_order (
  p_order_id         uuid,
  p_customer_type_id uuid,
  p_name             text,
  p_contact_name     text,
  p_company_name     text,
  p_tax_id           text,
  p_email            text,
  p_phone            text,
  p_notes            text,
  p_tenant_id        uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();

  v_order public.orders%rowtype;
  v_client public.clients%rowtype;
  v_duplicate public.clients%rowtype;

  v_name text;
  v_contact_name text;
  v_company_name text;
  v_tax_id text;
  v_email text;
  v_phone text;
  v_notes text;

  v_email_normalized text;
  v_phone_normalized text;
  v_tax_id_normalized text;

  v_email_match boolean;
  v_phone_match boolean;
  v_tax_id_match boolean;

begin

  -- ----------------------------------------------------------
  -- Autenticación
  -- ----------------------------------------------------------

  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ----------------------------------------------------------
  -- Parámetros obligatorios
  -- ----------------------------------------------------------

  if p_order_id is null
     or p_tenant_id is null then
    raise exception 'p_order_id and p_tenant_id are required'
      using errcode = '22023';
  end if;


  -- ----------------------------------------------------------
  -- Rol operativo dentro del tenant
  -- ----------------------------------------------------------

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ----------------------------------------------------------
  -- Normalización básica de entrada
  -- ----------------------------------------------------------

  v_name := nullif(pg_catalog.btrim(p_name), '');

  if v_name is null then
    raise exception 'client name cannot be empty'
      using errcode = '22023';
  end if;


  v_contact_name := nullif(pg_catalog.btrim(p_contact_name), '');
  v_company_name := nullif(pg_catalog.btrim(p_company_name), '');
  v_tax_id := nullif(pg_catalog.btrim(p_tax_id), '');
  v_email := nullif(pg_catalog.btrim(p_email), '');
  v_phone := nullif(pg_catalog.btrim(p_phone), '');
  v_notes := nullif(pg_catalog.btrim(p_notes), '');


  -- ----------------------------------------------------------
  -- Valores fuertes normalizados
  -- ----------------------------------------------------------

  v_email_normalized :=
    public.normalize_client_email(v_email);

  v_phone_normalized :=
    public.normalize_client_phone(v_phone);

  v_tax_id_normalized :=
    public.normalize_client_tax_id(v_tax_id);


  -- ----------------------------------------------------------
  -- Customer type tenant-aware
  -- ----------------------------------------------------------

  if p_customer_type_id is not null then

    perform 1
    from public.customer_types
    where id = p_customer_type_id
      and tenant_id = p_tenant_id
      and active = true;

    if not found then
      raise exception 'invalid customer type for current tenant'
        using errcode = '22023';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- Pedido:
  -- bloquearlo antes de crear/asignar cliente.
  -- ----------------------------------------------------------

  select *
  into v_order
  from public.orders
  where id = p_order_id
    and tenant_id = p_tenant_id
  for update;


  if not found then
    raise exception 'order not found'
      using errcode = 'P0002';
  end if;


  -- ----------------------------------------------------------
  -- DUPLICADOS FUERTES
  --
  -- Email
  -- Teléfono
  -- NIF/CIF
  --
  -- Solo dentro del tenant.
  -- ----------------------------------------------------------

  select *
  into v_duplicate
  from public.clients c
  where c.tenant_id = p_tenant_id

    and (

      (
        v_email_normalized is not null
        and public.normalize_client_email(c.email)
          = v_email_normalized
      )

      or

      (
        v_phone_normalized is not null
        and public.normalize_client_phone(c.phone)
          = v_phone_normalized
      )

      or

      (
        v_tax_id_normalized is not null
        and public.normalize_client_tax_id(c.tax_id)
          = v_tax_id_normalized
      )

    )

  order by c.created_at
  limit 1;


  if found then

    v_email_match :=
      v_email_normalized is not null
      and public.normalize_client_email(v_duplicate.email)
        = v_email_normalized;

    v_phone_match :=
      v_phone_normalized is not null
      and public.normalize_client_phone(v_duplicate.phone)
        = v_phone_normalized;

    v_tax_id_match :=
      v_tax_id_normalized is not null
      and public.normalize_client_tax_id(v_duplicate.tax_id)
        = v_tax_id_normalized;


    raise exception 'client_duplicate'
      using
        errcode = '23505',

        detail = pg_catalog.jsonb_build_object(
          'client_id', v_duplicate.id,
          'client_name', v_duplicate.name,
          'email', v_duplicate.email,
          'phone', v_duplicate.phone,
          'tax_id', v_duplicate.tax_id,
          'email_match', v_email_match,
          'phone_match', v_phone_match,
          'tax_id_match', v_tax_id_match
        )::text,

        hint = 'Use the existing client instead of creating a duplicate';

  end if;


  -- ----------------------------------------------------------
  -- Crear cliente
  -- ----------------------------------------------------------

  begin

    insert into public.clients (
      tenant_id,
      customer_type_id,
      name,
      contact_name,
      company_name,
      tax_id,
      email,
      phone,
      notes,
      active,
      created_by
    )
    values (
      p_tenant_id,
      p_customer_type_id,
      v_name,
      v_contact_name,
      v_company_name,
      v_tax_id,
      v_email,
      v_phone,
      v_notes,
      true,
      v_user_id
    )
    returning *
    into v_client;


  exception
    when unique_violation then

      -- Protección adicional frente a condición de carrera.
      raise exception 'client_duplicate'
        using
          errcode = '23505',
          hint =
            'A client with the same email, phone or tax ID already exists';

  end;


  -- ----------------------------------------------------------
  -- Asignarlo al pedido
  -- ----------------------------------------------------------

  update public.orders
  set client_id = v_client.id
  where id = v_order.id
    and tenant_id = p_tenant_id;


  if not found then
    raise exception 'could not assign client to order'
      using errcode = 'P0001';
  end if;


  -- ----------------------------------------------------------
  -- Respuesta existente:
  -- NO cambiamos contrato con Next.
  -- ----------------------------------------------------------

  return pg_catalog.jsonb_build_object(

    'order',

    pg_catalog.jsonb_build_object(
      'id', v_order.id,
      'reference', v_order.reference,
      'client_id', v_client.id
    ),

    'client',

    pg_catalog.to_jsonb(v_client)
      - 'metadata'
      - 'created_by'

  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.create_service (
  p_category_id                uuid,
  p_name                       text,
  p_description                text,
  p_standard_lead_time_minutes integer,
  p_requires_file              boolean,
  p_requires_design            boolean,
  p_requires_quote             boolean,
  p_active                     boolean,
  p_sort_order                 integer,
  p_tenant_id                  uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_service public.services%rowtype;

  v_name text;
  v_description text;
  v_lead_time integer;
  v_sort_order integer;
begin

  -- AUTH
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- PERMISOS
  if not public.has_tenant_role(
    p_tenant_id,
    array['owner','admin','manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- NOMBRE
  v_name :=
    nullif(
      pg_catalog.btrim(p_name),
      ''
    );

  if v_name is null then
    raise exception 'service name cannot be empty'
      using errcode = '22023';
  end if;


  -- DESCRIPCIÓN
  v_description :=
    nullif(
      pg_catalog.btrim(p_description),
      ''
    );


  -- PLAZO
  if p_standard_lead_time_minutes is not null
     and p_standard_lead_time_minutes < 0 then
    raise exception 'standard lead time cannot be negative'
      using errcode = '22023';
  end if;

  v_lead_time := p_standard_lead_time_minutes;


  -- CATEGORÍA
  -- null permitido.
  -- Si existe, debe pertenecer al mismo tenant.
  if p_category_id is not null then

    perform 1
    from public.service_categories sc
    where sc.id = p_category_id
      and sc.tenant_id = p_tenant_id;

    if not found then
      raise exception 'invalid service category for current tenant'
        using errcode = '22023';
    end if;

  end if;


  -- ORDEN
  v_sort_order :=
    greatest(
      coalesce(p_sort_order, 0),
      0
    );


  -- INSERT
  insert into public.services(
    tenant_id,
    category_id,
    name,
    description,
    standard_lead_time_minutes,
    requires_file,
    requires_design,
    requires_quote,
    active,
    sort_order
  )
  values(
    p_tenant_id,
    p_category_id,
    v_name,
    v_description,
    v_lead_time,
    coalesce(p_requires_file, false),
    coalesce(p_requires_design, false),
    coalesce(p_requires_quote, false),
    coalesce(p_active, true),
    v_sort_order
  )
  returning *
  into v_service;


  return pg_catalog.jsonb_build_object(
    'service',
    pg_catalog.to_jsonb(v_service) - 'metadata'
  );

end;
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
  select exists (
    select 1
    from public.memberships m
    where m.tenant_id = target_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
      and m.role = any(allowed_roles)
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_tenant_member (
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

CREATE OR REPLACE FUNCTION public.list_activity_log (
  p_tenant_id   uuid,
  p_entity_type text                     DEFAULT NULL::text,
  p_action      text                     DEFAULT NULL::text,
  p_user_id     uuid                     DEFAULT NULL::uuid,
  p_from        timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_to          timestamp with time zone DEFAULT NULL::timestamp WITH time zone,
  p_page        integer                  DEFAULT 1,
  p_page_size   integer                  DEFAULT 25
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_page integer;
  v_page_size integer;
  v_offset integer;

  v_entity_type text;
  v_action text;

  v_result jsonb;
begin

  -- ==========================================================
  -- AUTH
  -- ==========================================================

  if auth.uid() is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- PERMISOS
  --
  -- Registro de actividad = supervisión.
  -- owner / admin / manager.
  -- ==========================================================

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner','admin','manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ==========================================================
  -- PAGINACIÓN
  -- ==========================================================

  v_page :=
    greatest(
      coalesce(p_page, 1),
      1
    );

  v_page_size :=
    least(
      greatest(
        coalesce(p_page_size, 25),
        1
      ),
      100
    );

  v_offset :=
    (v_page - 1) * v_page_size;


  -- ==========================================================
  -- FILTROS
  -- ==========================================================

  v_entity_type :=
    nullif(
      pg_catalog.btrim(p_entity_type),
      ''
    );

  v_action :=
    nullif(
      pg_catalog.btrim(p_action),
      ''
    );


  if p_from is not null
     and p_to is not null
     and p_from > p_to then
    raise exception 'invalid date range'
      using errcode = '22023';
  end if;


  -- ==========================================================
  -- CONSULTA
  -- ==========================================================

  with filtered as materialized (

    select
      al.id,
      al.created_at,

      al.user_id,
      al.team_member_id,

      al.action,
      al.entity_type,
      al.entity_id,

      al.previous_values,
      al.new_values,
      al.metadata

    from public.activity_log al

    where al.tenant_id = p_tenant_id

      and (
        v_entity_type is null
        or al.entity_type = v_entity_type
      )

      and (
        v_action is null
        or al.action = v_action
      )

      and (
        p_user_id is null
        or al.user_id = p_user_id
      )

      and (
        p_from is null
        or al.created_at >= p_from
      )

      and (
        p_to is null
        or al.created_at <= p_to
      )
  ),

  counted as (

    select
      pg_catalog.count(*) as total

    from filtered
  ),

  paged as (

    select *
    from filtered

    order by
      created_at desc,
      id desc

    limit v_page_size
    offset v_offset
  ),

  enriched as (

    select
      p.id,
      p.created_at,

      p.user_id,
      p.team_member_id,

      case
        when p.team_member_id is not null
          then 'team_member'

        when p.user_id is not null
          then 'user'

        else 'system'
      end as actor_type,

      case
        when p.team_member_id is not null
          then coalesce(
            nullif(pg_catalog.btrim(tm.name), ''),
            'Miembro del equipo'
          )

        when p.user_id is not null
          then coalesce(
            nullif(pg_catalog.btrim(pr.full_name), ''),
            'Usuario'
          )

        else 'Sistema'
      end as actor_name,

      p.action,
      p.entity_type,
      p.entity_id,

      case
        when p.entity_type = 'order'
          then coalesce(
            nullif(p.metadata ->> 'reference', ''),
            'Pedido'
          )

        when p.entity_type = 'client'
          then coalesce(
            nullif(p.metadata ->> 'client_name', ''),
            'Cliente'
          )

        else p.entity_type
      end as entity_label,

      nullif(
        p.metadata ->> 'field',
        ''
      ) as changed_field,

      p.previous_values,
      p.new_values,
      p.metadata

    from paged p

    left join public.profiles pr
      on pr.id = p.user_id

    left join public.team_members tm
      on tm.id = p.team_member_id
     and tm.tenant_id = p_tenant_id
  ),

  event_json as (

    select
      coalesce(

        pg_catalog.jsonb_agg(

          pg_catalog.jsonb_build_object(

            'id',
              e.id,

            'created_at',
              e.created_at,

            'actor_type',
              e.actor_type,

            'actor_name',
              e.actor_name,

            'user_id',
              e.user_id,

            'team_member_id',
              e.team_member_id,

            'action',
              e.action,

            'entity_type',
              e.entity_type,

            'entity_id',
              e.entity_id,

            'entity_label',
              e.entity_label,

            'changed_field',
              e.changed_field,

            'previous_values',
              e.previous_values,

            'new_values',
              e.new_values,

            'metadata',
              e.metadata

          )

          order by
            e.created_at desc,
            e.id desc

        ),

        '[]'::jsonb

      ) as events

    from enriched e
  )

  select
    pg_catalog.jsonb_build_object(

      'events',
        ej.events,

      'total',
        c.total,

      'page',
        v_page,

      'page_size',
        v_page_size,

      'total_pages',
        case
          when c.total = 0
            then 0
          else
            (
              (
                c.total + v_page_size - 1
              ) / v_page_size
            )
        end,

      'has_more',
        (
          v_page * v_page_size < c.total
        )

    )

  into v_result

  from counted c
  cross join event_json ej;


  return v_result;

end;
$function$;

CREATE OR REPLACE FUNCTION public.list_clients (
  p_tenant_id        uuid,
  p_query            text    DEFAULT NULL::text,
  p_customer_type_id uuid    DEFAULT NULL::uuid,
  p_active           boolean DEFAULT NULL::boolean,
  p_page             integer DEFAULT 1,
  p_page_size        integer DEFAULT 25
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_query text;
  v_phone_query text;
  v_tax_query text;

  v_page integer;
  v_page_size integer;
  v_offset integer;

  v_result jsonb;
begin

  -- ==========================================================
  -- AUTH
  -- ==========================================================

  if auth.uid() is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- TENANT MEMBERSHIP
  -- ==========================================================

  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ==========================================================
  -- PAGINACIÓN
  -- ==========================================================

  v_page :=
    greatest(
      coalesce(p_page, 1),
      1
    );

  v_page_size :=
    least(
      greatest(
        coalesce(p_page_size, 25),
        1
      ),
      100
    );

  v_offset :=
    (v_page - 1) * v_page_size;


  -- ==========================================================
  -- NORMALIZAR BÚSQUEDA
  -- ==========================================================

  v_query :=
    pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(p_query, '')
      )
    );

  v_phone_query :=
    public.normalize_client_phone(p_query);

  v_tax_query :=
    public.normalize_client_tax_id(p_query);


  -- ==========================================================
  -- VALIDAR TIPO
  -- ==========================================================

  if p_customer_type_id is not null then

    perform 1
    from public.customer_types ct
    where ct.id = p_customer_type_id
      and ct.tenant_id = p_tenant_id;

    if not found then
      raise exception 'invalid customer type for current tenant'
        using errcode = '22023';
    end if;

  end if;


  -- ==========================================================
  -- CONSULTA
  -- ==========================================================

  with filtered as materialized (

    select
      c.id,
      c.customer_type_id,
      ct.name as customer_type_name,

      c.name,
      c.contact_name,
      c.company_name,

      c.tax_id,
      c.email,
      c.phone,
      c.notes,

      c.active,
      c.created_at,

      pg_catalog.lower(c.name) as sort_name

    from public.clients c

    left join public.customer_types ct
      on ct.id = c.customer_type_id
     and ct.tenant_id = c.tenant_id

    where
      c.tenant_id = p_tenant_id

      and (
        p_active is null
        or c.active = p_active
      )

      and (
        p_customer_type_id is null
        or c.customer_type_id = p_customer_type_id
      )

      and (

        v_query = ''

        or pg_catalog.lower(
          coalesce(c.name, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(c.contact_name, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(c.company_name, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(c.email, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(c.notes, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(ct.name, '')
        ) like '%' || v_query || '%'

        or (
          v_phone_query is not null
          and public.normalize_client_phone(c.phone)
            like '%' || v_phone_query || '%'
        )

        or (
          v_tax_query is not null
          and public.normalize_client_tax_id(c.tax_id)
            like '%' || v_tax_query || '%'
        )

      )

  ),


  counted as (

    select
      pg_catalog.count(*) as total
    from filtered

  ),


  paged as (

    select *
    from filtered

    order by
      sort_name asc,
      id asc

    limit v_page_size
    offset v_offset

  ),


  enriched as (

    select
      p.*,

      coalesce(
        stats.orders_count,
        0
      ) as orders_count,

      stats.last_order_at

    from paged p

    left join lateral (

      select
        pg_catalog.count(*) as orders_count,
        pg_catalog.max(o.created_at) as last_order_at

      from public.orders o

      where o.tenant_id = p_tenant_id
        and o.client_id = p.id

    ) stats
      on true

  ),


  client_json as (

    select

      coalesce(

        pg_catalog.jsonb_agg(

          pg_catalog.jsonb_build_object(

            'id', e.id,

            'customer_type_id',
              e.customer_type_id,

            'customer_type_name',
              e.customer_type_name,

            'name',
              e.name,

            'contact_name',
              e.contact_name,

            'company_name',
              e.company_name,

            'tax_id',
              e.tax_id,

            'email',
              e.email,

            'phone',
              e.phone,

            'notes',
              e.notes,

            'active',
              e.active,

            'created_at',
              e.created_at,

            'orders_count',
              e.orders_count,

            'last_order_at',
              e.last_order_at

          )

          order by
            e.sort_name asc,
            e.id asc

        ),

        '[]'::jsonb

      ) as clients

    from enriched e

  )


  select

    pg_catalog.jsonb_build_object(

      'clients',
        cj.clients,

      'total',
        c.total,

      'page',
        v_page,

      'page_size',
        v_page_size,

      'total_pages',
        case
          when c.total = 0
            then 0
          else
            (
              (
                c.total + v_page_size - 1
              ) / v_page_size
            )
        end,

      'has_more',
        (
          v_page * v_page_size < c.total
        )

    )

  into v_result

  from counted c
  cross join client_json cj;


  return v_result;

end;
$function$;

CREATE OR REPLACE FUNCTION public.list_services (
  p_tenant_id   uuid,
  p_query       text    DEFAULT NULL::text,
  p_category_id uuid    DEFAULT NULL::uuid,
  p_active      boolean DEFAULT true
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_query text;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  v_query :=
    pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(p_query, '')
      )
    );

  if p_category_id is not null then
    perform 1
    from public.service_categories sc
    where sc.id = p_category_id
      and sc.tenant_id = p_tenant_id;

    if not found then
      raise exception 'invalid service category for current tenant'
        using errcode = '22023';
    end if;
  end if;

  with filtered as materialized (
    select
      s.id,
      s.category_id,
      sc.name as category_name,

      s.name,
      s.description,
      s.standard_lead_time_minutes,

      s.requires_file,
      s.requires_design,
      s.requires_quote,

      s.active,
      s.sort_order,
      s.created_at,
      s.updated_at

    from public.services s

    left join public.service_categories sc
      on sc.id = s.category_id
     and sc.tenant_id = s.tenant_id

    where s.tenant_id = p_tenant_id

      and (
        p_active is null
        or s.active = p_active
      )

      and (
        p_category_id is null
        or s.category_id = p_category_id
      )

      and (
        v_query = ''

        or pg_catalog.lower(
          coalesce(s.name, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(s.description, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(sc.name, '')
        ) like '%' || v_query || '%'
      )
  ),

  enriched as (
    select
      f.*,

      (
        select pg_catalog.count(*)
        from public.orders o
        where o.tenant_id = p_tenant_id
          and o.service_id = f.id
      ) as orders_count

    from filtered f
  ),

  service_json as (
    select
      coalesce(
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', e.id,
            'category_id', e.category_id,
            'category_name', e.category_name,

            'name', e.name,
            'description', e.description,

            'standard_lead_time_minutes',
              e.standard_lead_time_minutes,

            'requires_file',
              e.requires_file,

            'requires_design',
              e.requires_design,

            'requires_quote',
              e.requires_quote,

            'active',
              e.active,

            'sort_order',
              e.sort_order,

            'orders_count',
              e.orders_count,

            'created_at',
              e.created_at,

            'updated_at',
              e.updated_at
          )
          order by
            e.sort_order asc,
            pg_catalog.lower(e.name) asc,
            e.id asc
        ),
        '[]'::jsonb
      ) as services

    from enriched e
  ),

  metrics as (
    select
      pg_catalog.count(*) as total,

      pg_catalog.avg(
        standard_lead_time_minutes
      ) filter (
        where standard_lead_time_minutes is not null
      ) as average_standard_lead_time_minutes

    from filtered
  )

  select
    pg_catalog.jsonb_build_object(
      'services',
        sj.services,

      'total',
        m.total,

      'average_standard_lead_time_minutes',
        case
          when m.average_standard_lead_time_minutes is null
            then null
          else
            pg_catalog.round(
              m.average_standard_lead_time_minutes
            )::integer
        end
    )

  into v_result

  from service_json sj
  cross join metrics m;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.list_team_members (
  p_tenant_id uuid,
  p_query     text    DEFAULT NULL::text,
  p_active    boolean DEFAULT true
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_query text;
  v_result jsonb;
begin

  -- ==========================================================
  -- AUTH
  -- ==========================================================

  if auth.uid() is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- TENANT
  -- ==========================================================

  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ==========================================================
  -- BÚSQUEDA
  -- ==========================================================

  v_query :=
    pg_catalog.lower(
      pg_catalog.btrim(
        coalesce(p_query, '')
      )
    );


  -- ==========================================================
  -- EQUIPO
  -- ==========================================================

  with filtered as materialized (

    select
      tm.id,
      tm.name,
      tm.email,
      tm.phone,

      tm.job_title,
      tm.department,

      tm.active,
      tm.can_receive_orders,

      tm.notes,

      tm.created_at,
      tm.updated_at,

      pg_catalog.lower(tm.name) as sort_name

    from public.team_members tm

    where tm.tenant_id = p_tenant_id

      and (
        p_active is null
        or tm.active = p_active
      )

      and (
        v_query = ''

        or pg_catalog.lower(
          coalesce(tm.name, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(tm.job_title, '')
        ) like '%' || v_query || '%'

        or pg_catalog.lower(
          coalesce(tm.department, '')
        ) like '%' || v_query || '%'
      )
  ),

  enriched as (

    select
      f.*,

      -- Todos los pedidos históricos asignados
      (
        select pg_catalog.count(*)

        from public.orders o

        where o.tenant_id = p_tenant_id
          and o.assigned_team_member_id = f.id
      ) as total_orders_count,


      -- Pedidos operativamente activos
      (
        select pg_catalog.count(*)

        from public.orders o

        join public.order_statuses os
          on os.id = o.status_id
         and os.tenant_id = o.tenant_id

        where o.tenant_id = p_tenant_id
          and o.assigned_team_member_id = f.id
          and o.archived_at is null
          and os.is_closed = false
          and os.is_cancelled = false
      ) as active_orders_count

    from filtered f
  ),

  team_json as (

    select
      coalesce(

        pg_catalog.jsonb_agg(

          pg_catalog.jsonb_build_object(

            'id',
              e.id,

            'name',
              e.name,

            'email',
              e.email,

            'phone',
              e.phone,

            'job_title',
              e.job_title,

            'department',
              e.department,

            'active',
              e.active,

            'can_receive_orders',
              e.can_receive_orders,

            'notes',
              e.notes,

            'active_orders_count',
              e.active_orders_count,

            'total_orders_count',
              e.total_orders_count,

            'created_at',
              e.created_at,

            'updated_at',
              e.updated_at

          )

          order by
            e.sort_name asc,
            e.id asc

        ),

        '[]'::jsonb

      ) as members

    from enriched e
  ),

  metrics as (

    select
      pg_catalog.count(*) as total,

      pg_catalog.count(*) filter (
        where active = true
          and can_receive_orders = true
      ) as available_count,

      coalesce(
        pg_catalog.sum(active_orders_count),
        0::numeric
      ) as active_orders_count

    from enriched
  )

  select
    pg_catalog.jsonb_build_object(

      'members',
        tj.members,

      'total',
        m.total,

      'available_count',
        m.available_count,

      'active_orders_count',
        m.active_orders_count

    )

  into v_result

  from team_json tj
  cross join metrics m;


  return v_result;

end;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_client_email (
  value text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
  AS $function$
  select case
    when value is null or btrim(value) = '' then null
    else lower(btrim(value))
  end
$function$;

CREATE OR REPLACE FUNCTION public.normalize_client_phone (
  value text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
  AS $function$
  select
    case
      when value is null or pg_catalog.btrim(value) = ''
        then null
      else
        nullif(
          pg_catalog.regexp_replace(
            value,
            '[^0-9]',
            '',
            'g'
          ),
          ''
        )
    end;
$function$;

CREATE OR REPLACE FUNCTION public.normalize_client_tax_id (
  value text
)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO 'pg_catalog'
  AS $function$
  select
    case
      when value is null or pg_catalog.btrim(value) = ''
        then null
      else
        nullif(
          pg_catalog.upper(
            pg_catalog.regexp_replace(
              value,
              '[^A-Za-z0-9]',
              '',
              'g'
            )
          ),
          ''
        )
    end;
$function$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
  RETURNS event_trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'pg_catalog'
  AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_clients (
  p_tenant_id uuid,
  p_query     text    DEFAULT NULL::text,
  p_limit     integer DEFAULT 10
)
  RETURNS TABLE (
    id                 uuid,
    tenant_id          uuid,
    customer_type_id   uuid,
    customer_type_name text,
    name               text,
    contact_name       text,
    company_name       text,
    tax_id             text,
    email              text,
    phone              text,
    notes              text,
    active             boolean,
    created_at         timestamp with time zone
  )
  LANGUAGE plpgsql
  SET search_path TO 'public'
  AS $function$
declare
  v_query text;
  v_phone_query text;
  v_tax_query text;
  v_limit integer;
begin

  -- ----------------------------------------------------------
  -- Seguridad adicional:
  -- el usuario debe pertenecer activamente al tenant solicitado.
  -- ----------------------------------------------------------

  if auth.uid() is null then
    raise exception 'Authentication required'
      using errcode = '28000';
  end if;


  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = auth.uid()
      and m.active = true
  ) then
    raise exception 'Tenant access denied'
      using errcode = '42501';
  end if;


  -- ----------------------------------------------------------
  -- Límite defensivo
  -- ----------------------------------------------------------

  v_limit := least(greatest(coalesce(p_limit, 10), 1), 25);


  -- ----------------------------------------------------------
  -- Normalizaciones de búsqueda
  -- ----------------------------------------------------------

  v_query := lower(btrim(coalesce(p_query, '')));

  v_phone_query :=
    public.normalize_client_phone(p_query);

  v_tax_query :=
    public.normalize_client_tax_id(p_query);


  -- ----------------------------------------------------------
  -- Sin texto:
  -- devolver clientes recientes, sin cargar todo el tenant.
  -- ----------------------------------------------------------

  if v_query = '' then

    return query
    select
      c.id,
      c.tenant_id,
      c.customer_type_id,
      ct.name as customer_type_name,
      c.name,
      c.contact_name,
      c.company_name,
      c.tax_id,
      c.email,
      c.phone,
      c.notes,
      c.active,
      c.created_at

    from public.clients c

    left join public.customer_types ct
      on ct.tenant_id = c.tenant_id
      and ct.id = c.customer_type_id

    where c.tenant_id = p_tenant_id
      and c.active = true

    order by c.created_at desc, c.name asc

    limit v_limit;

    return;

  end if;


  -- ----------------------------------------------------------
  -- Con búsqueda:
  -- todos los campos funcionales del cliente.
  -- ----------------------------------------------------------

  return query
  select
    c.id,
    c.tenant_id,
    c.customer_type_id,
    ct.name as customer_type_name,
    c.name,
    c.contact_name,
    c.company_name,
    c.tax_id,
    c.email,
    c.phone,
    c.notes,
    c.active,
    c.created_at

  from public.clients c

  left join public.customer_types ct
    on ct.tenant_id = c.tenant_id
    and ct.id = c.customer_type_id

  where
    c.tenant_id = p_tenant_id
    and c.active = true

    and (

      lower(coalesce(c.name, ''))
        like '%' || v_query || '%'

      or lower(coalesce(c.contact_name, ''))
        like '%' || v_query || '%'

      or lower(coalesce(c.company_name, ''))
        like '%' || v_query || '%'

      or lower(coalesce(c.email, ''))
        like '%' || v_query || '%'

      or lower(coalesce(c.notes, ''))
        like '%' || v_query || '%'

      or lower(coalesce(ct.name, ''))
        like '%' || v_query || '%'

      or (
        v_phone_query is not null
        and public.normalize_client_phone(c.phone)
          like '%' || v_phone_query || '%'
      )

      or (
        v_tax_query is not null
        and public.normalize_client_tax_id(c.tax_id)
          like '%' || v_tax_query || '%'
      )

    )

  order by

    -- Coincidencia exacta de nombre primero
    case
      when lower(c.name) = v_query then 0
      else 1
    end,

    -- Después nombres que empiezan por la búsqueda
    case
      when lower(c.name) like v_query || '%' then 0
      else 1
    end,

    c.name asc

  limit v_limit;

end;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.shares_tenant_with (
  target_user_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs
      on theirs.tenant_id = mine.tenant_id
    where mine.user_id = auth.uid()
      and mine.active = true
      and theirs.user_id = target_user_id
      and theirs.active = true
  );
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_client()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();

  v_old_customer_type_name text;
  v_new_customer_type_name text;
begin
  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  if tg_op = 'INSERT' then

    if not public.has_tenant_role(
      new.tenant_id,
      array['owner', 'admin', 'manager', 'staff']::text[]
    ) then
      raise exception 'tenant access denied'
        using errcode = '42501';
    end if;


    if new.customer_type_id is not null then
      select name
      into v_new_customer_type_name
      from public.customer_types
      where tenant_id = new.tenant_id
        and id = new.customer_type_id;
    end if;


    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'client.created',
      'client',
      new.id,
      null,
      pg_catalog.jsonb_build_object(
        'name', new.name,
        'customer_type_id', new.customer_type_id,
        'customer_type_name', v_new_customer_type_name,
        'contact_name', new.contact_name,
        'company_name', new.company_name,
        'tax_id', new.tax_id,
        'email', new.email,
        'phone', new.phone,
        'notes', new.notes
      ),
      pg_catalog.jsonb_build_object(
        'client_name', new.name
      )
    );

    return new;
  end if;


  if tg_op = 'UPDATE' then

    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id cannot change on client'
        using errcode = '42501';
    end if;

    if not public.has_tenant_role(
      new.tenant_id,
      array['owner', 'admin', 'manager', 'staff']::text[]
    ) then
      raise exception 'tenant access denied'
        using errcode = '42501';
    end if;


    -- Solo registrar si cambia algún dato operativo del cliente.
    if
      old.customer_type_id is not distinct from new.customer_type_id
      and old.name is not distinct from new.name
      and old.contact_name is not distinct from new.contact_name
      and old.company_name is not distinct from new.company_name
      and old.tax_id is not distinct from new.tax_id
      and old.email is not distinct from new.email
      and old.phone is not distinct from new.phone
      and old.notes is not distinct from new.notes
    then
      return new;
    end if;


    if old.customer_type_id is not null then
      select name
      into v_old_customer_type_name
      from public.customer_types
      where tenant_id = new.tenant_id
        and id = old.customer_type_id;
    end if;

    if new.customer_type_id is not null then
      select name
      into v_new_customer_type_name
      from public.customer_types
      where tenant_id = new.tenant_id
        and id = new.customer_type_id;
    end if;


    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'client.updated',
      'client',
      new.id,

      pg_catalog.jsonb_build_object(
        'name', old.name,
        'customer_type_id', old.customer_type_id,
        'customer_type_name', v_old_customer_type_name,
        'contact_name', old.contact_name,
        'company_name', old.company_name,
        'tax_id', old.tax_id,
        'email', old.email,
        'phone', old.phone,
        'notes', old.notes
      ),

      pg_catalog.jsonb_build_object(
        'name', new.name,
        'customer_type_id', new.customer_type_id,
        'customer_type_name', v_new_customer_type_name,
        'contact_name', new.contact_name,
        'company_name', new.company_name,
        'tax_id', new.tax_id,
        'email', new.email,
        'phone', new.phone,
        'notes', new.notes
      ),

      pg_catalog.jsonb_build_object(
        'client_name', new.name
      )
    );

    return new;
  end if;


  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_client()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();

  v_old_client_name text;
  v_new_client_name text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.client_id is not distinct from new.client_id then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change with order client'
      using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  if old.client_id is not null then
    select name
    into v_old_client_name
    from public.clients
    where tenant_id = new.tenant_id
      and id = old.client_id;
  end if;

  if new.client_id is not null then
    select name
    into v_new_client_name
    from public.clients
    where tenant_id = new.tenant_id
      and id = new.client_id;
  end if;


  insert into public.activity_log (
    tenant_id,
    user_id,
    team_member_id,
    action,
    entity_type,
    entity_id,
    previous_values,
    new_values,
    metadata
  )
  values (
    new.tenant_id,
    v_actor,
    null,
    'order.client_changed',
    'order',
    new.id,

    pg_catalog.jsonb_build_object(
      'client_id', old.client_id,
      'client_name', v_old_client_name
    ),

    pg_catalog.jsonb_build_object(
      'client_id', new.client_id,
      'client_name', v_new_client_name
    ),

    pg_catalog.jsonb_build_object(
      'reference', new.reference
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_content()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change with order content'
      using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- TÍTULO
  if old.title is distinct from new.title then
    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.content_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'value', old.title
      ),
      pg_catalog.jsonb_build_object(
        'value', new.title
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'title'
      )
    );
  end if;


  -- DESCRIPCIÓN
  if old.description is distinct from new.description then
    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.content_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'value', old.description
      ),
      pg_catalog.jsonb_build_object(
        'value', new.description
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'description'
      )
    );
  end if;


  -- NOTAS
  if old.notes is distinct from new.notes then
    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.content_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'value', old.notes
      ),
      pg_catalog.jsonb_build_object(
        'value', new.notes
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'notes'
      )
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_created()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  insert into public.activity_log (
    tenant_id,
    user_id,
    team_member_id,
    action,
    entity_type,
    entity_id,
    previous_values,
    new_values,
    metadata
  )
  values (
    new.tenant_id,
    v_actor,
    null,
    'order.created',
    'order',
    new.id,
    null,
    pg_catalog.jsonb_build_object(
      'title', new.title,
      'status_id', new.status_id,
      'priority', new.priority,
      'client_id', new.client_id,
      'service_id', new.service_id,
      'assigned_team_member_id', new.assigned_team_member_id,
      'entry_channel_id', new.entry_channel_id,
      'order_context_id', new.order_context_id,
      'due_at', new.due_at
    ),
    pg_catalog.jsonb_build_object(
      'reference', new.reference
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_details()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();

  v_old_code text;
  v_old_name text;
  v_new_code text;
  v_new_name text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change with order details'
      using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- PRIORIDAD
  if old.priority is distinct from new.priority then
    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.details_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'value', old.priority
      ),
      pg_catalog.jsonb_build_object(
        'value', new.priority
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'priority'
      )
    );
  end if;


  -- SERVICIO
  if old.service_id is distinct from new.service_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.service_id is not null then
      select null::text, name
      into v_old_code, v_old_name
      from public.services
      where tenant_id = new.tenant_id
        and id = old.service_id;
    end if;

    if new.service_id is not null then
      select null::text, name
      into v_new_code, v_new_name
      from public.services
      where tenant_id = new.tenant_id
        and id = new.service_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.service_id,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.service_id,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'service_id'
      )
    );
  end if;


  -- CANAL DE ENTRADA
  if old.entry_channel_id is distinct from new.entry_channel_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.entry_channel_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.entry_channels
      where tenant_id = new.tenant_id
        and id = old.entry_channel_id;
    end if;

    if new.entry_channel_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.entry_channels
      where tenant_id = new.tenant_id
        and id = new.entry_channel_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.entry_channel_id,
        'value_code', v_old_code,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.entry_channel_id,
        'value_code', v_new_code,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'entry_channel_id'
      )
    );
  end if;


  -- RESPONSABLE
  if old.assigned_team_member_id is distinct from new.assigned_team_member_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.assigned_team_member_id is not null then
      select null::text, name
      into v_old_code, v_old_name
      from public.team_members
      where tenant_id = new.tenant_id
        and id = old.assigned_team_member_id;
    end if;

    if new.assigned_team_member_id is not null then
      select null::text, name
      into v_new_code, v_new_name
      from public.team_members
      where tenant_id = new.tenant_id
        and id = new.assigned_team_member_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.assigned_team_member_id,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.assigned_team_member_id,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'assigned_team_member_id'
      )
    );
  end if;


  -- CONTEXTO
  if old.order_context_id is distinct from new.order_context_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.order_context_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.order_contexts
      where tenant_id = new.tenant_id
        and id = old.order_context_id;
    end if;

    if new.order_context_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.order_contexts
      where tenant_id = new.tenant_id
        and id = new.order_context_id;
    end if;

    insert into public.activity_log (
      tenant_id, user_id, team_member_id,
      action, entity_type, entity_id,
      previous_values, new_values, metadata
    )
    values (
      new.tenant_id, v_actor, null,
      'order.details_changed', 'order', new.id,
      pg_catalog.jsonb_build_object(
        'value_id', old.order_context_id,
        'value_code', v_old_code,
        'value_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'value_id', new.order_context_id,
        'value_code', v_new_code,
        'value_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'order_context_id'
      )
    );
  end if;


  -- FECHA PREVISTA
  if old.due_at is distinct from new.due_at then
    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.details_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'value', old.due_at
      ),
      pg_catalog.jsonb_build_object(
        'value', new.due_at
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'due_at'
      )
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_management()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_old_code text;
  v_old_name text;
  v_new_code text;
  v_new_name text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change with order management'
      using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- -------------------------------------------------------
  -- ARCHIVOS
  -- -------------------------------------------------------

  if old.file_status_id is distinct from new.file_status_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.file_status_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.file_statuses
      where id = old.file_status_id
        and tenant_id = new.tenant_id;
    end if;

    if new.file_status_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.file_statuses
      where id = new.file_status_id
        and tenant_id = new.tenant_id;
    end if;

    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.management_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'option_id', old.file_status_id,
        'option_code', v_old_code,
        'option_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'option_id', new.file_status_id,
        'option_code', v_new_code,
        'option_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'file_status_id'
      )
    );

  end if;


  -- -------------------------------------------------------
  -- PRESUPUESTO
  -- -------------------------------------------------------

  if old.quote_status_id is distinct from new.quote_status_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.quote_status_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.quote_statuses
      where id = old.quote_status_id
        and tenant_id = new.tenant_id;
    end if;

    if new.quote_status_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.quote_statuses
      where id = new.quote_status_id
        and tenant_id = new.tenant_id;
    end if;

    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.management_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'option_id', old.quote_status_id,
        'option_code', v_old_code,
        'option_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'option_id', new.quote_status_id,
        'option_code', v_new_code,
        'option_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'quote_status_id'
      )
    );

  end if;


  -- -------------------------------------------------------
  -- PAGO
  -- -------------------------------------------------------

  if old.payment_status_id is distinct from new.payment_status_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.payment_status_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.payment_statuses
      where id = old.payment_status_id
        and tenant_id = new.tenant_id;
    end if;

    if new.payment_status_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.payment_statuses
      where id = new.payment_status_id
        and tenant_id = new.tenant_id;
    end if;

    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.management_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'option_id', old.payment_status_id,
        'option_code', v_old_code,
        'option_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'option_id', new.payment_status_id,
        'option_code', v_new_code,
        'option_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'payment_status_id'
      )
    );

  end if;


  -- -------------------------------------------------------
  -- ENTREGA
  -- -------------------------------------------------------

  if old.delivery_method_id is distinct from new.delivery_method_id then

    v_old_code := null;
    v_old_name := null;
    v_new_code := null;
    v_new_name := null;

    if old.delivery_method_id is not null then
      select code, name
      into v_old_code, v_old_name
      from public.delivery_methods
      where id = old.delivery_method_id
        and tenant_id = new.tenant_id;
    end if;

    if new.delivery_method_id is not null then
      select code, name
      into v_new_code, v_new_name
      from public.delivery_methods
      where id = new.delivery_method_id
        and tenant_id = new.tenant_id;
    end if;

    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'order.management_changed',
      'order',
      new.id,
      pg_catalog.jsonb_build_object(
        'option_id', old.delivery_method_id,
        'option_code', v_old_code,
        'option_name', v_old_name
      ),
      pg_catalog.jsonb_build_object(
        'option_id', new.delivery_method_id,
        'option_code', v_new_code,
        'option_name', v_new_name
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'delivery_method_id'
      )
    );

  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_notification()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.customer_notification_status
       is not distinct from new.customer_notification_status then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception
      'tenant_id cannot change with customer notification status'
      using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  insert into public.activity_log (
    tenant_id,
    user_id,
    team_member_id,
    action,
    entity_type,
    entity_id,
    previous_values,
    new_values,
    metadata
  )
  values (
    new.tenant_id,
    v_actor,
    null,
    'order.notification_changed',
    'order',
    new.id,

    pg_catalog.jsonb_build_object(
      'customer_notification_status',
        old.customer_notification_status,
      'customer_notified_at',
        old.customer_notified_at,
      'customer_notified_by',
        old.customer_notified_by
    ),

    pg_catalog.jsonb_build_object(
      'customer_notification_status',
        new.customer_notification_status,
      'customer_notified_at',
        new.customer_notified_at,
      'customer_notified_by',
        new.customer_notified_by
    ),

    pg_catalog.jsonb_build_object(
      'reference',
      new.reference
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_order_status()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
  v_old public.order_statuses%rowtype;
  v_new public.order_statuses%rowtype;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.status_id is not distinct from new.status_id then
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'tenant_id cannot change with status'
      using errcode = '42501';
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.is_tenant_member(new.tenant_id) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  if old.status_id is not null then
    select *
    into v_old
    from public.order_statuses
    where id = old.status_id
      and tenant_id = new.tenant_id;
  end if;

  if new.status_id is not null then
    select *
    into v_new
    from public.order_statuses
    where id = new.status_id
      and tenant_id = new.tenant_id;
  end if;

  insert into public.activity_log (
    tenant_id,
    user_id,
    team_member_id,
    action,
    entity_type,
    entity_id,
    previous_values,
    new_values,
    metadata
  ) values (
    new.tenant_id,
    v_actor,
    null,
    'order.status_changed',
    'order',
    new.id,
    pg_catalog.jsonb_build_object(
      'status_id', old.status_id,
      'status_code', v_old.code,
      'status_name', v_old.name
    ),
    pg_catalog.jsonb_build_object(
      'status_id', new.status_id,
      'status_code', v_new.code,
      'status_name', v_new.name
    ),
    pg_catalog.jsonb_build_object(
      'reference', new.reference
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_service()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();

  v_old_category_name text;
  v_new_category_name text;
begin

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- INSERT
  -- ==========================================================

  if tg_op = 'INSERT' then

    if not public.has_tenant_role(
      new.tenant_id,
      array['owner', 'admin', 'manager']::text[]
    ) then
      raise exception 'tenant access denied'
        using errcode = '42501';
    end if;


    if new.category_id is not null then
      select sc.name
      into v_new_category_name
      from public.service_categories sc
      where sc.tenant_id = new.tenant_id
        and sc.id = new.category_id;
    end if;


    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'service.created',
      'service',
      new.id,
      null,

      pg_catalog.jsonb_build_object(
        'name', new.name,
        'category_id', new.category_id,
        'category_name', v_new_category_name,
        'description', new.description,
        'standard_lead_time_minutes', new.standard_lead_time_minutes,
        'requires_file', new.requires_file,
        'requires_design', new.requires_design,
        'requires_quote', new.requires_quote,
        'active', new.active,
        'sort_order', new.sort_order
      ),

      pg_catalog.jsonb_build_object(
        'service_name', new.name
      )
    );

    return new;
  end if;


  -- ==========================================================
  -- UPDATE
  -- ==========================================================

  if tg_op = 'UPDATE' then

    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id cannot change on service'
        using errcode = '42501';
    end if;


    if not public.has_tenant_role(
      new.tenant_id,
      array['owner', 'admin', 'manager']::text[]
    ) then
      raise exception 'tenant access denied'
        using errcode = '42501';
    end if;


    -- No registrar un UPDATE que únicamente modifique updated_at.
    if
      old.category_id is not distinct from new.category_id
      and old.name is not distinct from new.name
      and old.description is not distinct from new.description
      and old.standard_lead_time_minutes
        is not distinct from new.standard_lead_time_minutes
      and old.requires_file is not distinct from new.requires_file
      and old.requires_design is not distinct from new.requires_design
      and old.requires_quote is not distinct from new.requires_quote
      and old.active is not distinct from new.active
      and old.sort_order is not distinct from new.sort_order
    then
      return new;
    end if;


    if old.category_id is not null then
      select sc.name
      into v_old_category_name
      from public.service_categories sc
      where sc.tenant_id = new.tenant_id
        and sc.id = old.category_id;
    end if;


    if new.category_id is not null then
      select sc.name
      into v_new_category_name
      from public.service_categories sc
      where sc.tenant_id = new.tenant_id
        and sc.id = new.category_id;
    end if;


    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'service.updated',
      'service',
      new.id,

      pg_catalog.jsonb_build_object(
        'name', old.name,
        'category_id', old.category_id,
        'category_name', v_old_category_name,
        'description', old.description,
        'standard_lead_time_minutes', old.standard_lead_time_minutes,
        'requires_file', old.requires_file,
        'requires_design', old.requires_design,
        'requires_quote', old.requires_quote,
        'active', old.active,
        'sort_order', old.sort_order
      ),

      pg_catalog.jsonb_build_object(
        'name', new.name,
        'category_id', new.category_id,
        'category_name', v_new_category_name,
        'description', new.description,
        'standard_lead_time_minutes', new.standard_lead_time_minutes,
        'requires_file', new.requires_file,
        'requires_design', new.requires_design,
        'requires_quote', new.requires_quote,
        'active', new.active,
        'sort_order', new.sort_order
      ),

      pg_catalog.jsonb_build_object(
        'service_name', new.name
      )
    );

    return new;
  end if;


  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_activity_log_team_member()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor uuid := auth.uid();
begin

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- INSERT
  -- ==========================================================

  if tg_op = 'INSERT' then

    if not public.has_tenant_role(
      new.tenant_id,
      array['owner', 'admin', 'manager']::text[]
    ) then
      raise exception 'tenant access denied'
        using errcode = '42501';
    end if;


    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,

      -- Este campo representa al ACTOR, no al miembro modificado.
      null,

      'team_member.created',
      'team_member',
      new.id,
      null,

      pg_catalog.jsonb_build_object(
        'name', new.name,
        'job_title', new.job_title,
        'department', new.department,
        'active', new.active,
        'can_receive_orders', new.can_receive_orders
      ),

      pg_catalog.jsonb_build_object(
        'team_member_name', new.name
      )
    );

    return new;
  end if;


  -- ==========================================================
  -- UPDATE
  -- ==========================================================

  if tg_op = 'UPDATE' then

    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id cannot change on team member'
        using errcode = '42501';
    end if;


    if not public.has_tenant_role(
      new.tenant_id,
      array['owner', 'admin', 'manager']::text[]
    ) then
      raise exception 'tenant access denied'
        using errcode = '42501';
    end if;


    -- No registrar cambios que únicamente afecten a updated_at
    -- u otros campos fuera del módulo operativo actual.
    if
      old.name is not distinct from new.name
      and old.job_title is not distinct from new.job_title
      and old.department is not distinct from new.department
      and old.active is not distinct from new.active
      and old.can_receive_orders is not distinct from new.can_receive_orders
    then
      return new;
    end if;


    insert into public.activity_log (
      tenant_id,
      user_id,
      team_member_id,
      action,
      entity_type,
      entity_id,
      previous_values,
      new_values,
      metadata
    )
    values (
      new.tenant_id,
      v_actor,
      null,
      'team_member.updated',
      'team_member',
      new.id,

      pg_catalog.jsonb_build_object(
        'name', old.name,
        'job_title', old.job_title,
        'department', old.department,
        'active', old.active,
        'can_receive_orders', old.can_receive_orders
      ),

      pg_catalog.jsonb_build_object(
        'name', new.name,
        'job_title', new.job_title,
        'department', new.department,
        'active', new.active,
        'can_receive_orders', new.can_receive_orders
      ),

      pg_catalog.jsonb_build_object(
        'team_member_name', new.name
      )
    );

    return new;
  end if;


  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.tg_assign_order_reference()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
declare
  v_slug text;
  v_prefix text;
  v_number bigint;
begin
  if new.tenant_id is null then
    raise exception 'tenant_id is required'
      using errcode = '23502';
  end if;

  select t.slug
  into v_slug
  from public.tenants t
  where t.id = new.tenant_id;

  if not found or v_slug is null then
    raise exception 'tenant not found'
      using errcode = 'P0002';
  end if;

  v_prefix := upper(regexp_replace(v_slug, '[^A-Za-z0-9]', '', 'g'));

  if v_prefix is null or char_length(v_prefix) = 0 then
    raise exception 'tenant slug produces empty reference prefix'
      using errcode = '22023';
  end if;

  insert into public.order_number_counters as c (
    tenant_id,
    last_number,
    updated_at
  )
  values (
    new.tenant_id,
    1,
    pg_catalog.now()
  )
  on conflict (tenant_id)
  do update
    set last_number = c.last_number + 1,
        updated_at = pg_catalog.now()
  returning c.last_number into v_number;

  -- Mínimo 4 dígitos; a partir de 10000 no truncar (lpad a 4 truncaría).
  new.reference :=
    v_prefix
    || '-'
    || lpad(
      v_number::text,
      greatest(4, char_length(v_number::text)),
      '0'
    );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_client (
  p_client_id        uuid,
  p_customer_type_id uuid,
  p_name             text,
  p_contact_name     text,
  p_company_name     text,
  p_tax_id           text,
  p_email            text,
  p_phone            text,
  p_notes            text,
  p_tenant_id        uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();

  v_client public.clients%rowtype;
  v_duplicate public.clients%rowtype;

  v_name text;
  v_contact_name text;
  v_company_name text;
  v_tax_id text;
  v_email text;
  v_phone text;
  v_notes text;

  v_email_normalized text;
  v_phone_normalized text;
  v_tax_id_normalized text;

  v_email_match boolean;
  v_phone_match boolean;
  v_tax_id_match boolean;

begin

  -- ----------------------------------------------------------
  -- Autenticación
  -- ----------------------------------------------------------

  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ----------------------------------------------------------
  -- Parámetros
  -- ----------------------------------------------------------

  if p_client_id is null
     or p_tenant_id is null then
    raise exception 'p_client_id and p_tenant_id are required'
      using errcode = '22023';
  end if;


  -- ----------------------------------------------------------
  -- Rol operativo
  -- ----------------------------------------------------------

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ----------------------------------------------------------
  -- Normalizar entrada
  -- ----------------------------------------------------------

  v_name := nullif(pg_catalog.btrim(p_name), '');

  if v_name is null then
    raise exception 'client name cannot be empty'
      using errcode = '22023';
  end if;


  v_contact_name := nullif(pg_catalog.btrim(p_contact_name), '');
  v_company_name := nullif(pg_catalog.btrim(p_company_name), '');
  v_tax_id := nullif(pg_catalog.btrim(p_tax_id), '');
  v_email := nullif(pg_catalog.btrim(p_email), '');
  v_phone := nullif(pg_catalog.btrim(p_phone), '');
  v_notes := nullif(pg_catalog.btrim(p_notes), '');


  v_email_normalized :=
    public.normalize_client_email(v_email);

  v_phone_normalized :=
    public.normalize_client_phone(v_phone);

  v_tax_id_normalized :=
    public.normalize_client_tax_id(v_tax_id);


  -- ----------------------------------------------------------
  -- Customer type
  -- ----------------------------------------------------------

  if p_customer_type_id is not null then

    perform 1
    from public.customer_types
    where id = p_customer_type_id
      and tenant_id = p_tenant_id
      and active = true;

    if not found then
      raise exception 'invalid customer type for current tenant'
        using errcode = '22023';
    end if;

  end if;


  -- ----------------------------------------------------------
  -- Bloquear cliente actual
  -- ----------------------------------------------------------

  select *
  into v_client
  from public.clients
  where id = p_client_id
    and tenant_id = p_tenant_id
  for update;


  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;


  -- ----------------------------------------------------------
  -- DUPLICADOS FUERTES
  --
  -- Excluye el propio cliente.
  -- ----------------------------------------------------------

  select *
  into v_duplicate
  from public.clients c
  where c.tenant_id = p_tenant_id
    and c.id <> p_client_id

    and (

      (
        v_email_normalized is not null
        and public.normalize_client_email(c.email)
          = v_email_normalized
      )

      or

      (
        v_phone_normalized is not null
        and public.normalize_client_phone(c.phone)
          = v_phone_normalized
      )

      or

      (
        v_tax_id_normalized is not null
        and public.normalize_client_tax_id(c.tax_id)
          = v_tax_id_normalized
      )

    )

  order by c.created_at
  limit 1;


  if found then

    v_email_match :=
      v_email_normalized is not null
      and public.normalize_client_email(v_duplicate.email)
        = v_email_normalized;

    v_phone_match :=
      v_phone_normalized is not null
      and public.normalize_client_phone(v_duplicate.phone)
        = v_phone_normalized;

    v_tax_id_match :=
      v_tax_id_normalized is not null
      and public.normalize_client_tax_id(v_duplicate.tax_id)
        = v_tax_id_normalized;


    raise exception 'client_duplicate'
      using
        errcode = '23505',

        detail = pg_catalog.jsonb_build_object(
          'client_id', v_duplicate.id,
          'client_name', v_duplicate.name,
          'email', v_duplicate.email,
          'phone', v_duplicate.phone,
          'tax_id', v_duplicate.tax_id,
          'email_match', v_email_match,
          'phone_match', v_phone_match,
          'tax_id_match', v_tax_id_match
        )::text,

        hint = 'Use or review the existing client';

  end if;


  -- ----------------------------------------------------------
  -- Sin cambios
  -- ----------------------------------------------------------

  if
    v_client.customer_type_id
      is not distinct from p_customer_type_id

    and v_client.name
      is not distinct from v_name

    and v_client.contact_name
      is not distinct from v_contact_name

    and v_client.company_name
      is not distinct from v_company_name

    and v_client.tax_id
      is not distinct from v_tax_id

    and v_client.email
      is not distinct from v_email

    and v_client.phone
      is not distinct from v_phone

    and v_client.notes
      is not distinct from v_notes

  then

    return pg_catalog.jsonb_build_object(
      'client',
      pg_catalog.to_jsonb(v_client)
        - 'metadata'
        - 'created_by'
    );

  end if;


  -- ----------------------------------------------------------
  -- Actualización
  -- ----------------------------------------------------------

  begin

    update public.clients
    set
      customer_type_id = p_customer_type_id,
      name = v_name,
      contact_name = v_contact_name,
      company_name = v_company_name,
      tax_id = v_tax_id,
      email = v_email,
      phone = v_phone,
      notes = v_notes

    where id = p_client_id
      and tenant_id = p_tenant_id

    returning *
    into v_client;


  exception
    when unique_violation then

      raise exception 'client_duplicate'
        using
          errcode = '23505',
          hint =
            'A client with the same email, phone or tax ID already exists';

  end;


  -- ----------------------------------------------------------
  -- Respuesta existente
  -- ----------------------------------------------------------

  return pg_catalog.jsonb_build_object(
    'client',
    pg_catalog.to_jsonb(v_client)
      - 'metadata'
      - 'created_by'
  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.update_service (
  p_service_id                 uuid,
  p_category_id                uuid,
  p_name                       text,
  p_description                text,
  p_standard_lead_time_minutes integer,
  p_requires_file              boolean,
  p_requires_design            boolean,
  p_requires_quote             boolean,
  p_active                     boolean,
  p_sort_order                 integer,
  p_tenant_id                  uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_service public.services%rowtype;

  v_name text;
  v_description text;
  v_lead_time integer;
  v_sort_order integer;
begin

  -- ==========================================================
  -- AUTH
  -- ==========================================================

  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- PERMISOS
  --
  -- Configuración de catálogo:
  -- owner / admin / manager
  -- staff mantiene acceso de lectura.
  -- ==========================================================

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner','admin','manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ==========================================================
  -- SERVICIO
  -- ==========================================================

  select *
  into v_service
  from public.services s
  where s.id = p_service_id
    and s.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'service not found'
      using errcode = 'P0002';
  end if;


  -- ==========================================================
  -- CAMPOS
  -- ==========================================================

  v_name :=
    nullif(
      pg_catalog.btrim(p_name),
      ''
    );

  if v_name is null then
    raise exception 'service name cannot be empty'
      using errcode = '22023';
  end if;

  v_description :=
    nullif(
      pg_catalog.btrim(p_description),
      ''
    );


  -- ==========================================================
  -- PLAZO
  -- ==========================================================

  if p_standard_lead_time_minutes is not null
     and p_standard_lead_time_minutes < 0 then
    raise exception 'standard lead time cannot be negative'
      using errcode = '22023';
  end if;

  v_lead_time := p_standard_lead_time_minutes;


  -- ==========================================================
  -- CATEGORÍA
  --
  -- null = servicio sin categoría.
  -- Si existe debe pertenecer al mismo tenant.
  -- ==========================================================

  if p_category_id is not null then

    perform 1
    from public.service_categories sc
    where sc.id = p_category_id
      and sc.tenant_id = p_tenant_id;

    if not found then
      raise exception 'invalid service category for current tenant'
        using errcode = '22023';
    end if;

  end if;


  -- ==========================================================
  -- ORDEN
  -- ==========================================================

  v_sort_order :=
    greatest(
      coalesce(p_sort_order, 0),
      0
    );


  -- ==========================================================
  -- UPDATE
  -- ==========================================================

  update public.services
  set
    category_id = p_category_id,
    name = v_name,
    description = v_description,
    standard_lead_time_minutes = v_lead_time,

    requires_file =
      coalesce(p_requires_file, false),

    requires_design =
      coalesce(p_requires_design, false),

    requires_quote =
      coalesce(p_requires_quote, false),

    active =
      coalesce(p_active, true),

    sort_order = v_sort_order,

    updated_at = pg_catalog.now()

  where id = p_service_id
    and tenant_id = p_tenant_id

  returning *
  into v_service;


  return pg_catalog.jsonb_build_object(
    'service',
    pg_catalog.to_jsonb(v_service) - 'metadata'
  );

end;
$function$;

CREATE OR REPLACE FUNCTION public.update_team_member (
  p_team_member_id     uuid,
  p_name               text,
  p_job_title          text,
  p_department         text,
  p_active             boolean,
  p_can_receive_orders boolean,
  p_tenant_id          uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_member public.team_members%rowtype;

  v_name text;
  v_job_title text;
  v_department text;
begin

  -- ==========================================================
  -- AUTH
  -- ==========================================================

  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;


  -- ==========================================================
  -- PERMISOS
  --
  -- Gestión de equipo:
  -- owner / admin / manager
  --
  -- NO modifica memberships ni Auth.
  -- ==========================================================

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner','admin','manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;


  -- ==========================================================
  -- LOCALIZAR MIEMBRO
  -- Siempre id + tenant_id
  -- ==========================================================

  select *
  into v_member
  from public.team_members tm
  where tm.id = p_team_member_id
    and tm.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'team member not found'
      using errcode = 'P0002';
  end if;


  -- ==========================================================
  -- NOMBRE
  -- ==========================================================

  v_name :=
    nullif(
      pg_catalog.btrim(p_name),
      ''
    );

  if v_name is null then
    raise exception 'team member name cannot be empty'
      using errcode = '22023';
  end if;


  -- ==========================================================
  -- ROL OPERATIVO / ÁREA
  --
  -- job_title NO es memberships.role.
  -- ==========================================================

  v_job_title :=
    nullif(
      pg_catalog.btrim(p_job_title),
      ''
    );

  v_department :=
    nullif(
      pg_catalog.btrim(p_department),
      ''
    );


  -- ==========================================================
  -- UPDATE OPERATIVO
  --
  -- Deliberadamente NO toca:
  -- user_id
  -- email
  -- phone
  -- notes
  -- metadata
  -- memberships
  -- ==========================================================

  update public.team_members
  set
    name = v_name,
    job_title = v_job_title,
    department = v_department,

    active =
      coalesce(p_active, true),

    can_receive_orders =
      coalesce(p_can_receive_orders, true),

    updated_at = pg_catalog.now()

  where id = p_team_member_id
    and tenant_id = p_tenant_id

  returning *
  into v_member;


  return pg_catalog.jsonb_build_object(
    'member',
    pg_catalog.jsonb_build_object(
      'id', v_member.id,
      'name', v_member.name,
      'email', v_member.email,
      'phone', v_member.phone,
      'job_title', v_member.job_title,
      'department', v_member.department,
      'active', v_member.active,
      'can_receive_orders', v_member.can_receive_orders,
      'notes', v_member.notes,
      'created_at', v_member.created_at,
      'updated_at', v_member.updated_at
    )
  );

end;
$function$;

ALTER TABLE "public"."clients"
  ADD CONSTRAINT "clients_customer_type_fk" FOREIGN KEY (tenant_id, customer_type_id) REFERENCES public.customer_types(tenant_id, id);

ALTER TABLE "public"."activity_log"
  ADD CONSTRAINT "activity_log_user_membership_fk" FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT;

ALTER TABLE "public"."clients"
  ADD CONSTRAINT "clients_created_by_membership_fk" FOREIGN KEY (tenant_id, created_by) REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_client_fk" FOREIGN KEY (tenant_id, client_id) REFERENCES public.clients(tenant_id, id);

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_context_fk" FOREIGN KEY (tenant_id, order_context_id) REFERENCES public.order_contexts(tenant_id, id);

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_created_by_membership_fk" FOREIGN KEY (tenant_id, created_by) REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_customer_notified_by_membership_fk" FOREIGN KEY (tenant_id, customer_notified_by) REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_delivery_method_fk" FOREIGN KEY (tenant_id, delivery_method_id) REFERENCES public.delivery_methods(tenant_id, id);

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_entry_channel_fk" FOREIGN KEY (tenant_id, entry_channel_id) REFERENCES public.entry_channels(tenant_id, id);

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_file_status_fk" FOREIGN KEY (tenant_id, file_status_id) REFERENCES public.file_statuses(tenant_id, id);

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_status_fk" FOREIGN KEY (tenant_id, status_id) REFERENCES public.order_statuses(tenant_id, id);

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_payment_status_fk" FOREIGN KEY (tenant_id, payment_status_id) REFERENCES public.payment_statuses(tenant_id, id);

ALTER TABLE "public"."plan_features"
  ADD CONSTRAINT "plan_features_feature_id_fkey" FOREIGN KEY (feature_id) REFERENCES public.features(id) ON DELETE CASCADE;

ALTER TABLE "public"."plan_features"
  ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES public.plans(id) ON DELETE CASCADE;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."memberships"
  ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_quote_status_fk" FOREIGN KEY (tenant_id, quote_status_id) REFERENCES public.quote_statuses(tenant_id, id);

ALTER TABLE "public"."services"
  ADD CONSTRAINT "services_category_fk" FOREIGN KEY (tenant_id, category_id) REFERENCES public.service_categories(tenant_id, id);

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_service_fk" FOREIGN KEY (tenant_id, service_id) REFERENCES public.services(tenant_id, id);

ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY (plan_id) REFERENCES public.plans(id);

ALTER TABLE "public"."activity_log"
  ADD CONSTRAINT "activity_log_team_member_fk" FOREIGN KEY (tenant_id, team_member_id) REFERENCES public.team_members(tenant_id, id);

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_team_member_fk" FOREIGN KEY (tenant_id, assigned_team_member_id) REFERENCES public.team_members(tenant_id, id);

ALTER TABLE "public"."team_members"
  ADD CONSTRAINT "team_members_user_membership_fk" FOREIGN KEY (tenant_id, user_id) REFERENCES public.memberships(tenant_id, user_id) ON DELETE RESTRICT;

ALTER TABLE "public"."activity_log"
  ADD CONSTRAINT "activity_log_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."clients"
  ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."customer_types"
  ADD CONSTRAINT "customer_types_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."delivery_methods"
  ADD CONSTRAINT "delivery_methods_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."entry_channels"
  ADD CONSTRAINT "entry_channels_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."file_statuses"
  ADD CONSTRAINT "file_statuses_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."memberships"
  ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."order_contexts"
  ADD CONSTRAINT "order_contexts_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."order_number_counters"
  ADD CONSTRAINT "order_number_counters_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."order_statuses"
  ADD CONSTRAINT "order_statuses_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."orders"
  ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."payment_statuses"
  ADD CONSTRAINT "payment_statuses_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."quote_statuses"
  ADD CONSTRAINT "quote_statuses_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."service_categories"
  ADD CONSTRAINT "service_categories_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."services"
  ADD CONSTRAINT "services_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."subscriptions"
  ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."team_members"
  ADD CONSTRAINT "team_members_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."tenant_domains"
  ADD CONSTRAINT "tenant_domains_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE "public"."tenant_settings"
  ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

CREATE INDEX activity_log_entity_idx ON public.activity_log USING btree (tenant_id, entity_type, entity_id, created_at DESC);

CREATE INDEX activity_log_tenant_created_idx ON public.activity_log USING btree (tenant_id, created_at DESC);

CREATE INDEX activity_log_user_idx ON public.activity_log USING btree (tenant_id, user_id, created_at DESC);

CREATE INDEX clients_company_name_trgm_idx ON public.clients USING gin (lower(company_name) public.gin_trgm_ops);

CREATE INDEX clients_contact_name_trgm_idx ON public.clients USING gin (lower(contact_name) public.gin_trgm_ops);

CREATE INDEX clients_customer_type_idx ON public.clients USING btree (tenant_id, customer_type_id);

CREATE INDEX clients_email_trgm_idx ON public.clients USING gin (lower(email) public.gin_trgm_ops);

CREATE INDEX clients_name_trgm_idx ON public.clients USING gin (lower(name) public.gin_trgm_ops);

CREATE INDEX clients_notes_trgm_idx ON public.clients USING gin (lower(notes) public.gin_trgm_ops);

CREATE INDEX clients_phone_trgm_idx ON public.clients USING gin (phone public.gin_trgm_ops);

CREATE INDEX clients_tax_id_trgm_idx ON public.clients USING gin (upper(tax_id) public.gin_trgm_ops);

CREATE INDEX clients_tenant_active_idx ON public.clients USING btree (tenant_id, active);

CREATE INDEX clients_tenant_company_name_idx ON public.clients USING btree (tenant_id, lower(company_name));

CREATE INDEX clients_tenant_contact_name_idx ON public.clients USING btree (tenant_id, lower(contact_name));

CREATE INDEX clients_tenant_name_idx ON public.clients USING btree (tenant_id, name);

CREATE INDEX customer_types_active_sort_idx ON public.customer_types USING btree (tenant_id, active, sort_order);

CREATE INDEX delivery_methods_active_sort_idx ON public.delivery_methods USING btree (tenant_id, active, sort_order);

CREATE INDEX entry_channels_active_sort_idx ON public.entry_channels USING btree (tenant_id, active, sort_order);

CREATE INDEX file_statuses_active_sort_idx ON public.file_statuses USING btree (tenant_id, active, sort_order);

CREATE INDEX memberships_tenant_active_idx ON public.memberships USING btree (tenant_id, active);

CREATE INDEX memberships_user_active_idx ON public.memberships USING btree (user_id, active);

CREATE INDEX memberships_user_tenant_active_idx ON public.memberships USING btree (user_id, tenant_id)
  WHERE (active = true);

CREATE INDEX order_contexts_active_sort_idx ON public.order_contexts USING btree (tenant_id, active, sort_order);

CREATE INDEX order_statuses_active_sort_idx ON public.order_statuses USING btree (tenant_id, active, sort_order);

CREATE UNIQUE INDEX order_statuses_one_initial_idx ON public.order_statuses USING btree (tenant_id)
  WHERE (is_initial = true);

CREATE INDEX orders_assigned_member_idx ON public.orders USING btree (tenant_id, assigned_team_member_id)
  WHERE (archived_at IS NULL);

CREATE INDEX orders_client_idx ON public.orders USING btree (tenant_id, client_id);

CREATE INDEX orders_created_at_idx ON public.orders USING btree (tenant_id, created_at DESC);

CREATE INDEX orders_created_by_idx ON public.orders USING btree (tenant_id, created_by);

CREATE INDEX orders_customer_notified_by_idx ON public.orders USING btree (tenant_id, customer_notified_by)
  WHERE (customer_notified_by IS NOT NULL);

CREATE INDEX orders_due_at_idx ON public.orders USING btree (tenant_id, due_at)
  WHERE (archived_at IS NULL);

CREATE INDEX orders_service_idx ON public.orders USING btree (tenant_id, service_id)
  WHERE (archived_at IS NULL);

CREATE INDEX orders_status_idx ON public.orders USING btree (tenant_id, status_id);

CREATE UNIQUE INDEX orders_tenant_reference_uidx ON public.orders USING btree (tenant_id, reference);

CREATE INDEX payment_statuses_active_sort_idx ON public.payment_statuses USING btree (tenant_id, active, sort_order);

CREATE INDEX plan_features_feature_idx ON public.plan_features USING btree (feature_id);

CREATE INDEX plans_active_sort_idx ON public.plans USING btree (active, sort_order);

CREATE INDEX quote_statuses_active_sort_idx ON public.quote_statuses USING btree (tenant_id, active, sort_order);

CREATE INDEX service_categories_active_sort_idx ON public.service_categories USING btree (tenant_id, active, sort_order);

CREATE INDEX services_category_idx ON public.services USING btree (tenant_id, category_id);

CREATE INDEX services_tenant_active_idx ON public.services USING btree (tenant_id, active);

CREATE UNIQUE INDEX subscriptions_one_current_per_tenant_idx ON public.subscriptions USING btree (tenant_id)
  WHERE (status = ANY (ARRAY['trialing'::text, 'active'::text, 'past_due'::text]));

CREATE INDEX subscriptions_plan_idx ON public.subscriptions USING btree (plan_id);

CREATE INDEX subscriptions_status_idx ON public.subscriptions USING btree (status);

CREATE INDEX subscriptions_tenant_idx ON public.subscriptions USING btree (tenant_id);

CREATE INDEX team_members_assignable_idx ON public.team_members USING btree (tenant_id, active, can_receive_orders)
  WHERE ((active = true) AND (can_receive_orders = true));

CREATE INDEX team_members_tenant_active_idx ON public.team_members USING btree (tenant_id, active);

CREATE INDEX team_members_user_idx ON public.team_members USING btree (user_id);

CREATE UNIQUE INDEX tenant_domains_one_primary_idx ON public.tenant_domains USING btree (tenant_id)
  WHERE (is_primary = true);

CREATE INDEX tenant_domains_tenant_idx ON public.tenant_domains USING btree (tenant_id);

CREATE INDEX tenants_active_idx ON public.tenants USING btree (active)
  WHERE (active = true);

CREATE TRIGGER clients_set_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_clients_activity_log
  AFTER INSERT OR UPDATE OF customer_type_id, name, contact_name, company_name, tax_id, email, phone, notes ON public.clients
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_activity_log_client();

CREATE TRIGGER customer_types_set_updated_at
  BEFORE UPDATE ON public.customer_types
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER delivery_methods_set_updated_at
  BEFORE UPDATE ON public.delivery_methods
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER entry_channels_set_updated_at
  BEFORE UPDATE ON public.entry_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER features_set_updated_at
  BEFORE UPDATE ON public.features
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER file_statuses_set_updated_at
  BEFORE UPDATE ON public.file_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER memberships_set_updated_at
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER order_contexts_set_updated_at
  BEFORE UPDATE ON public.order_contexts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER order_statuses_set_updated_at
  BEFORE UPDATE ON public.order_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER orders_assign_reference_before_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_assign_order_reference();

CREATE TRIGGER orders_set_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_orders_activity_log_client
  AFTER UPDATE OF client_id ON public.orders
  FOR EACH ROW
  WHEN ((old.client_id IS DISTINCT FROM new.client_id))
  EXECUTE FUNCTION public.tg_activity_log_order_client();

CREATE TRIGGER trg_orders_activity_log_content
  AFTER UPDATE OF title, description, notes ON public.orders
  FOR EACH ROW
  WHEN (((old.title IS DISTINCT FROM new.title) OR (old.description IS DISTINCT FROM new.description) OR (old.notes IS DISTINCT FROM new.notes)))
  EXECUTE FUNCTION public.tg_activity_log_order_content();

CREATE TRIGGER trg_orders_activity_log_created
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_activity_log_order_created();

CREATE TRIGGER trg_orders_activity_log_details
  AFTER UPDATE OF priority, service_id, entry_channel_id, assigned_team_member_id, order_context_id, due_at ON public.orders
  FOR EACH ROW
  WHEN
    (((old.priority IS DISTINCT FROM new.priority) OR (old.service_id IS DISTINCT FROM new.service_id) OR (old.entry_channel_id IS DISTINCT FROM new.entry_channel_id) OR
    (old.assigned_team_member_id IS DISTINCT FROM new.assigned_team_member_id) OR (old.order_context_id IS DISTINCT FROM new.order_context_id) OR
    (old.due_at IS DISTINCT FROM new.due_at)))
  EXECUTE FUNCTION public.tg_activity_log_order_details();

CREATE TRIGGER trg_orders_activity_log_management
  AFTER UPDATE OF file_status_id, quote_status_id, payment_status_id, delivery_method_id ON public.orders
  FOR EACH ROW
  WHEN
    (((old.file_status_id IS DISTINCT FROM new.file_status_id) OR (old.quote_status_id IS DISTINCT FROM new.quote_status_id) OR (old.payment_status_id IS DISTINCT FROM
    new.payment_status_id) OR (old.delivery_method_id IS DISTINCT FROM new.delivery_method_id)))
  EXECUTE FUNCTION public.tg_activity_log_order_management();

CREATE TRIGGER trg_orders_activity_log_notification
  AFTER UPDATE OF customer_notification_status ON public.orders
  FOR EACH ROW
  WHEN ((old.customer_notification_status IS DISTINCT FROM new.customer_notification_status))
  EXECUTE FUNCTION public.tg_activity_log_order_notification();

CREATE TRIGGER trg_orders_activity_log_status
  AFTER UPDATE OF status_id ON public.orders
  FOR EACH ROW
  WHEN ((old.status_id IS DISTINCT FROM new.status_id))
  EXECUTE FUNCTION public.tg_activity_log_order_status();

CREATE TRIGGER payment_statuses_set_updated_at
  BEFORE UPDATE ON public.payment_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER plan_features_set_updated_at
  BEFORE UPDATE ON public.plan_features
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER plans_set_updated_at
  BEFORE UPDATE ON public.plans
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER quote_statuses_set_updated_at
  BEFORE UPDATE ON public.quote_statuses
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER service_categories_set_updated_at
  BEFORE UPDATE ON public.service_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER services_set_updated_at
  BEFORE UPDATE ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_services_activity_log
  AFTER INSERT OR UPDATE ON public.services
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_activity_log_service();

CREATE TRIGGER subscriptions_set_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER team_members_set_updated_at
  BEFORE UPDATE ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_team_members_activity_log
  AFTER INSERT OR UPDATE ON public.team_members
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_activity_log_team_member();

CREATE TRIGGER tenant_domains_set_updated_at
  BEFORE UPDATE ON public.tenant_domains
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tenant_settings_set_updated_at
  BEFORE UPDATE ON public.tenant_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER tenants_set_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE POLICY "activity_log_select_member" ON "public"."activity_log"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "clients_insert_operator" ON "public"."clients"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'staff'::text]));

CREATE POLICY "clients_select_member" ON "public"."clients"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "clients_update_operator" ON "public"."clients"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'staff'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'staff'::text]));

CREATE POLICY "customer_types_insert_management" ON "public"."customer_types"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "customer_types_select_member" ON "public"."customer_types"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "customer_types_update_management" ON "public"."customer_types"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "delivery_methods_insert_management" ON "public"."delivery_methods"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "delivery_methods_select_member" ON "public"."delivery_methods"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "delivery_methods_update_management" ON "public"."delivery_methods"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "entry_channels_insert_management" ON "public"."entry_channels"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "entry_channels_select_member" ON "public"."entry_channels"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "entry_channels_update_management" ON "public"."entry_channels"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "features_select_authenticated" ON "public"."features"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "file_statuses_insert_management" ON "public"."file_statuses"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "file_statuses_select_member" ON "public"."file_statuses"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "file_statuses_update_management" ON "public"."file_statuses"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "memberships_insert_owner_admin" ON "public"."memberships"
  FOR INSERT
  TO "authenticated"
  WITH
    CHECK
    ((public.has_tenant_role(tenant_id, ARRAY['owner'::text]) OR (public.has_tenant_role(tenant_id, ARRAY['admin'::text]) AND (role = ANY (ARRAY['manager'::text, 'staff'::text,
    'viewer'::text])))));

CREATE POLICY "memberships_select_same_tenant" ON "public"."memberships"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "memberships_update_owner_admin" ON "public"."memberships"
  FOR UPDATE
  TO "authenticated"
  USING
    ((public.has_tenant_role(tenant_id, ARRAY['owner'::text]) OR (public.has_tenant_role(tenant_id, ARRAY['admin'::text]) AND (ROLE = ANY (ARRAY['manager'::text, 'staff'::text,
    'viewer'::text])))))
  WITH
    CHECK
    ((public.has_tenant_role(tenant_id, ARRAY['owner'::text]) OR (public.has_tenant_role(tenant_id, ARRAY['admin'::text]) AND (role = ANY (ARRAY['manager'::text, 'staff'::text,
    'viewer'::text])))));

CREATE POLICY "order_contexts_insert_management" ON "public"."order_contexts"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "order_contexts_select_member" ON "public"."order_contexts"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "order_contexts_update_management" ON "public"."order_contexts"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "order_statuses_insert_management" ON "public"."order_statuses"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "order_statuses_select_member" ON "public"."order_statuses"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "order_statuses_update_management" ON "public"."order_statuses"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "orders_insert_operator" ON "public"."orders"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'staff'::text]));

CREATE POLICY "orders_select_member" ON "public"."orders"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "orders_update_operator" ON "public"."orders"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'staff'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text, 'staff'::text]));

CREATE POLICY "payment_statuses_insert_management" ON "public"."payment_statuses"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "payment_statuses_select_member" ON "public"."payment_statuses"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "payment_statuses_update_management" ON "public"."payment_statuses"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "plan_features_select_authenticated" ON "public"."plan_features"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "plans_select_authenticated" ON "public"."plans"
  FOR SELECT
  TO "authenticated"
  USING (true);

CREATE POLICY "profiles_insert_self" ON "public"."profiles"
  FOR INSERT
  TO "authenticated"
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "profiles_select_same_tenant" ON "public"."profiles"
  FOR SELECT
  TO "authenticated"
  USING (((id = auth.uid()) OR public.shares_tenant_with(id)));

CREATE POLICY "profiles_update_self" ON "public"."profiles"
  FOR UPDATE
  TO "authenticated"
  USING ((id = auth.uid()))
  WITH CHECK ((id = auth.uid()));

CREATE POLICY "quote_statuses_insert_management" ON "public"."quote_statuses"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "quote_statuses_select_member" ON "public"."quote_statuses"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "quote_statuses_update_management" ON "public"."quote_statuses"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "service_categories_insert_management" ON "public"."service_categories"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "service_categories_select_member" ON "public"."service_categories"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "service_categories_update_management" ON "public"."service_categories"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "services_insert_management" ON "public"."services"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "services_select_member" ON "public"."services"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "services_update_management" ON "public"."services"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "subscriptions_select_owner_admin" ON "public"."subscriptions"
  FOR SELECT
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text]));

CREATE POLICY "team_members_insert_management" ON "public"."team_members"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "team_members_select_member" ON "public"."team_members"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "team_members_update_management" ON "public"."team_members"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text, 'manager'::text]));

CREATE POLICY "tenant_domains_delete_owner_admin" ON "public"."tenant_domains"
  FOR DELETE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text]));

CREATE POLICY "tenant_domains_insert_owner_admin" ON "public"."tenant_domains"
  FOR INSERT
  TO "authenticated"
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text]));

CREATE POLICY "tenant_domains_select_member" ON "public"."tenant_domains"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "tenant_domains_update_owner_admin" ON "public"."tenant_domains"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text]));

CREATE POLICY "tenant_settings_select_member" ON "public"."tenant_settings"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(tenant_id));

CREATE POLICY "tenant_settings_update_owner_admin" ON "public"."tenant_settings"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (public.has_tenant_role(tenant_id, ARRAY['owner'::text, 'admin'::text]));

CREATE POLICY "tenants_select_member" ON "public"."tenants"
  FOR SELECT
  TO "authenticated"
  USING (public.is_tenant_member(id));

CREATE POLICY "tenants_update_owner_admin" ON "public"."tenants"
  FOR UPDATE
  TO "authenticated"
  USING (public.has_tenant_role(id, ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (public.has_tenant_role(id, ARRAY['owner'::text, 'admin'::text]));

CREATE EVENT TRIGGER "ensure_rls"
  ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION "public"."rls_auto_enable"();

COMMENT ON EXTENSION "pg_trgm" IS 'text similarity measurement and index searching based on trigrams';

COMMENT ON FUNCTION "public"."change_order_status"(uuid, uuid, uuid) IS 'INVOKER. p_tenant_id solo desde getCurrentContext() en servidor. Log vía trigger, misma transacción.';

COMMENT ON FUNCTION "public"."tg_activity_log_order_status"() IS 'DEFINER acotado: INSERT en activity_log al cambiar orders.status_id. tenant_id = NEW.tenant_id. user_id = auth.uid().';

COMMENT ON FUNCTION "public"."tg_assign_order_reference"() IS 'BEFORE INSERT: asigna orders.reference = PREFIX-NNNN por tenant. Sobrescribe cualquier reference del cliente. tenant_id = NEW.tenant_id.';

COMMENT ON TABLE "public"."activity_log" IS 'Historial y auditoría de acciones por tenant.';

COMMENT ON TABLE "public"."clients" IS 'Clientes pertenecientes a cada tenant.';

COMMENT ON TABLE "public"."customer_types" IS 'Tipos de cliente configurables por tenant.';

COMMENT ON TABLE "public"."delivery_methods" IS 'Formas configurables de entrega asociadas a pedidos.';

COMMENT ON TABLE "public"."entry_channels" IS 'Canales configurables de entrada de pedidos.';

COMMENT ON TABLE "public"."features" IS 'Catálogo global de funcionalidades monetizables o limitables.';

COMMENT ON TABLE "public"."file_statuses" IS 'Estados configurables de archivos asociados a pedidos.';

COMMENT ON TABLE "public"."memberships" IS 'Acceso y rol de un usuario dentro de un tenant.';

COMMENT ON TABLE "public"."order_contexts" IS 'Contextos o campañas configurables asociados a pedidos.';

COMMENT ON TABLE "public"."order_number_counters" IS 'Contador transaccional de references de pedidos. Un row por tenant. No expuesto a PostgREST.';

COMMENT ON TABLE "public"."order_statuses" IS 'Estados configurables del flujo de pedidos.';

COMMENT ON TABLE "public"."orders" IS 'Núcleo operativo de pedidos / trabajos de Copyflow.';

COMMENT ON TABLE "public"."payment_statuses" IS 'Estados configurables de pago asociados a pedidos.';

COMMENT ON TABLE "public"."plan_features" IS 'Relación entre planes y funcionalidades habilitadas o limitadas.';

COMMENT ON TABLE "public"."plans" IS 'Planes comerciales globales de Copyflow.';

COMMENT ON TABLE "public"."profiles" IS 'Perfil global vinculado 1:1 con Supabase Auth.';

COMMENT ON TABLE "public"."quote_statuses" IS 'Estados configurables de presupuesto asociados a pedidos.';

COMMENT ON TABLE "public"."service_categories" IS 'Categorías configurables de servicios por tenant.';

COMMENT ON TABLE "public"."services" IS 'Servicios ofrecidos por el tenant.';

COMMENT ON TABLE "public"."subscriptions" IS 'Historial de suscripciones comerciales por tenant.';

COMMENT ON TABLE "public"."team_members" IS 'Equipo operativo del tenant; puede incluir miembros sin acceso a la aplicación.';

COMMENT ON TABLE "public"."tenant_domains" IS 'Subdominios y dominios personalizados asociados a tenants.';

COMMENT ON TABLE "public"."tenant_settings" IS 'Configuración general y branding de cada tenant.';

COMMENT ON TABLE "public"."tenants" IS 'Organizaciones / tenants de Copyflow.';

REVOKE ALL ON FUNCTION "public"."assign_order_client"(uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."assign_order_client"(uuid, uuid, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."change_order_content"(uuid, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."change_order_content"(uuid, text, text, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."change_order_details"(uuid, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."change_order_details"(uuid, text, text, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."change_order_management"(uuid, text, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."change_order_management"(uuid, text, uuid, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."change_order_notification_status"(uuid, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."change_order_notification_status"(uuid, text, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."change_order_status"(uuid, uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."change_order_status"(uuid, uuid, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."check_client_duplicates"(uuid, text, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."check_client_duplicates"(uuid, text, text, text, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."create_client"(uuid, text, text, text, text, text, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_client"(uuid, text, text, text, text, text, text, text, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."create_client_and_assign_order"(uuid, uuid, text, text, text, text, text, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_client_and_assign_order"(uuid, uuid, text, text, text, text, text, text, text, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."create_service"(uuid, text, text, integer, boolean, boolean, boolean, boolean, integer, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."create_service"(uuid, text, text, integer, boolean, boolean, boolean, boolean, integer, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."has_tenant_role"(uuid, text[]) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."has_tenant_role"(uuid, text[]) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."is_tenant_member"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."is_tenant_member"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."list_activity_log"(uuid, text, text, uuid, timestamp WITH time zone, timestamp WITH time zone, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_activity_log"(uuid, text, text, uuid, timestamp WITH time zone, timestamp WITH time zone, integer, integer) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."list_clients"(uuid, text, uuid, boolean, integer, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_clients"(uuid, text, uuid, boolean, integer, integer) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."list_services"(uuid, text, uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_services"(uuid, text, uuid, boolean) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."list_team_members"(uuid, text, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."list_team_members"(uuid, text, boolean) TO "authenticated", "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_client_email"(text) TO PUBLIC, "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_client_phone"(text) TO PUBLIC, "postgres";

GRANT EXECUTE ON FUNCTION "public"."normalize_client_tax_id"(text) TO PUBLIC, "postgres";

REVOKE ALL ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."rls_auto_enable"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."search_clients"(uuid, text, integer) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."search_clients"(uuid, text, integer) TO "authenticated", "postgres";

GRANT EXECUTE ON FUNCTION "public"."set_updated_at"() TO PUBLIC, "postgres";

REVOKE ALL ON FUNCTION "public"."shares_tenant_with"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."shares_tenant_with"(uuid) TO "authenticated", "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_client"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_client"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_order_client"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_order_client"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_order_content"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_order_content"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_order_created"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_order_created"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_order_details"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_order_details"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_order_management"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_order_management"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_order_notification"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_order_notification"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_order_status"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_order_status"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_service"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_service"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_activity_log_team_member"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_activity_log_team_member"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."tg_assign_order_reference"() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."tg_assign_order_reference"() TO "postgres";

REVOKE ALL ON FUNCTION "public"."update_client"(uuid, uuid, text, text, text, text, text, text, text, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."update_client"(uuid, uuid, text, text, text, text, text, text, text, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."update_service"(uuid, uuid, text, text, integer, boolean, boolean, boolean, boolean, integer, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."update_service"(uuid, uuid, text, text, integer, boolean, boolean, boolean, boolean, integer, uuid) TO "authenticated", "postgres";

REVOKE ALL ON FUNCTION "public"."update_team_member"(uuid, text, text, text, boolean, boolean, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."update_team_member"(uuid, text, text, text, boolean, boolean, uuid) TO "authenticated", "postgres";

REVOKE ALL ON TABLE "public"."activity_log" FROM "authenticated";

GRANT MAINTAIN, SELECT ON TABLE "public"."activity_log" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."activity_log" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clients" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."clients" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."customer_types" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."customer_types" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."delivery_methods" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."delivery_methods" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."entry_channels" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."entry_channels" TO "postgres", "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."features" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."features" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."file_statuses" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."file_statuses" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."memberships" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."memberships" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."order_contexts" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."order_contexts" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."order_number_counters" TO "postgres";

GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLE "public"."order_number_counters" TO "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."order_statuses" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."order_statuses" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."orders" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."orders" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."payment_statuses" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."payment_statuses" TO "postgres", "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."plan_features" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plan_features" TO "postgres", "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."plans" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."plans" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."quote_statuses" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."quote_statuses" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."service_categories" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."service_categories" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."services" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."services" TO "postgres", "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."subscriptions" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."subscriptions" TO "postgres", "service_role";

GRANT INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_members" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."team_members" TO "postgres", "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tenant_domains" TO "authenticated", "postgres", "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tenant_settings" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tenant_settings" TO "postgres", "service_role";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tenants" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."tenants" TO "postgres", "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "anon";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT MAINTAIN, REFERENCES, TRIGGER, TRUNCATE ON TABLES TO "service_role";

CREATE UNIQUE INDEX clients_tenant_email_unique ON public.clients USING btree (tenant_id, public.normalize_client_email(email))
  WHERE (public.normalize_client_email(email) IS NOT NULL);

CREATE UNIQUE INDEX clients_tenant_phone_unique ON public.clients USING btree (tenant_id, public.normalize_client_phone(phone))
  WHERE (public.normalize_client_phone(phone) IS NOT NULL);

CREATE UNIQUE INDEX clients_tenant_tax_id_unique ON public.clients USING btree (tenant_id, public.normalize_client_tax_id(tax_id))
  WHERE (public.normalize_client_tax_id(tax_id) IS NOT NULL);

