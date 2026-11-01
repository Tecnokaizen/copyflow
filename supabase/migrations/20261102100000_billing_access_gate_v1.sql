-- Billing Access Gate V1 · commercial access control for every tenant.
--
-- Separates commercial access (subscription state) from tenants.active, which
-- keeps its administrative meaning. Nothing changes for any tenant while the
-- gate mode is 'off' (the default this migration installs):
--   off      → the gate is computed on demand only; nothing is blocked.
--   observe  → the app logs what it would block; nothing is blocked.
--   enforce  → user writes on operational tables are rejected (PT402) and the
--              app redirects suspended tenants to the billing/suspension page.
--
-- RLS policies are not modified. Enforcement is a BEFORE trigger that only acts
-- on requests made with a user JWT (auth.role() authenticated/anon), including
-- SECURITY DEFINER RPCs they call. service_role (webhook, billing, operators)
-- and sessions without a JWT (migrations, cron) are never blocked.

begin;

create schema if not exists billing_private;

-- ---------------------------------------------------------------------------
-- Settings (singleton) and per-tenant exemptions
-- ---------------------------------------------------------------------------
create table if not exists billing_private.access_gate_settings (
  id boolean primary key default true check (id),
  mode text not null default 'off'
    check (mode = any (array['off', 'observe', 'enforce']::text[])),
  past_due_grace_days integer not null default 7
    check (past_due_grace_days between 0 and 30),
  checkout_pending_minutes integer not null default 120
    check (checkout_pending_minutes between 0 and 1440),
  updated_at timestamptz not null default pg_catalog.now(),
  updated_by text,
  history jsonb not null default '[]'::jsonb
);

insert into billing_private.access_gate_settings (id) values (true)
on conflict (id) do nothing;

alter table billing_private.access_gate_settings enable row level security;
revoke all on table billing_private.access_gate_settings
  from public, anon, authenticated, service_role;

comment on table billing_private.access_gate_settings is
  'Billing Access Gate V1 settings (single row). mode off|observe|enforce; past_due grace in days from the start of the unpaid period; checkout pending window in minutes after the session expiry / trial end.';

create table if not exists billing_private.tenant_access_exemptions (
  tenant_id uuid primary key references public.tenants (id) on delete cascade,
  reason text not null check (pg_catalog.length(pg_catalog.btrim(reason)) between 3 and 500),
  authorized_by text not null check (pg_catalog.length(pg_catalog.btrim(authorized_by)) between 3 and 200),
  expires_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  history jsonb not null default '[]'::jsonb
);

alter table billing_private.tenant_access_exemptions enable row level security;
revoke all on table billing_private.tenant_access_exemptions
  from public, anon, authenticated, service_role;

comment on table billing_private.tenant_access_exemptions is
  'Operator-granted commercial exemptions (internal, demo or support tenants). An exemption never changes subscriptions or tenants.active.';

