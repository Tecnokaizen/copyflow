-- Billing storage capacity explicit V1 · S2 (approved 18/10/2026)
-- Does NOT modify DEMO/SUR4 rows. Changes no existing row at migration time.
--
-- Storage capacity (bytes a tenant may hold) is resolved apart from write
-- permission (who may upload: roles, tenant availability, enforced by the
-- upload RPCs). No absence of capacity is ever unlimited:
--   1. current subscription (trialing/active/past_due) whose plan configures
--      storage_bytes → that capacity                       (current_plan)
--   2. otherwise the most recent subscription whose plan configured it, in
--      any status: a cancellation keeps the last contracted capacity
--                                                          (last_contracted)
--   3. otherwise 0: never had a subscription (no_subscription) or only plans
--      without storage_bytes such as mvp (no_contracted_capacity).
-- resolve_tenant_storage_limit_bytes keeps its signature and callers and
-- never returns NULL again.
--
-- Internal subscriptions are granted explicitly: grant_internal_subscription_v1
-- (service-only, reason + authorizer, shared tenant billing lock key 31) and
-- an append-only audit of every non-Stripe subscription change. API roles
-- cannot grant or reactivate a non-Stripe subscription outside that RPC;
-- direct SQL as postgres stays possible and is always audited as 'direct'.
-- create_internal_organization_v1 is unchanged: organizations without a
-- subscription remain valid (capacity 0 until a grant).
--
-- Legitimate internal subscriptions keep their rights: the internal mvp plan
-- (demo) had no storage_bytes, i.e. implicit unlimited. It now gets an
-- explicit capacity equal to Basic's, so no subscription row is touched and
-- no absence of capacity stays unlimited. Adjustable later in plan_features.

begin;

-- ---------------------------------------------------------------------------
-- mvp (internal legacy plan): explicit capacity instead of implicit unlimited
-- ---------------------------------------------------------------------------
insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
select mvp.id, basic_pf.feature_id, true, basic_pf.limit_value
from public.plans mvp
join public.plans basic on basic.code = 'basic'
join public.plan_features basic_pf on basic_pf.plan_id = basic.id
join public.features f on f.id = basic_pf.feature_id and f.code = 'storage_bytes'
where mvp.code = 'mvp'
  and basic_pf.limit_value is not null
on conflict (plan_id, feature_id) do nothing;

-- ---------------------------------------------------------------------------
-- billing_private: closed to every API role
-- ---------------------------------------------------------------------------
create schema if not exists billing_private;
revoke all on schema billing_private from public, anon, authenticated, service_role;

create table if not exists billing_private.internal_subscription_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  subscription_id uuid not null,
  action text not null check (
    action = any (array['grant', 'reactivate', 'close', 'update', 'insert']::text[])
  ),
  via text not null,
  reason text,
  authorized_by text,
  actor_role text not null,
  actor_session text not null,
  old_row jsonb,
  new_row jsonb not null,
  created_at timestamptz not null default pg_catalog.now()
);

create index if not exists internal_subscription_audit_tenant_idx
  on billing_private.internal_subscription_audit (tenant_id, created_at desc);

alter table billing_private.internal_subscription_audit enable row level security;
revoke all on table billing_private.internal_subscription_audit
  from public, anon, authenticated, service_role;

comment on table billing_private.internal_subscription_audit is
  'Append-only audit of non-Stripe subscription changes (internal trials and pilots, mvp, NULL provider). via: grant_rpc or another named RPC, or direct (SQL outside the RPCs).';

-- ---------------------------------------------------------------------------
-- Audit + guard trigger on public.subscriptions (non-Stripe rows)
-- ---------------------------------------------------------------------------
create or replace function public.tg_subscriptions_internal_audit()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_current text[] := array['trialing', 'active', 'past_due'];
  v_via text := nullif(pg_catalog.current_setting('app.billing_internal_via', true), '');
  -- Caller's SET ROLE (PostgREST: anon/authenticated/service_role; direct SQL:
  -- none). Unlike JWT claims it is not left behind by reset role.
  v_role text := coalesce(nullif(pg_catalog.current_setting('role', true), 'none'), '');
  v_action text;
  v_old_current boolean := false;
  v_new_current boolean;
begin
  if new.provider is not distinct from 'stripe'
     and (tg_op = 'INSERT' or old.provider is not distinct from 'stripe')
  then
    return null;
  end if;

  v_new_current := new.status = any (v_current);
  if tg_op = 'UPDATE' then
    v_old_current := old.status = any (v_current)
      and old.provider is distinct from 'stripe';
  end if;

  v_action := case
    when tg_op = 'INSERT' and v_new_current then 'grant'
    when tg_op = 'INSERT' then 'insert'
    when v_new_current and not v_old_current then 'reactivate'
    when v_old_current and not v_new_current then 'close'
    else 'update'
  end;

  -- API roles never grant or reactivate a non-Stripe subscription directly.
  if v_action in ('grant', 'reactivate')
     and v_via is null
     and v_role in ('service_role', 'authenticated', 'anon')
  then
    raise exception 'internal subscription grant requires grant_internal_subscription_v1'
      using errcode = '42501';
  end if;

  insert into billing_private.internal_subscription_audit (
    tenant_id, subscription_id, action, via, reason, authorized_by,
    actor_role, actor_session, old_row, new_row
  ) values (
    new.tenant_id,
    new.id,
    v_action,
    coalesce(v_via, 'direct'),
    nullif(pg_catalog.current_setting('app.billing_internal_reason', true), ''),
    nullif(pg_catalog.current_setting('app.billing_internal_authorized_by', true), ''),
    coalesce(nullif(v_role, ''), 'sql:' || session_user::text),
    session_user::text,
    case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) end,
    pg_catalog.to_jsonb(new)
  );

  return null;
