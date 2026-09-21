-- Settings V1 · Order status catalog hardening.
-- Tenant-aware catalog writes move behind controlled RPCs.
-- Existing data is preserved; no tenant-specific seed is introduced.

begin;

-- New/changed rows may never keep the initial flag while inactive.
-- NOT VALID avoids blocking deployment if a historical tenant already has
-- the invalid combination; the Settings RPC can repair it atomically.
alter table public.order_statuses
  add constraint order_statuses_initial_must_be_active
  check (is_initial is not true or active is true)
  not valid;

-- Reads remain available to all tenant members. Catalog writes now go only
-- through the RPCs below so the "one active initial" invariant is atomic.
revoke insert, update on table public.order_statuses from authenticated;
grant select on table public.order_statuses to authenticated;

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
security definer
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
  if v_kind not in ('initial', 'in_progress', 'ready', 'closed', 'cancelled') then
    raise exception 'invalid status kind'
      using errcode = '22023';
  end if;

  v_active := coalesce(p_active, true);
  v_sort_order := greatest(coalesce(p_sort_order, 0), 0);

  -- Serialise catalog changes per tenant. This makes switching the initial
  -- status safe even under concurrent Settings requests.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('order-status:' || p_tenant_id::text, 0)
  );

  if v_kind = 'initial' then
    v_active := true;

    update public.order_statuses
    set
      is_initial = false,
      updated_at = pg_catalog.now()
    where tenant_id = p_tenant_id
      and is_initial = true;
  end if;

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
    v_kind = 'initial',
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
  'DEFINER: management-only order status create. Semantic kind maps to flags. Switching initial is serialized and atomic.';

revoke all on function public.create_order_status_catalog(uuid, text, text, text, boolean, integer)
  from public, anon;
grant execute on function public.create_order_status_catalog(uuid, text, text, text, boolean, integer)
  to authenticated, postgres;

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
security definer
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

  -- The current initial cannot simply be unset/deactivated. To change it,
  -- first mark another status as initial; that RPC clears the old flag in
  -- the same transaction.
  if v_existing.is_initial is true and v_kind <> 'initial' then
    raise exception 'assign another initial status before changing this one'
      using errcode = '23514';
  end if;

  if v_kind = 'initial' then
    v_active := true;

    update public.order_statuses
    set
      is_initial = false,
      updated_at = pg_catalog.now()
    where tenant_id = p_tenant_id
      and id <> p_status_id
      and is_initial = true;
  end if;

  update public.order_statuses
  set
    name = v_name,
    is_initial = v_kind = 'initial',
    is_ready = v_kind = 'ready',
    is_closed = v_kind = 'closed',
    is_cancelled = v_kind = 'cancelled',
    active = v_active,
    sort_order = v_sort_order,
    updated_at = pg_catalog.now()
  where id = p_status_id
    and tenant_id = p_tenant_id
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

comment on function public.update_order_status_catalog(uuid, uuid, text, text, boolean, integer) is
  'DEFINER: management-only order status update. Code is immutable. Exactly one active initial status is preserved by serialized writes.';

revoke all on function public.update_order_status_catalog(uuid, uuid, text, text, boolean, integer)
  from public, anon;
grant execute on function public.update_order_status_catalog(uuid, uuid, text, text, boolean, integer)
  to authenticated, postgres;

commit;