-- ---------------------------------------------------------------------------
-- Core evaluation (private). Pure read; p_at makes it testable.
-- ---------------------------------------------------------------------------
create or replace function billing_private.evaluate_tenant_billing_access (
  p_tenant_id uuid,
  p_at timestamptz
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
  as $function$
declare
  v_at timestamptz := coalesce(p_at, pg_catalog.now());
  v_settings billing_private.access_gate_settings%rowtype;
  v_sub public.subscriptions%rowtype;
  v_last public.subscriptions%rowtype;
  v_exempt billing_private.tenant_access_exemptions%rowtype;
  v_pending_until timestamptz;
  v_grace_until timestamptz;
  v_trial_end timestamptz;
  v_state text;
  v_allowed boolean;
begin
  select * into v_settings from billing_private.access_gate_settings where id;
  if not found then
    v_settings.mode := 'off';
    v_settings.past_due_grace_days := 7;
    v_settings.checkout_pending_minutes := 120;
  end if;

  if p_tenant_id is null then
    return pg_catalog.jsonb_build_object(
      'allowed', false, 'state', 'unknown_tenant', 'mode', v_settings.mode,
      'enforced', v_settings.mode = 'enforce');
  end if;

  -- 1. Operator exemption.
  select * into v_exempt
  from billing_private.tenant_access_exemptions e
  where e.tenant_id = p_tenant_id
    and (e.expires_at is null or e.expires_at > v_at);
  if found then
    return pg_catalog.jsonb_build_object(
      'allowed', true, 'state', 'exempt', 'mode', v_settings.mode,
      'enforced', v_settings.mode = 'enforce',
      'exempt_until', v_exempt.expires_at);
  end if;

  -- 2. Current subscription (at most one: subscriptions_one_current_per_tenant_idx).
  select * into v_sub
  from public.subscriptions s
  where s.tenant_id = p_tenant_id
    and s.status = any (array['trialing', 'active', 'past_due']::text[])
  order by s.created_at desc
  limit 1;

  if found then
    if v_sub.provider = 'stripe' then
      -- Stripe owns the dates: its status is authoritative. A Checkout with a
      -- future billing anchor (first invoice later) is already 'active'.
      if v_sub.status in ('active', 'trialing') then
        v_allowed := true;
        v_state := case when v_sub.cancel_at_period_end or v_sub.cancel_at is not null
                        then 'subscription_canceling' else 'subscription_active' end;
      else
        -- past_due: grace counted from the start of the unpaid period.
        v_grace_until := coalesce(v_sub.current_period_start, v_sub.updated_at)
          + pg_catalog.make_interval(days => v_settings.past_due_grace_days);
        v_allowed := v_at < v_grace_until;
        v_state := case when v_allowed then 'past_due_grace' else 'past_due_suspended' end;
      end if;
    else
      -- Internal trial / pilot: valid until current_period_end, no automatic
      -- extension. NULL end = open-ended internal grant.
      v_trial_end := v_sub.current_period_end;
      if v_trial_end is null or v_at < v_trial_end then
        v_allowed := true;
        v_state := case when v_sub.status = 'trialing' then 'trial_active' else 'internal_active' end;
      else
        v_allowed := false;
        v_state := case when v_sub.status = 'trialing' then 'trial_expired' else 'internal_expired' end;
      end if;
    end if;
  else
    select * into v_last
    from public.subscriptions s
    where s.tenant_id = p_tenant_id
    order by s.created_at desc
    limit 1;
    v_allowed := false;
    v_state := case when found then 'subscription_ended' else 'no_subscription' end;
  end if;

  -- 3. Transitional states: never suspend a contract that is being formalised.
  if not v_allowed then
    -- A Stripe subscription held for reconciliation (webhook arrived while a
    -- protected internal subscription was current).
    if exists (
      select 1 from billing_private.subscription_holds h
      where h.tenant_id = p_tenant_id and h.status = 'held'
    ) then
      v_allowed := true;
      v_state := 'reconciliation_pending';
    else
      -- A Checkout started before the trial ended (or, without a trial, any
      -- recent Checkout): allowed until its expiry / the trial end plus the
      -- pending window, waiting for the webhook.
      select pg_catalog.max(
               greatest(a.expires_at, coalesce(v_trial_end, a.expires_at))
               + pg_catalog.make_interval(mins => v_settings.checkout_pending_minutes))
        into v_pending_until
      from public.billing_checkout_attempts a
      where a.tenant_id = p_tenant_id
        and a.status = any (array['creating', 'open', 'completed']::text[])
        and (v_trial_end is null or a.created_at <= v_trial_end);

      if v_pending_until is not null and v_at < v_pending_until then
        v_allowed := true;
        v_state := 'checkout_pending';
      end if;
    end if;
  end if;

  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'allowed', v_allowed,
    'state', v_state,
    'mode', v_settings.mode,
    'enforced', v_settings.mode = 'enforce',
    'subscription_id', coalesce(v_sub.id, v_last.id),
    'provider', coalesce(v_sub.provider, v_last.provider),
    'status', coalesce(v_sub.status, v_last.status),
    'period_end', coalesce(v_sub.current_period_end, v_last.current_period_end),
    'grace_until', v_grace_until,
    'pending_until', case when v_state = 'checkout_pending' then v_pending_until end,
    'evaluated_at', v_at
  ));
end;
$function$;

revoke all on function billing_private.evaluate_tenant_billing_access(uuid, timestamptz)
  from public, anon, authenticated, service_role;