end;
$function$;

comment on function public.tg_subscriptions_internal_audit() is
  'Trigger: audits every non-Stripe subscription change in billing_private.internal_subscription_audit and refuses grants/reactivations by API roles outside grant_internal_subscription_v1.';

revoke all on function public.tg_subscriptions_internal_audit() from public, anon, authenticated;

create trigger subscriptions_internal_audit
  after insert or update on public.subscriptions
  for each row execute function public.tg_subscriptions_internal_audit();

-- ---------------------------------------------------------------------------
-- resolve_tenant_storage_capacity_v1 · capacity with its source, never NULL
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tenant_storage_capacity_v1(
  p_tenant_id uuid
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
  as $function$
declare
  v_current_id uuid;
  v_sub_id uuid;
  v_limit bigint;
begin
  if p_tenant_id is null then
    return pg_catalog.jsonb_build_object(
      'limit_bytes', 0, 'source', 'no_subscription', 'subscription_id', null
    );
  end if;

  -- 1. Current subscription (at most one: subscriptions_one_current_per_tenant_idx).
  select s.id into v_current_id
  from public.subscriptions s
  where s.tenant_id = p_tenant_id
    and s.status = any (array['trialing', 'active', 'past_due']::text[])
  order by s.created_at desc
  limit 1;

  if v_current_id is not null then
    select pf.limit_value into v_limit
    from public.subscriptions s
    join public.plan_features pf on pf.plan_id = s.plan_id
    join public.features f on f.id = pf.feature_id
    where s.id = v_current_id
      and f.code = 'storage_bytes'
      and pf.enabled is true
      and pf.limit_value is not null;

    if v_limit is not null then
      return pg_catalog.jsonb_build_object(
        'limit_bytes', v_limit, 'source', 'current_plan', 'subscription_id', v_current_id
      );
    end if;
  end if;

  -- 2. Last contracted capacity, any status (S2).
  select s.id, pf.limit_value into v_sub_id, v_limit
  from public.subscriptions s
  join public.plan_features pf on pf.plan_id = s.plan_id
  join public.features f on f.id = pf.feature_id
  where s.tenant_id = p_tenant_id
    and f.code = 'storage_bytes'
    and pf.enabled is true
    and pf.limit_value is not null
  order by s.created_at desc
  limit 1;

  if v_sub_id is not null then
    return pg_catalog.jsonb_build_object(
      'limit_bytes', v_limit, 'source', 'last_contracted', 'subscription_id', v_sub_id
    );
  end if;

  -- 3. Nothing contracted: zero, never unlimited.
  return pg_catalog.jsonb_build_object(
    'limit_bytes', 0,
    'source', case
      when exists (select 1 from public.subscriptions s where s.tenant_id = p_tenant_id)
        then 'no_contracted_capacity'
      else 'no_subscription'
    end,
    'subscription_id', null
  );
end;
$function$;

comment on function public.resolve_tenant_storage_capacity_v1(uuid) is
  'Service-only: storage capacity in bytes with its source (current_plan | last_contracted | no_contracted_capacity | no_subscription). Never NULL, never unlimited. Capacity only: write permission is enforced by the upload RPCs.';

revoke all on function public.resolve_tenant_storage_capacity_v1(uuid) from public, anon, authenticated;
grant execute on function public.resolve_tenant_storage_capacity_v1(uuid) to postgres, service_role;

-- ---------------------------------------------------------------------------
-- resolve_tenant_storage_limit_bytes · same signature, never NULL
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tenant_storage_limit_bytes(
  p_tenant_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  return coalesce(
    (public.resolve_tenant_storage_capacity_v1(p_tenant_id) ->> 'limit_bytes')::bigint,
    0
  );
end;
$function$;

comment on function public.resolve_tenant_storage_limit_bytes(uuid) is
  'Effective storage capacity in bytes (resolve_tenant_storage_capacity_v1). Never NULL: 0 when nothing was contracted. Capacity only, not write permission.';

revoke all on function public.resolve_tenant_storage_limit_bytes(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tenant_storage_limit_bytes(uuid)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- grant_internal_subscription_v1 · explicit, authorized and audited
-- ---------------------------------------------------------------------------
create or replace function public.grant_internal_subscription_v1(
  p_tenant_id uuid,
  p_plan_code text,
  p_status text,
  p_current_period_end timestamptz,
  p_reason text,
  p_authorized_by text,
  p_metadata jsonb default '{}'::jsonb
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
  v_authorized_by text := nullif(pg_catalog.btrim(coalesce(p_authorized_by, '')), '');
  v_plan_id uuid;
  v_id uuid;
  v_open integer;
begin
  if p_tenant_id is null
     or p_status is null
     or p_status <> all (array['trialing', 'active']::text[])
     or (p_metadata is not null and pg_catalog.jsonb_typeof(p_metadata) <> 'object')
  then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'invalid_input');
  end if;

  if v_reason is null or pg_catalog.length(v_reason) < 10 then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'reason_required');
  end if;

  if v_authorized_by is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'authorization_required');
  end if;

  if p_current_period_end is not null and p_current_period_end <= pg_catalog.now() then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'period_end_in_past');
  end if;

  select p.id into v_plan_id
  from public.plans p
  where p.code = pg_catalog.btrim(coalesce(p_plan_code, ''))
    and p.active is true;
  if v_plan_id is null then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'plan_not_found');
  end if;

  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'tenant_not_found');
  end if;

  -- Shared tenant billing lock (prepare_billing_checkout_attempt_v2, sync).
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text, 31)
  );

  if exists (
    select 1 from public.subscriptions s
    where s.tenant_id = p_tenant_id
      and s.status = any (array['trialing', 'active', 'past_due']::text[])
  ) then
    return pg_catalog.jsonb_build_object('outcome', 'rejected', 'reason', 'current_subscription_exists');
  end if;

  -- A Checkout Session that can still be paid, or a paid one whose
  -- subscription is not recorded yet, would compete with the grant.
  select count(*) into v_open
  from public.billing_checkout_attempts a
  where a.tenant_id = p_tenant_id
    and (
      (
        a.status = any (array['creating'::text, 'open'::text])
        and a.expires_at + interval '2 minutes' > pg_catalog.now()
      )
      or (
        a.status = 'completed'
        and not exists (
          select 1 from public.subscriptions s
          where s.tenant_id = a.tenant_id
            and s.provider = 'stripe'
            and s.livemode = a.livemode
            and s.created_at >= a.created_at
        )
      )
    );
  if v_open > 0 then
    return pg_catalog.jsonb_build_object(
      'outcome', 'rejected', 'reason', 'checkout_in_progress', 'attempts', v_open
    );
  end if;

  perform pg_catalog.set_config('app.billing_internal_via', 'grant_rpc', true);
  perform pg_catalog.set_config('app.billing_internal_reason', v_reason, true);
  perform pg_catalog.set_config('app.billing_internal_authorized_by', v_authorized_by, true);

  insert into public.subscriptions (
    tenant_id, plan_id, provider, status,
    current_period_start, current_period_end, cancel_at_period_end, livemode, metadata
  ) values (
    p_tenant_id, v_plan_id, 'internal', p_status,
    pg_catalog.now(), p_current_period_end, false, false,
    coalesce(p_metadata, '{}'::jsonb) || pg_catalog.jsonb_build_object(
      'source', 'grant_internal_subscription_v1',
      'granted_at', pg_catalog.now(),
      'grant_reason', v_reason,
      'granted_by', v_authorized_by
    )
  )
  returning id into v_id;

  perform pg_catalog.set_config('app.billing_internal_via', '', true);
  perform pg_catalog.set_config('app.billing_internal_reason', '', true);
  perform pg_catalog.set_config('app.billing_internal_authorized_by', '', true);

  return pg_catalog.jsonb_build_object(
    'outcome', 'granted',
    'subscription_id', v_id,
    'tenant_id', p_tenant_id,
    'plan_code', pg_catalog.btrim(p_plan_code),
    'status', p_status,
    'capacity', public.resolve_tenant_storage_capacity_v1(p_tenant_id)
  );
