-- Gestcopy AI · Pedidos por voz V1 (#90): atomic usage budget ledger.
-- Expand-only. Does not touch orders, plans, plan_features, prices or Stripe.
--
-- Feature: reuses the catalog code `ai_voice_orders` (…0009) inserted by
-- 20261015200000_pro_early_access_features_v1 (#105). No catalog insert here.
--
-- Limits (internal cost control, not a price):
--   platform      kill switch + global monthly budget; seeded enabled=false.
--   tenant_default / user_default
--                 budgets every tenant / user gets unless an operator sets a
--                 specific row (pilot values: 2 USD/tenant/month,
--                 1 USD/user/month).
--   tenant / user specific rows, written only by ai_set_voice_usage_limit
--                 (service_role / database owner). A NULL column inherits the
--                 default; enabled=false switches that tenant or user off.
-- Every resolved budget is checked against its own spend, inside the same
-- advisory locks, before any paid provider call.

begin;

do $guard$
begin
  if not exists (select 1 from public.features where code = 'ai_voice_orders') then
    raise exception 'ai_voice_orders missing from features (apply 20261015200000 first)';
  end if;
end;
$guard$;

create table public.ai_usage_limits (
  id uuid primary key default gen_random_uuid(),
  scope text not null
    check (scope in ('platform', 'tenant_default', 'user_default', 'tenant', 'user')),
  tenant_id uuid references public.tenants (id) on delete cascade,
  user_id uuid,
  feature_code text not null default 'ai_voice_orders',
  enabled boolean not null default true,
  monthly_budget_micros bigint check (monthly_budget_micros is null or monthly_budget_micros >= 0),
  daily_request_limit integer check (daily_request_limit is null or daily_request_limit >= 0),
  max_clip_seconds integer check (
    max_clip_seconds is null or (max_clip_seconds between 1 and 300)
  ),
  max_audio_bytes integer check (
    max_audio_bytes is null or (max_audio_bytes between 1 and 4000000)
  ),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint ai_usage_limits_scope_ids_check check (
    (scope in ('platform', 'tenant_default', 'user_default')
      and tenant_id is null and user_id is null)
    or (scope = 'tenant' and tenant_id is not null and user_id is null)
    or (scope = 'user' and tenant_id is not null and user_id is not null)
  ),
  constraint ai_usage_limits_scope_unique unique nulls not distinct (
    scope, tenant_id, user_id, feature_code
  )
);

comment on table public.ai_usage_limits is
  'AI spend gates (platform, defaults, tenant, user) for ai_voice_orders. Internal cost control; not Stripe pricing. Access via DEFINER RPCs only.';

alter table public.ai_usage_limits enable row level security;

-- Internal cost-control tables: no direct client table access.
revoke all on table public.ai_usage_limits from public, anon, authenticated;

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null,
  feature_code text not null default 'ai_voice_orders',
  operation text not null
    check (operation in ('transcription', 'extraction')),
  request_id uuid not null,
  provider text,
  model text,
  pricing_version text,
  status text not null
    check (status in ('reserved', 'committed', 'released', 'expired')),
  reserved_micros bigint not null check (reserved_micros >= 0),
  actual_micros bigint check (actual_micros is null or actual_micros >= 0),
  audio_seconds numeric,
  input_tokens integer,
  output_tokens integer,
  error_code text,
  period_month date not null,
  created_at timestamptz not null default pg_catalog.now(),
  settled_at timestamptz,
  expires_at timestamptz not null,
  constraint ai_usage_events_request_unique unique (tenant_id, request_id, operation)
);

comment on table public.ai_usage_events is
  'AI usage ledger without transcript, audio, or PII text. reserved/expired micros count toward budgets (fail-closed).';

create index ai_usage_events_period_status_idx
  on public.ai_usage_events (period_month, status);
create index ai_usage_events_tenant_period_idx
  on public.ai_usage_events (tenant_id, period_month);
create index ai_usage_events_user_created_idx
  on public.ai_usage_events (user_id, created_at);

alter table public.ai_usage_events enable row level security;

-- No SELECT/INSERT/UPDATE/DELETE for authenticated. Ledger is internal;
-- operative clients only touch it through SECURITY DEFINER RPCs.
revoke all on table public.ai_usage_events from public, anon, authenticated;

insert into public.ai_usage_limits (
  scope,
  feature_code,
  enabled,
  monthly_budget_micros,
  daily_request_limit,
  max_clip_seconds,
  max_audio_bytes
)
values
  ('platform', 'ai_voice_orders', false, 10000000, 60, 60, 3000000),
  ('tenant_default', 'ai_voice_orders', true, 2000000, null, null, null),
  ('user_default', 'ai_voice_orders', true, 1000000, null, null, null)
on conflict on constraint ai_usage_limits_scope_unique do nothing;

create or replace function public.ai_expire_stale_reservations (
  p_tenant_id uuid,
  p_user_id uuid,
  p_feature text
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  update public.ai_usage_events e
  set
    status = 'expired',
    settled_at = coalesce(e.settled_at, pg_catalog.now()),
    error_code = coalesce(e.error_code, 'reservation_expired')
  where e.tenant_id = p_tenant_id
    and e.user_id = p_user_id
    and e.feature_code = p_feature
    and e.status = 'reserved'
    and e.expires_at <= pg_catalog.now();
end;
$function$;

revoke all on function public.ai_expire_stale_reservations(uuid, uuid, text) from public, anon, authenticated;

-- Effective limits for one user of one tenant. Internal: only reachable from
-- the DEFINER RPCs below.
create or replace function public.ai_resolve_limits (
  p_tenant_id uuid,
  p_user_id uuid,
  p_feature text
)
  returns table (
    enabled boolean,
    platform_budget_micros bigint,
    tenant_budget_micros bigint,
    user_budget_micros bigint,
    daily_request_limit integer,
    max_clip_seconds integer,
    max_audio_bytes integer,
    reason text
  )
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_platform public.ai_usage_limits%rowtype;
  v_tenant_default public.ai_usage_limits%rowtype;
  v_user_default public.ai_usage_limits%rowtype;
  v_tenant public.ai_usage_limits%rowtype;
  v_user public.ai_usage_limits%rowtype;
  v_tenant_enabled boolean;
  v_user_enabled boolean;
  v_daily integer;
  v_clip integer;
  v_bytes integer;
  v_reason text;
begin
  select * into v_platform
  from public.ai_usage_limits l
  where l.scope = 'platform'
    and l.feature_code = p_feature;

  if not found then
    return query select
      false,
      null::bigint,
      null::bigint,
      null::bigint,
      null::integer,
      null::integer,
      null::integer,
      'platform_limit_missing'::text;
    return;
  end if;

  select * into v_tenant_default
  from public.ai_usage_limits l
  where l.scope = 'tenant_default'
    and l.feature_code = p_feature;

  select * into v_user_default
  from public.ai_usage_limits l
  where l.scope = 'user_default'
    and l.feature_code = p_feature;

  select * into v_tenant
  from public.ai_usage_limits l
  where l.scope = 'tenant'
    and l.tenant_id = p_tenant_id
    and l.feature_code = p_feature;

  select * into v_user
  from public.ai_usage_limits l
  where l.scope = 'user'
    and l.tenant_id = p_tenant_id
    and l.user_id = p_user_id
    and l.feature_code = p_feature;

  v_tenant_enabled := coalesce(v_tenant.enabled, v_tenant_default.enabled, true);
  v_user_enabled := coalesce(v_user.enabled, v_user_default.enabled, true);

  if not v_platform.enabled then
    v_reason := 'platform_disabled';
  elsif not v_tenant_enabled then
    v_reason := 'tenant_disabled';
  elsif not v_user_enabled then
    v_reason := 'user_disabled';
  else
    v_reason := null;
  end if;

  -- Request and audio limits: the strictest configured value wins.
  select min(x) into v_daily from unnest(array[
    v_platform.daily_request_limit,
    coalesce(v_tenant.daily_request_limit, v_tenant_default.daily_request_limit),
    coalesce(v_user.daily_request_limit, v_user_default.daily_request_limit)
  ]) as x;

  select min(x) into v_clip from unnest(array[
    v_platform.max_clip_seconds,
    coalesce(v_tenant.max_clip_seconds, v_tenant_default.max_clip_seconds),
    coalesce(v_user.max_clip_seconds, v_user_default.max_clip_seconds)
  ]) as x;

  select min(x) into v_bytes from unnest(array[
    v_platform.max_audio_bytes,
    coalesce(v_tenant.max_audio_bytes, v_tenant_default.max_audio_bytes),
    coalesce(v_user.max_audio_bytes, v_user_default.max_audio_bytes)
  ]) as x;

  return query select
    v_platform.enabled and v_tenant_enabled and v_user_enabled,
    v_platform.monthly_budget_micros,
    coalesce(v_tenant.monthly_budget_micros, v_tenant_default.monthly_budget_micros),
    coalesce(v_user.monthly_budget_micros, v_user_default.monthly_budget_micros),
    v_daily,
    v_clip,
    v_bytes,
    v_reason;
end;
$function$;

revoke all on function public.ai_resolve_limits(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.ai_usage_charged_micros (
  p_scope text,
  p_tenant_id uuid,
  p_user_id uuid,
  p_feature text,
  p_period_month date
)
  returns bigint
  language sql
  stable
  security definer
  set search_path to ''
as $function$
  select coalesce(sum(coalesce(e.actual_micros, e.reserved_micros)), 0)::bigint
  from public.ai_usage_events e
  where e.feature_code = p_feature
    and e.period_month = p_period_month
    and e.status in ('reserved', 'committed', 'expired')
    and (
      p_scope = 'platform'
      or (p_scope = 'tenant' and e.tenant_id = p_tenant_id)
      or (p_scope = 'user' and e.tenant_id = p_tenant_id and e.user_id = p_user_id)
    );
$function$;

revoke all on function public.ai_usage_charged_micros(text, uuid, uuid, text, date) from public, anon, authenticated;

create or replace function public.ai_reserve_usage (
  p_tenant_id uuid,
  p_feature text,
  p_operation text,
  p_request_id uuid,
  p_estimated_micros bigint,
  p_provider text,
  p_model text,
  p_pricing_version text
)
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_limits record;
  v_existing uuid;
  v_period date := (pg_catalog.timezone('utc', pg_catalog.now()))::date;
  v_period_month date := date_trunc('month', v_period)::date;
  v_day_start timestamptz := date_trunc('day', pg_catalog.timezone('utc', pg_catalog.now())) at time zone 'utc';
  v_day_end timestamptz := v_day_start + interval '1 day';
  v_platform_spent bigint;
  v_tenant_spent bigint;
  v_user_spent bigint;
  v_user_requests integer;
  v_event_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null
     or p_feature is null
     or p_operation is null
     or p_request_id is null
     or p_estimated_micros is null
     or p_estimated_micros < 0
  then
    raise exception 'invalid arguments'
      using errcode = '22023';
  end if;

  -- The ledger only serves Pedidos por voz: another feature code must never
  -- borrow its budget or its rate limit.
  if p_feature is distinct from 'ai_voice_orders' then
    raise exception 'invalid feature'
      using errcode = '22023';
  end if;

  if p_operation not in ('transcription', 'extraction') then
    raise exception 'invalid operation'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = v_user_id
      and m.active is true
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  if not public.tenant_has_feature(p_tenant_id, p_feature) then
    raise exception 'feature disabled'
      using errcode = '42501';
  end if;

  -- Lock order fixed to avoid deadlocks: global → tenant → user.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai-budget:global', 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai-budget:tenant:' || p_tenant_id::text, 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ai-budget:user:' || v_user_id::text, 0)
  );

  select e.id into v_existing
  from public.ai_usage_events e
  where e.tenant_id = p_tenant_id
    and e.request_id = p_request_id
    and e.operation = p_operation
    and e.user_id = v_user_id;

  if v_existing is not null then
    return v_existing;
  end if;

  -- Same request id from another member of the tenant: never hand out
  -- someone else's reservation.
  if exists (
    select 1
    from public.ai_usage_events e
    where e.tenant_id = p_tenant_id
      and e.request_id = p_request_id
      and e.operation = p_operation
  ) then
    raise exception 'request id already used'
      using errcode = '23505';
  end if;

  perform public.ai_expire_stale_reservations(p_tenant_id, v_user_id, p_feature);

  select * into v_limits
  from public.ai_resolve_limits(p_tenant_id, v_user_id, p_feature);

  if not v_limits.enabled then
    raise exception 'ai_budget_exhausted'
      using errcode = 'P0001',
            hint = coalesce(v_limits.reason, 'disabled');
  end if;

  v_platform_spent := public.ai_usage_charged_micros(
    'platform', p_tenant_id, v_user_id, p_feature, v_period_month
  );
  v_tenant_spent := public.ai_usage_charged_micros(
    'tenant', p_tenant_id, v_user_id, p_feature, v_period_month
  );
  v_user_spent := public.ai_usage_charged_micros(
    'user', p_tenant_id, v_user_id, p_feature, v_period_month
  );

  -- Each scope is checked against its own resolved budget.
  if (v_limits.platform_budget_micros is not null
        and v_platform_spent + p_estimated_micros > v_limits.platform_budget_micros)
     or (v_limits.tenant_budget_micros is not null
        and v_tenant_spent + p_estimated_micros > v_limits.tenant_budget_micros)
     or (v_limits.user_budget_micros is not null
        and v_user_spent + p_estimated_micros > v_limits.user_budget_micros)
  then
    raise exception 'ai_budget_exhausted'
      using errcode = 'P0001';
  end if;

  select count(*)::integer into v_user_requests
  from public.ai_usage_events e
  where e.tenant_id = p_tenant_id
    and e.user_id = v_user_id
    and e.feature_code = p_feature
    and e.status in ('reserved', 'committed', 'expired')
    and e.created_at >= v_day_start
    and e.created_at < v_day_end;

  if v_limits.daily_request_limit is not null
     and v_user_requests >= v_limits.daily_request_limit
  then
    raise exception 'ai_rate_limited'
      using errcode = 'P0001';
  end if;

  insert into public.ai_usage_events (
    tenant_id,
    user_id,
    feature_code,
    operation,
    request_id,
    provider,
    model,
    pricing_version,
    status,
    reserved_micros,
    period_month,
    expires_at
  ) values (
    p_tenant_id,
    v_user_id,
    p_feature,
    p_operation,
    p_request_id,
    p_provider,
    p_model,
    p_pricing_version,
    'reserved',
    p_estimated_micros,
    v_period_month,
    pg_catalog.now() + interval '120 seconds'
  )
  returning id into v_event_id;

  return v_event_id;
end;
$function$;

comment on function public.ai_reserve_usage(uuid, text, text, uuid, bigint, text, text, text) is
  'Atomic AI budget reservation for ai_voice_orders. Fail-closed without platform row. Expired reservations still count.';

revoke all on function public.ai_reserve_usage(uuid, text, text, uuid, bigint, text, text, text) from public, anon;
grant execute on function public.ai_reserve_usage(uuid, text, text, uuid, bigint, text, text, text) to authenticated;

create or replace function public.ai_settle_usage (
  p_event_id uuid,
  p_status text,
  p_actual_micros bigint,
  p_audio_seconds numeric,
  p_input_tokens integer,
  p_output_tokens integer,
  p_error_code text
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_row public.ai_usage_events%rowtype;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_status not in ('committed', 'released') then
    raise exception 'invalid settle status'
      using errcode = '22023';
  end if;

  select * into v_row
  from public.ai_usage_events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'usage event not found'
      using errcode = 'P0002';
  end if;

  if v_row.user_id is distinct from v_user_id then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  if v_row.status is distinct from 'reserved' then
    return;
  end if;

  update public.ai_usage_events e
  set
    status = p_status,
    actual_micros = case
      when p_status = 'committed' then coalesce(p_actual_micros, e.reserved_micros)
      else 0
    end,
    audio_seconds = p_audio_seconds,
    input_tokens = p_input_tokens,
    output_tokens = p_output_tokens,
    error_code = p_error_code,
    settled_at = pg_catalog.now()
  where e.id = p_event_id;
end;
$function$;

comment on function public.ai_settle_usage(uuid, text, bigint, numeric, integer, integer, text) is
  'Settle a reserved AI usage event as committed or released. Idempotent for non-reserved rows.';

revoke all on function public.ai_settle_usage(uuid, text, bigint, numeric, integer, integer, text) from public, anon;
grant execute on function public.ai_settle_usage(uuid, text, bigint, numeric, integer, integer, text) to authenticated;

create or replace function public.ai_voice_status (
  p_tenant_id uuid
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_limits record;
  v_feature boolean;
  v_day_start timestamptz := date_trunc('day', pg_catalog.timezone('utc', pg_catalog.now())) at time zone 'utc';
  v_day_end timestamptz := v_day_start + interval '1 day';
  v_user_requests integer;
  v_remaining integer;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = v_user_id
      and m.active is true
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  v_feature := public.tenant_has_feature(p_tenant_id, 'ai_voice_orders');

  select * into v_limits
  from public.ai_resolve_limits(p_tenant_id, v_user_id, 'ai_voice_orders');

  select count(*)::integer into v_user_requests
  from public.ai_usage_events e
  where e.tenant_id = p_tenant_id
    and e.user_id = v_user_id
    and e.feature_code = 'ai_voice_orders'
    and e.status in ('reserved', 'committed', 'expired')
    and e.created_at >= v_day_start
    and e.created_at < v_day_end;

  if v_limits.daily_request_limit is null then
    v_remaining := null;
  else
    v_remaining := greatest(v_limits.daily_request_limit - v_user_requests, 0);
  end if;

  return pg_catalog.jsonb_build_object(
    'feature_enabled', v_feature,
    'budget_enabled', v_limits.enabled,
    'reason', v_limits.reason,
    'limits', pg_catalog.jsonb_build_object(
      'max_clip_seconds', v_limits.max_clip_seconds,
      'max_audio_bytes', v_limits.max_audio_bytes,
      'daily_request_limit', v_limits.daily_request_limit
    ),
    'remaining', pg_catalog.jsonb_build_object(
      'user_requests_today', v_remaining
    )
  );
end;
$function$;

comment on function public.ai_voice_status(uuid) is
  'Voice orders status for UI hints. Does not expose budgets or spend to operative roles.';

revoke all on function public.ai_voice_status(uuid) from public, anon;
grant execute on function public.ai_voice_status(uuid) to authenticated;

-- Operator path for every limit row (kill switch, defaults, one tenant, one
-- user). Idempotent upsert; NULL values inherit (see header). Tenant by slug,
-- like set_tenant_feature; a user row requires an active membership.
create or replace function public.ai_set_voice_usage_limit (
  p_scope text,
  p_tenant_slug text,
  p_user_id uuid,
  p_enabled boolean,
  p_monthly_budget_micros bigint,
  p_daily_request_limit integer,
  p_max_clip_seconds integer,
  p_max_audio_bytes integer
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_role text := coalesce(auth.role(), '');
  v_tenant uuid;
  v_row public.ai_usage_limits%rowtype;
begin
  -- Same operator rule as tenant_has_feature: service_role, or a direct
  -- postgres/supabase_admin session without JWT claims. The EXECUTE grant
  -- (service_role only) is the first barrier; this is the second.
  if not (
    v_role = 'service_role'
    or (v_role = '' and session_user in ('postgres', 'supabase_admin'))
  ) then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if p_scope is null
     or p_scope not in ('platform', 'tenant_default', 'user_default', 'tenant', 'user')
     or p_enabled is null
  then
    raise exception 'invalid arguments'
      using errcode = '22023';
  end if;

  if p_scope in ('platform', 'tenant_default', 'user_default') then
    if p_tenant_slug is not null or p_user_id is not null then
      raise exception 'scope % takes no tenant or user', p_scope
        using errcode = '22023';
    end if;
  else
    select t.id into v_tenant
    from public.tenants t
    where t.slug = p_tenant_slug;

    if v_tenant is null then
      raise exception 'tenant not found'
        using errcode = 'P0002';
    end if;

    if p_scope = 'tenant' and p_user_id is not null then
      raise exception 'scope tenant takes no user'
        using errcode = '22023';
    end if;

    if p_scope = 'user' and not exists (
      select 1
      from public.memberships m
      where m.tenant_id = v_tenant
        and m.user_id = p_user_id
        and m.active is true
    ) then
      raise exception 'active membership not found'
        using errcode = 'P0002';
    end if;
  end if;

  insert into public.ai_usage_limits (
    scope,
    tenant_id,
    user_id,
    feature_code,
    enabled,
    monthly_budget_micros,
    daily_request_limit,
    max_clip_seconds,
    max_audio_bytes
  ) values (
    p_scope,
    v_tenant,
    case when p_scope = 'user' then p_user_id end,
    'ai_voice_orders',
    p_enabled,
    p_monthly_budget_micros,
    p_daily_request_limit,
    p_max_clip_seconds,
    p_max_audio_bytes
  )
  on conflict on constraint ai_usage_limits_scope_unique do update
  set
    enabled = excluded.enabled,
    monthly_budget_micros = excluded.monthly_budget_micros,
    daily_request_limit = excluded.daily_request_limit,
    max_clip_seconds = excluded.max_clip_seconds,
    max_audio_bytes = excluded.max_audio_bytes,
    updated_at = pg_catalog.now()
  returning * into v_row;

  return pg_catalog.jsonb_build_object(
    'scope', v_row.scope,
    'tenant_id', v_row.tenant_id,
    'user_id', v_row.user_id,
    'enabled', v_row.enabled,
    'monthly_budget_micros', v_row.monthly_budget_micros,
    'daily_request_limit', v_row.daily_request_limit,
    'max_clip_seconds', v_row.max_clip_seconds,
    'max_audio_bytes', v_row.max_audio_bytes,
    'updated_at', v_row.updated_at
  );
end;
$function$;

comment on function public.ai_set_voice_usage_limit(text, text, uuid, boolean, bigint, integer, integer, integer) is
  'Operator upsert of ai_voice_orders limits (platform, defaults, tenant, user). service_role or database owner only.';

revoke all on function public.ai_set_voice_usage_limit(text, text, uuid, boolean, bigint, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_set_voice_usage_limit(text, text, uuid, boolean, bigint, integer, integer, integer) to service_role;

commit;