comment on function billing_private.evaluate_tenant_billing_access(uuid, timestamptz) is
  'Billing Access Gate V1 core. allowed + state: exempt | subscription_active | subscription_canceling | past_due_grace | trial_active | internal_active | reconciliation_pending | checkout_pending (allowed); past_due_suspended | trial_expired | internal_expired | subscription_ended | no_subscription (suspended). Ignores tenants.active.';

-- ---------------------------------------------------------------------------
-- Public wrappers
-- ---------------------------------------------------------------------------
create or replace function public.resolve_tenant_billing_access_v1 (
  p_tenant_id uuid,
  p_at timestamptz default null
)
  returns jsonb
  language sql
  stable
  security definer
  set search_path to ''
  as $function$
  select billing_private.evaluate_tenant_billing_access(p_tenant_id, p_at);
$function$;

revoke all on function public.resolve_tenant_billing_access_v1(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.resolve_tenant_billing_access_v1(uuid, timestamptz)
  to postgres, service_role;

comment on function public.resolve_tenant_billing_access_v1(uuid, timestamptz) is
  'Service-only: full Billing Access Gate evaluation for a tenant (support, reconciliation, tests).';

-- Read for the signed-in user (proxy). Only active members of the tenant get
-- an answer; anyone else gets NULL. Minimal fields, no subscription ids.
create or replace function public.current_tenant_billing_access_v1 (
  p_tenant_slug text
)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
  as $function$
declare
  v_tenant_id uuid;
  v_role text;
  v_eval jsonb;
begin
  if auth.uid() is null or p_tenant_slug is null then
    return null;
  end if;

  select t.id, m.role into v_tenant_id, v_role
  from public.tenants t
  join public.memberships m
    on m.tenant_id = t.id and m.user_id = auth.uid() and m.active is true
  where t.slug = pg_catalog.lower(pg_catalog.btrim(p_tenant_slug));

  if v_tenant_id is null then
    return null;
  end if;

  v_eval := billing_private.evaluate_tenant_billing_access(v_tenant_id, null);
  return pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'allowed', v_eval -> 'allowed',
    'enforced', v_eval -> 'enforced',
    'mode', v_eval -> 'mode',
    'state', v_eval -> 'state',
    'grace_until', v_eval -> 'grace_until',
    'pending_until', v_eval -> 'pending_until',
    'period_end', v_eval -> 'period_end',
    'role', v_role
  ));
end;
$function$;

revoke all on function public.current_tenant_billing_access_v1(text)
  from public, anon;
grant execute on function public.current_tenant_billing_access_v1(text)
  to authenticated, service_role;

comment on function public.current_tenant_billing_access_v1(text) is
  'Signed-in member read of the commercial access state of a tenant (by slug). NULL for non-members. Used by the proxy gate.';

-- True when operational writes are allowed now (always true unless enforce).
create or replace function public.tenant_operational_access_allowed (
  p_tenant_id uuid
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path to ''
  as $function$
declare
  v_eval jsonb;
begin
  v_eval := billing_private.evaluate_tenant_billing_access(p_tenant_id, null);
  return not coalesce((v_eval ->> 'enforced')::boolean, false)
      or coalesce((v_eval ->> 'allowed')::boolean, false);
end;
$function$;

revoke all on function public.tenant_operational_access_allowed(uuid)
  from public, anon, authenticated;
grant execute on function public.tenant_operational_access_allowed(uuid)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Operator functions (service-only, audited)
-- ---------------------------------------------------------------------------
create or replace function public.set_billing_access_gate_settings_v1 (
  p_mode text,
  p_past_due_grace_days integer,
  p_checkout_pending_minutes integer,
  p_authorized_by text,
  p_reason text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_old billing_private.access_gate_settings%rowtype;
begin
  if p_mode is null or p_mode <> all (array['off', 'observe', 'enforce']::text[]) then
    raise exception 'invalid mode' using errcode = '22023';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_authorized_by, ''))) < 3
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'authorized_by and reason are required' using errcode = '22023';
  end if;

  select * into v_old from billing_private.access_gate_settings where id for update;

  update billing_private.access_gate_settings s
  set mode = p_mode,
      past_due_grace_days = coalesce(p_past_due_grace_days, s.past_due_grace_days),
      checkout_pending_minutes = coalesce(p_checkout_pending_minutes, s.checkout_pending_minutes),
      updated_at = pg_catalog.now(),
      updated_by = pg_catalog.btrim(p_authorized_by),
      history = s.history || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'at', pg_catalog.now(), 'by', pg_catalog.btrim(p_authorized_by), 'reason', pg_catalog.btrim(p_reason),
        'from', pg_catalog.jsonb_build_object('mode', v_old.mode, 'grace_days', v_old.past_due_grace_days,
                                              'pending_minutes', v_old.checkout_pending_minutes),
        'to', pg_catalog.jsonb_build_object('mode', p_mode,
              'grace_days', coalesce(p_past_due_grace_days, v_old.past_due_grace_days),
              'pending_minutes', coalesce(p_checkout_pending_minutes, v_old.checkout_pending_minutes))))
  where s.id;

  return (select pg_catalog.jsonb_build_object('mode', s.mode, 'past_due_grace_days', s.past_due_grace_days,
                 'checkout_pending_minutes', s.checkout_pending_minutes)
          from billing_private.access_gate_settings s where s.id);
