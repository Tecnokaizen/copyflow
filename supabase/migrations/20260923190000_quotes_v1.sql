-- Quotes V1
-- Independent quotes aggregate. Does not drop or rewrite orders.quote_status_id.
-- quotes is a commercial feature and is NOT attached to plans mvp or basic.
-- Reference counters are separate from order_number_counters.
-- No tenant trigger: existing tests insert quote_statuses.draft themselves.
-- Future organizations receive the catalog from create_organization.

begin;

insert into public.features (id, code, name, description)
values (
  '31000000-0000-4000-8000-000000000006',
  'quotes',
  'Presupuestos',
  'Registro, seguimiento y conversión de presupuestos.'
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = pg_catalog.now();

create table public.tenant_feature_overrides (
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  feature_id uuid not null references public.features (id) on delete cascade,
  enabled boolean not null,
  limit_value bigint,
  created_at timestamp with time zone not null default pg_catalog.now(),
  updated_at timestamp with time zone not null default pg_catalog.now(),
  constraint tenant_feature_overrides_pkey primary key (tenant_id, feature_id),
  constraint tenant_feature_overrides_limit_value_check
    check (limit_value is null or limit_value >= 0)
);

alter table public.tenant_feature_overrides enable row level security;

comment on table public.tenant_feature_overrides is
  'Explicit tenant feature gate. Overrides the plan. No client writes.';

create or replace function public.tenant_has_feature (
  p_tenant_id uuid,
  p_code text
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_role text := coalesce(auth.role(), '');
  v_enabled boolean;
begin
  -- authenticated may only resolve tenants where they have an active membership.
  -- service_role and a direct postgres/supabase_admin session keep operational access.
  -- A JWT role of authenticated is never treated as operational, even if session_user is postgres.
  if v_role = 'service_role'
     or (
       v_role = ''
       and session_user in ('postgres', 'supabase_admin')
     )
  then
    null;
  elsif v_role = 'authenticated'
     and exists (
       select 1
       from public.memberships m
       where m.tenant_id = p_tenant_id
         and m.user_id = auth.uid()
         and m.active is true
     )
  then
    null;
  else
    return false;
  end if;

  select o.enabled into v_enabled
  from public.tenant_feature_overrides o
  join public.features f on f.id = o.feature_id
  where o.tenant_id = p_tenant_id
    and f.code = p_code;

  if found then
    return coalesce(v_enabled, false);
  end if;

  -- Plan fallback does not filter subscriptions.livemode.
  -- Do not use this resolver for Stripe-sensitive features until that mode is part of the rule.
  -- quotes is not attached to Basic or mvp, so this fallback does not enable it.
  select pf.enabled into v_enabled
  from public.subscriptions s
  join public.plan_features pf on pf.plan_id = s.plan_id
  join public.features f on f.id = pf.feature_id
  where s.tenant_id = p_tenant_id
    and f.code = p_code
    and s.status in ('active', 'trialing')
  order by s.created_at desc
  limit 1;

  return coalesce(v_enabled, false);
end;
$function$;

comment on function public.tenant_has_feature(uuid, text) is
  'DEFINER read. authenticated: false without an active membership on p_tenant_id. service_role and postgres/supabase_admin: operational. Resolution: override, then active/trialing plan feature, else false. Plan fallback ignores subscriptions.livemode; do not use it for Stripe-sensitive features. quotes is not on Basic or mvp.';

revoke all on function public.tenant_has_feature(uuid, text) from public;
grant execute on function public.tenant_has_feature(uuid, text) to authenticated, service_role;

create or replace function public.set_tenant_feature (
  p_slug text,
  p_code text,
  p_enabled boolean,
  p_limit bigint default null
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_tenant uuid;
  v_feature uuid;
begin
  if current_user not in ('postgres', 'supabase_admin')
     and coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  select t.id into v_tenant
  from public.tenants t
  where t.slug = p_slug;

  if v_tenant is null then
    raise exception 'tenant not found'
      using errcode = 'P0002';
  end if;

  select f.id into v_feature
  from public.features f
  where f.code = p_code;

  if v_feature is null then
    raise exception 'feature not found'
      using errcode = 'P0002';
  end if;

  insert into public.tenant_feature_overrides (
    tenant_id, feature_id, enabled, limit_value
  ) values (
    v_tenant, v_feature, p_enabled, p_limit
  )
  on conflict (tenant_id, feature_id) do update
  set
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    updated_at = pg_catalog.now();
end;
$function$;

comment on function public.set_tenant_feature(text, text, boolean, bigint) is
  'Idempotent operator override. service_role or database owner only.';

revoke all on function public.set_tenant_feature(text, text, boolean, bigint) from public;
grant execute on function public.set_tenant_feature(text, text, boolean, bigint) to service_role;

create or replace function public.seed_quote_statuses (
  p_tenant_id uuid
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  insert into public.quote_statuses (
    tenant_id, name, code, active, sort_order
  ) values
    (p_tenant_id, 'Borrador', 'draft', true, 10),
    (p_tenant_id, 'Pendiente', 'pending', true, 20),
    (p_tenant_id, 'Aceptado', 'accepted', true, 30),
    (p_tenant_id, 'Rechazado', 'rejected', true, 40)
  on conflict (tenant_id, code) do nothing;
end;
$function$;

comment on function public.seed_quote_statuses(uuid) is
  'Idempotent quote status catalog. Does not rename existing codes.';

revoke all on function public.seed_quote_statuses(uuid) from public;

do $backfill$
declare
  v_tenant uuid;
begin
  for v_tenant in select t.id from public.tenants t loop
    perform public.seed_quote_statuses(v_tenant);
  end loop;
end;
$backfill$;

create table public.quote_number_counters (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  last_number integer not null default 0,
  constraint quote_number_counters_last_number_check check (last_number >= 0)
);

alter table public.quote_number_counters enable row level security;

comment on table public.quote_number_counters is
  'Per-tenant quote reference counter. Distinct from order_number_counters.';

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  reference text not null,
  client_id uuid,
  service_id uuid,
  assigned_team_member_id uuid,
  status_id uuid not null,
  title text,
  description text not null,
  valid_until date,
  notes text,
  converted_order_id uuid,
  created_by uuid,
  created_at timestamp with time zone not null default pg_catalog.now(),
  updated_at timestamp with time zone not null default pg_catalog.now(),
  archived_at timestamp with time zone,
  row_version bigint not null default 0,
  constraint quotes_tenant_id_id_unique unique (tenant_id, id),
  constraint quotes_unique_reference unique (tenant_id, reference),
  constraint quotes_description_not_blank
    check (pg_catalog.char_length(pg_catalog.btrim(description)) > 0),
  constraint quotes_client_fk
    foreign key (tenant_id, client_id)
    references public.clients (tenant_id, id),
  constraint quotes_service_fk
    foreign key (tenant_id, service_id)
    references public.services (tenant_id, id),
  constraint quotes_assignee_fk
    foreign key (tenant_id, assigned_team_member_id)
    references public.team_members (tenant_id, id),
  constraint quotes_status_fk
    foreign key (tenant_id, status_id)
    references public.quote_statuses (tenant_id, id),
  constraint quotes_converted_order_fk
    foreign key (tenant_id, converted_order_id)
    references public.orders (tenant_id, id)
    on delete set null
);

comment on column public.quotes.row_version is
  'Same optimistic concurrency counter as orders.row_version.';

comment on column public.quotes.converted_order_id is
  'Set only by convert_quote_to_order. Cleared if that order row is deleted.';

create index quotes_tenant_status_idx
  on public.quotes (tenant_id, status_id);

create index quotes_tenant_client_idx
  on public.quotes (tenant_id, client_id);

create index quotes_tenant_created_idx
  on public.quotes (tenant_id, created_at desc);

create index quotes_tenant_assignee_idx
  on public.quotes (tenant_id, assigned_team_member_id);

create index quotes_tenant_converted_order_idx
  on public.quotes (tenant_id, converted_order_id)
  where converted_order_id is not null;

alter table public.quotes enable row level security;

create or replace function public.tg_assign_quote_reference()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_slug text;
  v_prefix text;
  v_number integer;
begin
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception 'tenant_id is immutable'
        using errcode = '42501';
    end if;
    new.reference := old.reference;
    new.created_by := old.created_by;
    return new;
  end if;

  select t.slug into v_slug
  from public.tenants t
  where t.id = new.tenant_id;

  v_prefix := pg_catalog.upper(
    pg_catalog.regexp_replace(coalesce(v_slug, ''), '[^A-Za-z0-9]', '', 'g')
  );
  if v_prefix = '' then
    v_prefix := 'Q';
  end if;

  insert into public.quote_number_counters as c (tenant_id, last_number)
  values (new.tenant_id, 1)
  on conflict (tenant_id) do update
  set last_number = c.last_number + 1
  returning last_number into v_number;

  new.reference := v_prefix
    || '-P'
    || pg_catalog.lpad(
      v_number::text,
      case
        when pg_catalog.length(v_number::text) > 4
          then pg_catalog.length(v_number::text)
        else 4
      end,
      '0'
    );
  new.created_by := auth.uid();
  return new;
end;
$function$;

comment on function public.tg_assign_quote_reference() is
  'DEFINER: overwrites reference from quote_number_counters. Independent of orders.';

drop trigger if exists quotes_assign_reference on public.quotes;
create trigger quotes_assign_reference
  before insert or update on public.quotes
  for each row
  execute function public.tg_assign_quote_reference();

drop trigger if exists quotes_set_updated_at on public.quotes;
create trigger quotes_set_updated_at
  before update on public.quotes
  for each row
  execute function public.set_updated_at();

drop trigger if exists quotes_bump_row_version on public.quotes;
create trigger quotes_bump_row_version
  before update on public.quotes
  for each row
  execute function public.bump_row_version();

create or replace function public.tg_quotes_activity()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_old_name text;
  v_old_code text;
  v_new_name text;
  v_new_code text;
  v_order_reference text;
  v_old_client text;
  v_new_client text;
  v_old_service text;
  v_new_service text;
  v_old_assignee text;
  v_new_assignee text;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (
      tenant_id, user_id, action, entity_type, entity_id, metadata
    ) values (
      new.tenant_id,
      v_actor,
      'quote.created',
      'quote',
      new.id,
      pg_catalog.jsonb_build_object('reference', new.reference)
    );
    return new;
  end if;

  if old.converted_order_id is null and new.converted_order_id is not null then
    select o.reference into v_order_reference
    from public.orders o
    where o.id = new.converted_order_id
      and o.tenant_id = new.tenant_id;

    insert into public.activity_log (
      tenant_id, user_id, action, entity_type, entity_id,
      new_values, metadata
    ) values (
      new.tenant_id,
      v_actor,
      'quote.converted',
      'quote',
      new.id,
      pg_catalog.jsonb_build_object('order_reference', v_order_reference),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'order_reference', v_order_reference
      )
    );
    return new;
  end if;

  if old.status_id is distinct from new.status_id then
    select qs.name, qs.code into v_old_name, v_old_code
    from public.quote_statuses qs
    where qs.tenant_id = new.tenant_id
      and qs.id = old.status_id;

    select qs.name, qs.code into v_new_name, v_new_code
    from public.quote_statuses qs
    where qs.tenant_id = new.tenant_id
      and qs.id = new.status_id;

    insert into public.activity_log (
      tenant_id, user_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    ) values (
      new.tenant_id,
      v_actor,
      'quote.status_changed',
      'quote',
      new.id,
      pg_catalog.jsonb_build_object(
        'status_name', v_old_name,
        'status_code', v_old_code
      ),
      pg_catalog.jsonb_build_object(
        'status_name', v_new_name,
        'status_code', v_new_code
      ),
      pg_catalog.jsonb_build_object(
        'reference', new.reference,
        'field', 'status'
      )
    );
    return new;
  end if;

  if old.title is not distinct from new.title
     and old.description is not distinct from new.description
     and old.notes is not distinct from new.notes
     and old.valid_until is not distinct from new.valid_until
     and old.client_id is not distinct from new.client_id
     and old.service_id is not distinct from new.service_id
     and old.assigned_team_member_id is not distinct from new.assigned_team_member_id
     and old.archived_at is not distinct from new.archived_at then
    return new;
  end if;

  select c.name into v_old_client
  from public.clients c
  where c.tenant_id = new.tenant_id and c.id = old.client_id;
  select c.name into v_new_client
  from public.clients c
  where c.tenant_id = new.tenant_id and c.id = new.client_id;
  select s.name into v_old_service
  from public.services s
  where s.tenant_id = new.tenant_id and s.id = old.service_id;
  select s.name into v_new_service
  from public.services s
  where s.tenant_id = new.tenant_id and s.id = new.service_id;
  select tm.name into v_old_assignee
  from public.team_members tm
  where tm.tenant_id = new.tenant_id and tm.id = old.assigned_team_member_id;
  select tm.name into v_new_assignee
  from public.team_members tm
  where tm.tenant_id = new.tenant_id and tm.id = new.assigned_team_member_id;

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    new.tenant_id,
    v_actor,
    'quote.updated',
    'quote',
    new.id,
    pg_catalog.jsonb_build_object(
      'title', old.title,
      'description', old.description,
      'notes', old.notes,
      'valid_until', old.valid_until,
      'client_name', v_old_client,
      'service_name', v_old_service,
      'assigned_team_member_name', v_old_assignee
    ),
    pg_catalog.jsonb_build_object(
      'title', new.title,
      'description', new.description,
      'notes', new.notes,
      'valid_until', new.valid_until,
      'client_name', v_new_client,
      'service_name', v_new_service,
      'assigned_team_member_name', v_new_assignee
    ),
    pg_catalog.jsonb_build_object('reference', new.reference)
  );

  return new;
end;
$function$;

comment on function public.tg_quotes_activity() is
  'DEFINER: activity_log has no insert policy. Records quote lifecycle events.';

drop trigger if exists quotes_activity on public.quotes;
create trigger quotes_activity
  after insert or update on public.quotes
  for each row
  execute function public.tg_quotes_activity();

create or replace function public.convert_quote_to_order (
  p_quote_id uuid
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_quote public.quotes%rowtype;
  v_order public.orders%rowtype;
  v_status_id uuid;
  v_status_count integer;
  v_title text;
begin
  if auth.uid() is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select q.* into v_quote
  from public.quotes q
  where q.id = p_quote_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(v_quote.tenant_id, array['owner', 'admin']::text[])
     or not public.tenant_has_feature(v_quote.tenant_id, 'quotes') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_quote.converted_order_id is not null then
    select o.* into v_order
    from public.orders o
    where o.id = v_quote.converted_order_id
      and o.tenant_id = v_quote.tenant_id;

    if not found then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    return pg_catalog.jsonb_build_object(
      'ok', true,
      'created', false,
      'order_id', v_order.id,
      'reference', v_order.reference
    );
  end if;

  select pg_catalog.count(*)::integer into v_status_count
  from public.order_statuses os
  where os.tenant_id = v_quote.tenant_id
    and os.active is true
    and os.is_initial is true;

  if v_status_count <> 1 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'no_initial_status');
  end if;

  select os.id into v_status_id
  from public.order_statuses os
  where os.tenant_id = v_quote.tenant_id
    and os.active is true
    and os.is_initial is true
  limit 1;

  v_title := nullif(pg_catalog.btrim(coalesce(v_quote.title, '')), '');
  if v_title is null then
    v_title := nullif(pg_catalog.left(pg_catalog.btrim(v_quote.description), 120), '');
  end if;

  if v_title is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  insert into public.orders (
    tenant_id,
    title,
    description,
    client_id,
    service_id,
    assigned_team_member_id,
    status_id,
    priority,
    notes,
    created_by,
    metadata
  ) values (
    v_quote.tenant_id,
    v_title,
    v_quote.description,
    v_quote.client_id,
    v_quote.service_id,
    v_quote.assigned_team_member_id,
    v_status_id,
    'normal',
    v_quote.notes,
    auth.uid(),
    pg_catalog.jsonb_build_object(
      'source', 'quote',
      'quote_id', v_quote.id,
      'quote_reference', v_quote.reference
    )
  )
  returning * into v_order;

  update public.quotes
  set converted_order_id = v_order.id
  where id = v_quote.id
    and tenant_id = v_quote.tenant_id
    and converted_order_id is null;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'created', true,
    'order_id', v_order.id,
    'reference', v_order.reference
  );
