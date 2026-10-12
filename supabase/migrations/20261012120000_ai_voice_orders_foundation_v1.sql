-- AI Voice Orders V1 foundation: feature flag + atomic usage budget ledger.
-- Expand-only. Does not touch orders schema, plan_features, or Stripe.
-- Platform limit is seeded with enabled=false (fail-closed kill switch).

begin;

insert into public.features (id, code, name, description)
values (
  '31000000-0000-4000-8000-000000000007',
  'voice_orders',
  'Pedidos por voz',
  'Dictado e interpretación de pedidos con aprobación humana. Control interno de coste; preparado para add-on.'
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = pg_catalog.now();

create table public.ai_usage_limits (
  id uuid primary key default gen_random_uuid(),
  scope text not null
    check (scope in ('platform', 'tenant', 'user')),
  tenant_id uuid references public.tenants (id) on delete cascade,
  user_id uuid,
  feature_code text not null default 'voice_orders',
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
    (scope = 'platform' and tenant_id is null and user_id is null)
    or (scope = 'tenant' and tenant_id is not null and user_id is null)
    or (scope = 'user' and tenant_id is not null and user_id is not null)
  ),
  constraint ai_usage_limits_scope_unique unique nulls not distinct (
    scope, tenant_id, user_id, feature_code
  )
);

comment on table public.ai_usage_limits is
  'AI spend gates (platform/tenant/user). Internal cost control for voice_orders; not Stripe pricing. Access via DEFINER RPCs only.';

alter table public.ai_usage_limits enable row level security;

-- Internal cost-control tables: no direct client table access.
revoke all on table public.ai_usage_limits from public, anon, authenticated;

create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  user_id uuid not null,
  feature_code text not null default 'voice_orders',
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
values (
  'platform',
  'voice_orders',
  false,
  10000000,
  60,
  60,
  3000000
)
on conflict on constraint ai_usage_limits_scope_unique do update
set
  monthly_budget_micros = excluded.monthly_budget_micros,
  daily_request_limit = excluded.daily_request_limit,
  max_clip_seconds = excluded.max_clip_seconds,
  max_audio_bytes = excluded.max_audio_bytes,
  updated_at = pg_catalog.now();

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

revoke all on function public.ai_expire_stale_reservations(uuid, uuid, text) from public;