end;
$function$;

revoke all on function public.set_billing_access_gate_settings_v1(text, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.set_billing_access_gate_settings_v1(text, integer, integer, text, text)
  to postgres, service_role;

create or replace function public.set_tenant_billing_access_exemption_v1 (
  p_tenant_id uuid,
  p_exempt boolean,
  p_expires_at timestamptz,
  p_authorized_by text,
  p_reason text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
begin
  if p_tenant_id is null or p_exempt is null then
    raise exception 'tenant and exempt are required' using errcode = '22023';
  end if;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_authorized_by, ''))) < 3
     or pg_catalog.length(pg_catalog.btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'authorized_by and reason are required' using errcode = '22023';
  end if;
  if p_exempt and p_expires_at is not null and p_expires_at <= pg_catalog.now() then
    raise exception 'expires_at must be in the future' using errcode = '22023';
  end if;
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id) then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  if p_exempt then
    insert into billing_private.tenant_access_exemptions as e
      (tenant_id, reason, authorized_by, expires_at, history)
    values (p_tenant_id, pg_catalog.btrim(p_reason), pg_catalog.btrim(p_authorized_by), p_expires_at,
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
              'at', pg_catalog.now(), 'action', 'granted', 'by', pg_catalog.btrim(p_authorized_by),
              'reason', pg_catalog.btrim(p_reason), 'expires_at', p_expires_at)))
    on conflict (tenant_id) do update
      set reason = excluded.reason,
          authorized_by = excluded.authorized_by,
          expires_at = excluded.expires_at,
          updated_at = pg_catalog.now(),
          history = e.history || excluded.history;
    return pg_catalog.jsonb_build_object('outcome', 'exempt', 'tenant_id', p_tenant_id, 'expires_at', p_expires_at);
  end if;

  delete from billing_private.tenant_access_exemptions e where e.tenant_id = p_tenant_id;
  return pg_catalog.jsonb_build_object('outcome', case when found then 'removed' else 'unchanged' end,
                                       'tenant_id', p_tenant_id);
end;
$function$;

revoke all on function public.set_tenant_billing_access_exemption_v1(uuid, boolean, timestamptz, text, text)
  from public, anon, authenticated;
grant execute on function public.set_tenant_billing_access_exemption_v1(uuid, boolean, timestamptz, text, text)
  to postgres, service_role;

-- ---------------------------------------------------------------------------
-- Enforcement trigger on operational tables
-- ---------------------------------------------------------------------------
create or replace function billing_private.tg_enforce_operational_access()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_role text := coalesce(auth.role(), '');
  v_row jsonb;
  v_tenant uuid;
  v_key text;
  v_cached text;
  v_eval jsonb;