end;
$function$;

comment on function public.convert_quote_to_order(uuid) is
  'DEFINER so converted_order_id stays column-locked for authenticated. Locks the quote, reuses order insert triggers, returns the existing order when already converted.';

revoke all on function public.convert_quote_to_order(uuid) from public;
grant execute on function public.convert_quote_to_order(uuid) to authenticated;

create policy quotes_select_admin
  on public.quotes
  for select
  to authenticated
  using (
    public.tenant_has_feature(tenant_id, 'quotes')
    and public.has_tenant_role(tenant_id, array['owner', 'admin']::text[])
  );

create policy quotes_insert_admin
  on public.quotes
  for insert
  to authenticated
  with check (
    public.tenant_has_feature(tenant_id, 'quotes')
    and public.has_tenant_role(tenant_id, array['owner', 'admin']::text[])
  );

create policy quotes_update_admin
  on public.quotes
  for update
  to authenticated
  using (
    public.tenant_has_feature(tenant_id, 'quotes')
    and public.has_tenant_role(tenant_id, array['owner', 'admin']::text[])
  )
  with check (
    public.tenant_has_feature(tenant_id, 'quotes')
    and public.has_tenant_role(tenant_id, array['owner', 'admin']::text[])
  );

revoke all on table public.tenant_feature_overrides from public, anon, authenticated;
revoke all on table public.quote_number_counters from public, anon, authenticated;
revoke all on table public.quotes from public, anon, authenticated;
grant select on table public.quotes to authenticated;
grant insert (
  tenant_id,
  client_id,
  service_id,
  assigned_team_member_id,
  status_id,
  title,
  description,
  valid_until,
  notes
) on table public.quotes to authenticated;
grant update (
  client_id,
  service_id,
  assigned_team_member_id,
  status_id,
  title,
  description,
  valid_until,
  notes
) on table public.quotes to authenticated;

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

  perform public.seed_quote_statuses(v_tenant.id);

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
  'DEFINER authenticated: commercial onboarding only. Always active=false and provisioning_state=pending_billing. Seeds quote statuses. No client-selectable provisioning.';

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

  perform public.seed_quote_statuses(v_tenant.id);

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
  'DEFINER service-only: internal/ops provisioning with active=true and provisioning_state=ready. Seeds quote statuses. Never callable by authenticated.';

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

        when p.entity_type = 'quote'
          then coalesce(
            nullif(p.metadata ->> 'reference', ''),
            'Presupuesto'
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


commit;