create or replace function public.ai_resolve_limits (
  p_tenant_id uuid,
  p_user_id uuid,
  p_feature text
)
  returns table (
    enabled boolean,
    monthly_budget_micros bigint,
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
  v_tenant public.ai_usage_limits%rowtype;
  v_user public.ai_usage_limits%rowtype;
  v_enabled boolean;
  v_budget bigint;
  v_daily integer;
  v_clip integer;
  v_bytes integer;
  v_reason text;
begin
  select * into v_platform
  from public.ai_usage_limits l
  where l.scope = 'platform'
    and l.feature_code = p_feature
  limit 1;

  if not found then
    return query select
      false,
      null::bigint,
      null::integer,
      null::integer,
      null::integer,
      'platform_limit_missing'::text;
    return;
  end if;

  select * into v_tenant
  from public.ai_usage_limits l
  where l.scope = 'tenant'
    and l.tenant_id = p_tenant_id
    and l.feature_code = p_feature
  limit 1;

  select * into v_user
  from public.ai_usage_limits l
  where l.scope = 'user'
    and l.tenant_id = p_tenant_id
    and l.user_id = p_user_id
    and l.feature_code = p_feature
  limit 1;

  v_enabled := v_platform.enabled
    and coalesce(v_tenant.enabled, true)
    and coalesce(v_user.enabled, true);

  if not v_platform.enabled then
    v_reason := 'platform_disabled';
  elsif v_tenant.enabled is false then
    v_reason := 'tenant_disabled';
  elsif v_user.enabled is false then
    v_reason := 'user_disabled';
  else
    v_reason := null;
  end if;

  v_budget := v_platform.monthly_budget_micros;
  if v_tenant.monthly_budget_micros is not null then
    v_budget := least(coalesce(v_budget, v_tenant.monthly_budget_micros), v_tenant.monthly_budget_micros);
  end if;
  if v_user.monthly_budget_micros is not null then
    v_budget := least(coalesce(v_budget, v_user.monthly_budget_micros), v_user.monthly_budget_micros);
  end if;

  v_daily := v_platform.daily_request_limit;
  if v_tenant.daily_request_limit is not null then
    v_daily := least(coalesce(v_daily, v_tenant.daily_request_limit), v_tenant.daily_request_limit);
  end if;
  if v_user.daily_request_limit is not null then
    v_daily := least(coalesce(v_daily, v_user.daily_request_limit), v_user.daily_request_limit);
  end if;

  v_clip := v_platform.max_clip_seconds;
  if v_tenant.max_clip_seconds is not null then
    v_clip := least(coalesce(v_clip, v_tenant.max_clip_seconds), v_tenant.max_clip_seconds);
  end if;
  if v_user.max_clip_seconds is not null then
    v_clip := least(coalesce(v_clip, v_user.max_clip_seconds), v_user.max_clip_seconds);
  end if;

  v_bytes := v_platform.max_audio_bytes;
  if v_tenant.max_audio_bytes is not null then
    v_bytes := least(coalesce(v_bytes, v_tenant.max_audio_bytes), v_tenant.max_audio_bytes);
  end if;
  if v_user.max_audio_bytes is not null then
    v_bytes := least(coalesce(v_bytes, v_user.max_audio_bytes), v_user.max_audio_bytes);
  end if;

  return query select v_enabled, v_budget, v_daily, v_clip, v_bytes, v_reason;
end;
$function$;

revoke all on function public.ai_resolve_limits(uuid, uuid, text) from public;

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

revoke all on function public.ai_usage_charged_micros(text, uuid, uuid, text, date) from public;

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
    and e.operation = p_operation;

  if v_existing is not null then
    return v_existing;
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

  -- Each scope is checked against its own configured budget (internal cost control).
  if exists (
    select 1
    from public.ai_usage_limits l
    where l.scope = 'platform'
      and l.feature_code = p_feature
      and l.monthly_budget_micros is not null
      and v_platform_spent + p_estimated_micros > l.monthly_budget_micros
  )
  or exists (
    select 1
    from public.ai_usage_limits l
    where l.scope = 'tenant'
      and l.tenant_id = p_tenant_id
      and l.feature_code = p_feature
      and l.monthly_budget_micros is not null
      and v_tenant_spent + p_estimated_micros > l.monthly_budget_micros
  )
  or exists (
    select 1
    from public.ai_usage_limits l
    where l.scope = 'user'
      and l.tenant_id = p_tenant_id
      and l.user_id = v_user_id
      and l.feature_code = p_feature
      and l.monthly_budget_micros is not null
      and v_user_spent + p_estimated_micros > l.monthly_budget_micros
  )
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
  'Atomic AI budget reservation. Fail-closed without platform row. Expired reservations still count.';

revoke all on function public.ai_reserve_usage(uuid, text, text, uuid, bigint, text, text, text) from public;
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

revoke all on function public.ai_settle_usage(uuid, text, bigint, numeric, integer, integer, text) from public;
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

  v_feature := public.tenant_has_feature(p_tenant_id, 'voice_orders');

  select * into v_limits
  from public.ai_resolve_limits(p_tenant_id, v_user_id, 'voice_orders');

  select count(*)::integer into v_user_requests
  from public.ai_usage_events e
  where e.tenant_id = p_tenant_id
    and e.user_id = v_user_id
    and e.feature_code = 'voice_orders'
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
  'Voice orders status for UI hints. Does not expose dollar amounts to operative roles.';

revoke all on function public.ai_voice_status(uuid) from public;
grant execute on function public.ai_voice_status(uuid) to authenticated;

commit;