begin
  -- Only user requests (PostgREST with a user/anon JWT, including the
  -- SECURITY DEFINER RPCs they call). service_role and no-JWT sessions pass.
  if v_role <> all (array['authenticated', 'anon']::text[]) then
    return coalesce(new, old);
  end if;

  v_row := pg_catalog.to_jsonb(case when tg_op = 'DELETE' then old else new end);
  v_tenant := (v_row ->> tg_argv[0])::uuid;
  if v_tenant is null then
    return coalesce(new, old);
  end if;

  -- Per-transaction cache: one evaluation per tenant per transaction.
  v_key := 'app.billing_gate_' || pg_catalog.replace(v_tenant::text, '-', '');
  v_cached := nullif(pg_catalog.current_setting(v_key, true), '');
  if v_cached is null then
    v_eval := billing_private.evaluate_tenant_billing_access(v_tenant, null);
    if not coalesce((v_eval ->> 'enforced')::boolean, false)
       or coalesce((v_eval ->> 'allowed')::boolean, false) then
      v_cached := 'allow';
    else
      v_cached := 'deny:' || coalesce(v_eval ->> 'state', 'suspended');
    end if;
    perform pg_catalog.set_config(v_key, v_cached, true);
  end if;

  if v_cached <> 'allow' then
    raise exception 'billing_suspended'
      using errcode = 'PT402',
            detail = pg_catalog.substr(v_cached, 6),
            hint = 'La operativa está suspendida hasta regularizar la suscripción (Ajustes → Facturación).';
  end if;

  return coalesce(new, old);
end;
$function$;

revoke all on function billing_private.tg_enforce_operational_access()
  from public, anon, authenticated, service_role;

comment on function billing_private.tg_enforce_operational_access() is
  'Billing Access Gate V1: BEFORE INSERT/UPDATE/DELETE row trigger. tg_argv[0] = tenant column. Raises PT402 billing_suspended for user JWT requests when mode = enforce and the tenant is commercially suspended.';

do $do$
declare
  v_table text;
  v_column text;
  v_spec text[];
  v_specs text[][] := array[
    array['public.clients', 'tenant_id'],
    array['public.customer_types', 'tenant_id'],
    array['public.delivery_methods', 'tenant_id'],
    array['public.entry_channels', 'tenant_id'],
    array['public.file_statuses', 'tenant_id'],
    array['public.memberships', 'tenant_id'],
    array['public.order_contexts', 'tenant_id'],
    array['public.order_files', 'tenant_id'],
    array['public.order_items', 'tenant_id'],
    array['public.order_note_events', 'tenant_id'],
    array['public.order_note_versions', 'tenant_id'],
    array['public.order_notes', 'tenant_id'],
    array['public.order_payments', 'tenant_id'],
    array['public.order_statuses', 'tenant_id'],
    array['public.order_work_steps', 'tenant_id'],
    array['public.orders', 'tenant_id'],
    array['public.payment_statuses', 'tenant_id'],
    array['public.quote_draft_creations', 'tenant_id'],
    array['public.quote_files', 'tenant_id'],
    array['public.quote_items', 'tenant_id'],
    array['public.quote_statuses', 'tenant_id'],
    array['public.quote_versions', 'tenant_id'],
    array['public.quotes', 'tenant_id'],
    array['public.service_categories', 'tenant_id'],
    array['public.services', 'tenant_id'],
    array['public.stores', 'tenant_id'],
    array['public.team_members', 'tenant_id'],
    array['public.tenant_domains', 'tenant_id'],
    array['public.tenant_invitations', 'tenant_id'],
    array['public.tenant_settings', 'tenant_id'],
    array['public.work_stages', 'tenant_id'],
    array['public.ai_usage_events', 'tenant_id'],
    array['imports_private.client_import_batches', 'tenant_id'],
    array['imports_private.client_import_rows', 'tenant_id'],
    array['public.tenants', 'id']
  ];
begin
  foreach v_spec slice 1 in array v_specs loop
    v_table := v_spec[1];
    v_column := v_spec[2];
    if pg_catalog.to_regclass(v_table) is null then
      raise exception 'billing access gate: table % not found', v_table;
    end if;
    execute pg_catalog.format('drop trigger if exists trg_billing_access_gate on %s', v_table);
    execute pg_catalog.format(
      'create trigger trg_billing_access_gate before insert or update or delete on %s '
      'for each row execute function billing_private.tg_enforce_operational_access(%L)',
      v_table, v_column);
  end loop;
end;
$do$;

commit;
