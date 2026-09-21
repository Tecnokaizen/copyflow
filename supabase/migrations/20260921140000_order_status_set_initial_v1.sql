-- Settings V1 · dedicated atomic set-initial for order statuses.
-- Aligns catalog writes with: create never initial; PATCH never flips initial;
-- set_order_status_initial is the only path to change the initial status.
-- Preflight confirmed every current tenant already has exactly one active initial.

begin;

-- Data is consistent across current tenants; enforce the CHECK for all rows.
alter table public.order_statuses
  validate constraint order_statuses_initial_must_be_active;

-- ---------------------------------------------------------------------------
-- create_order_status_catalog: never create as initial from Settings.
-- Organization bootstrap continues to insert the first initial via SQL seed.
-- ---------------------------------------------------------------------------
create or replace function public.create_order_status_catalog(
  p_tenant_id uuid,
  p_name text,
  p_code text,
  p_kind text,
  p_active boolean default true,
  p_sort_order integer default 0
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_code text;
  v_kind text;
  v_active boolean;
  v_sort_order integer;
  v_status public.order_statuses%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null then
    raise exception 'tenant is required'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  v_name := nullif(pg_catalog.btrim(coalesce(p_name, '')), '');
  if v_name is null or pg_catalog.length(v_name) > 100 then
    raise exception 'invalid status name'
      using errcode = '22023';
  end if;

  v_code := pg_catalog.lower(pg_catalog.btrim(coalesce(p_code, '')));
  if v_code = ''
     or pg_catalog.length(v_code) > 64
     or v_code !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$' then
    raise exception 'invalid status code'
      using errcode = '22023';
  end if;

  v_kind := pg_catalog.lower(pg_catalog.btrim(coalesce(p_kind, '')));
  if v_kind not in ('in_progress', 'ready', 'closed', 'cancelled') then
    raise exception 'initial_status_must_use_set_initial'
      using errcode = '22023';
  end if;

  v_active := coalesce(p_active, true);
  v_sort_order := greatest(coalesce(p_sort_order, 0), 0);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('order-status:' || p_tenant_id::text, 0)
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
  values (
    p_tenant_id,
    v_name,
    v_code,
    false,
    v_kind = 'ready',
    v_kind = 'closed',
    v_kind = 'cancelled',
    v_active,
    v_sort_order
  )
  returning * into v_status;

  if not exists (
    select 1
    from public.order_statuses s
    where s.tenant_id = p_tenant_id
      and s.is_initial = true
      and s.active = true
  ) then
    raise exception 'tenant must keep one active initial order status'
      using errcode = '23514';
  end if;

  return pg_catalog.jsonb_build_object(
    'status',
    pg_catalog.to_jsonb(v_status)
  );
end;
$function$;

comment on function public.create_order_status_catalog(uuid, text, text, text, boolean, integer) is
  'INVOKER: management-only order status create. Always is_initial=false. Use set_order_status_initial to change the initial.';

-- ---------------------------------------------------------------------------
-- update_order_status_catalog: no initial flip; cannot deactivate current initial.
-- ---------------------------------------------------------------------------
create or replace function public.update_order_status_catalog(
  p_tenant_id uuid,
  p_status_id uuid,
  p_name text,
  p_kind text,
  p_active boolean,
  p_sort_order integer
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_name text;
  v_kind text;
  v_active boolean;
  v_sort_order integer;
  v_existing public.order_statuses%rowtype;
  v_status public.order_statuses%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null or p_status_id is null then
    raise exception 'tenant and status are required'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  v_name := nullif(pg_catalog.btrim(coalesce(p_name, '')), '');
  if v_name is null or pg_catalog.length(v_name) > 100 then
    raise exception 'invalid status name'
      using errcode = '22023';
  end if;

  v_kind := pg_catalog.lower(pg_catalog.btrim(coalesce(p_kind, '')));
  if v_kind not in ('initial', 'in_progress', 'ready', 'closed', 'cancelled') then
    raise exception 'invalid status kind'
      using errcode = '22023';
  end if;

  v_active := coalesce(p_active, true);
  v_sort_order := greatest(coalesce(p_sort_order, 0), 0);

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('order-status:' || p_tenant_id::text, 0)
  );

  select *
  into v_existing
  from public.order_statuses s
  where s.id = p_status_id
    and s.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order status not found'
      using errcode = 'P0002';
  end if;

  if v_existing.is_initial is true then
    if not v_active then
      raise exception 'initial_status_cannot_be_deactivated'
        using errcode = '23514';
    end if;

    -- Current initial keeps its flag; only name/sort/active(=true) change here.
    -- Changing which row is initial requires set_order_status_initial.
    update public.order_statuses
    set
      name = v_name,
      active = true,
      sort_order = v_sort_order,
      updated_at = pg_catalog.now()
    where id = p_status_id
      and tenant_id = p_tenant_id
    returning * into v_status;
  else
    if v_kind = 'initial' then
      raise exception 'initial_status_must_use_set_initial'
        using errcode = '22023';
    end if;

    update public.order_statuses
    set
      name = v_name,
      is_initial = false,
      is_ready = v_kind = 'ready',
      is_closed = v_kind = 'closed',
      is_cancelled = v_kind = 'cancelled',
      active = v_active,
      sort_order = v_sort_order,
      updated_at = pg_catalog.now()
    where id = p_status_id
      and tenant_id = p_tenant_id
    returning * into v_status;
  end if;

  if not exists (
    select 1
    from public.order_statuses s
    where s.tenant_id = p_tenant_id
      and s.is_initial = true
      and s.active = true
  ) then
    raise exception 'tenant must keep one active initial order status'
      using errcode = '23514';
  end if;

  return pg_catalog.jsonb_build_object(
    'status',
    pg_catalog.to_jsonb(v_status)
  );
end;
$function$;

comment on function public.update_order_status_catalog(uuid, uuid, text, text, boolean, integer) is
  'INVOKER: management-only order status update. Cannot flip or deactivate the initial; use set_order_status_initial.';

-- ---------------------------------------------------------------------------
-- set_order_status_initial: sole atomic path to change the initial status.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_status_initial(
  p_tenant_id uuid,
  p_status_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_target public.order_statuses%rowtype;
  v_status public.order_statuses%rowtype;
  v_count integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null or p_status_id is null then
    raise exception 'tenant and status are required'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  -- Serialize all initial-status mutations for this tenant.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('order-status:' || p_tenant_id::text, 0)
  );

  select *
  into v_target
  from public.order_statuses s
  where s.id = p_status_id
    and s.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'order status not found'
      using errcode = 'P0002';
  end if;

  if v_target.active is not true then
    raise exception 'inactive_status_cannot_be_initial'
      using errcode = '23514';
  end if;

  -- Lock every current initial row for this tenant (normally exactly one).
  perform 1
  from public.order_statuses s
  where s.tenant_id = p_tenant_id
    and s.is_initial = true
  for update;

  update public.order_statuses
  set
    is_initial = false,
    updated_at = pg_catalog.now()
  where tenant_id = p_tenant_id
    and id <> p_status_id
    and is_initial = true;

  update public.order_statuses
  set
    is_initial = true,
    active = true,
    -- Initial is mutually exclusive with ready/closed/cancelled.
    is_ready = false,
    is_closed = false,
    is_cancelled = false,
    updated_at = pg_catalog.now()
  where id = p_status_id
    and tenant_id = p_tenant_id
  returning * into v_status;

  select count(*)
  into v_count
  from public.order_statuses s
  where s.tenant_id = p_tenant_id
    and s.is_initial = true
    and s.active = true;

  if v_count <> 1 then
    raise exception 'tenant must keep one active initial order status'
      using errcode = '23514';
  end if;

  return pg_catalog.jsonb_build_object(
    'status',
    pg_catalog.to_jsonb(v_status)
  );
end;
$function$;

comment on function public.set_order_status_initial(uuid, uuid) is
  'INVOKER: atomically set the unique active initial order status for a tenant. Serialized with advisory xact lock.';

revoke all on function public.set_order_status_initial(uuid, uuid)
  from public, anon;
grant execute on function public.set_order_status_initial(uuid, uuid)
  to authenticated, postgres;

commit;