end;
$function$;

comment on function public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb) is
  'Service-only: grants an internal subscription (trialing/active) with a reason (>= 10 chars) and an authorizer, under the shared tenant billing lock. Refuses when a subscription is current or a Checkout can still be paid. Audited as grant_rpc.';

revoke all on function public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- list_internal_subscription_audit_v1 · read model for operators
-- ---------------------------------------------------------------------------
create or replace function public.list_internal_subscription_audit_v1(
  p_tenant_id uuid default null,
  p_limit integer default 100
)
  returns jsonb
  language sql
  stable
  security definer
  set search_path to ''
  as $function$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.created_at desc, x.id desc), '[]'::jsonb)
  from (
    select a.*
    from billing_private.internal_subscription_audit a
    where p_tenant_id is null or a.tenant_id = p_tenant_id
    order by a.created_at desc, a.id desc
    limit least(greatest(coalesce(p_limit, 100), 1), 1000)
  ) x;
$function$;

comment on function public.list_internal_subscription_audit_v1(uuid, integer) is
  'Service-only: latest audit rows of non-Stripe subscription changes, optionally for one tenant.';

revoke all on function public.list_internal_subscription_audit_v1(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.list_internal_subscription_audit_v1(uuid, integer)
  to postgres, service_role;

commit;
