-- Tenant feature grants V1 (Frente A1): auditable operator overrides.
-- docs/TENANT-FEATURE-GRANTS-V1.md
--
-- State before A1 (20260923190000_quotes_v1.sql):
--   * tenant_feature_overrides: RLS on, no policies. anon/authenticated hold
--     nothing; service_role only the default TRUNCATE/REFERENCES/TRIGGER/
--     MAINTAIN. No reason, operator, review date or history.
--   * set_tenant_feature(slug, code, enabled, limit): EXECUTE for service_role
--     only. Its check reads current_user, which inside SECURITY DEFINER is
--     always the owner, so the EXECUTE grant is its only barrier. Signature,
--     body and grants stay as they are; its calls are now recorded.
--   * tenant_has_feature: unchanged (override, then active/trialing plan,
--     else false). review_at plays no part in it.
--
-- Adds:
--   1. The terms of the current override: reason, granted_by, granted_at and
--      review_at. Only set_tenant_feature_v2 writes them. Any other change of
--      enabled/limit_value clears reason/granted_by/granted_at; review_at is
--      kept as a reminder.
--   2. tenant_feature_override_events: append-only history, one row per
--      inserted, updated or deleted override, whatever the path (v2, clear,
--      v1, direct SQL, tenant or feature deletion). No foreign keys, so the
--      history outlives the tenant. No privileges for any API role.
--   3. set_tenant_feature_v2, clear_tenant_feature_override and
--      list_tenant_feature_reviews_due: EXECUTE for service_role and, inside,
--      the operator rule of tenant_has_feature (JWT role service_role, or a
--      postgres/supabase_admin session without JWT claims).
--   4. TRUNCATE of tenant_feature_overrides is refused (it would skip the
--      history) and service_role loses its default TRUNCATE on the table.
--
-- Does NOT revoke or expire anything (review_at is a reminder), touch plans,
-- subscriptions, prices or quotas, change set_tenant_feature or
-- tenant_has_feature, or grant any feature to any tenant.
-- Rollback: supabase/rollbacks/20261017120000_tenant_feature_grants_audit_v1.sql
begin;

-- 1. Terms of the current override ------------------------------------------

alter table public.tenant_feature_overrides
  add column reason text,
  add column granted_by text,
  add column granted_at timestamp with time zone,
  add column review_at timestamp with time zone,
  add constraint tenant_feature_overrides_reason_check
    check (reason is null or pg_catalog.char_length(pg_catalog.btrim(reason)) between 1 and 500),
  add constraint tenant_feature_overrides_granted_by_check
    check (granted_by is null or pg_catalog.char_length(pg_catalog.btrim(granted_by)) between 1 and 200),
  add constraint tenant_feature_overrides_terms_check
    check (
      (reason is null) = (granted_by is null)
      and (reason is null) = (granted_at is null)
    );

comment on table public.tenant_feature_overrides is
  'Explicit tenant feature gate. Overrides the plan. No client writes. Terms (reason, granted_by, granted_at, review_at) are written only by set_tenant_feature_v2; every change is recorded in tenant_feature_override_events.';
comment on column public.tenant_feature_overrides.reason is
  'Why the current value was set (set_tenant_feature_v2). NULL for legacy rows and after a change through any other path.';
comment on column public.tenant_feature_overrides.granted_by is
  'Operator responsible for the current value (set_tenant_feature_v2).';
comment on column public.tenant_feature_overrides.granted_at is
  'When the current terms were set (set_tenant_feature_v2).';
comment on column public.tenant_feature_overrides.review_at is
  'Review reminder. Never disables anything: see list_tenant_feature_reviews_due.';

-- 2. Append-only history ----------------------------------------------------

create table public.tenant_feature_override_events (
  id bigint generated always as identity,
  occurred_at timestamp with time zone not null default pg_catalog.now(),
  tenant_id uuid not null,
  tenant_slug text,
  feature_id uuid not null,
  feature_code text,
  action text not null,
  source text not null,
  reason text,
  operator text,
  old_enabled boolean,
  old_limit_value bigint,
  old_review_at timestamp with time zone,
  new_enabled boolean,
  new_limit_value bigint,
  new_review_at timestamp with time zone,
  actor_db_user text not null,
  actor_jwt_role text,
  actor_user_id uuid,
  constraint tenant_feature_override_events_pkey primary key (id),
  constraint tenant_feature_override_events_action_check
    check (action in ('baseline', 'created', 'updated', 'cleared')),
  constraint tenant_feature_override_events_source_check
    check (
      case source
        when 'migration' then action = 'baseline'
        when 'set_tenant_feature_v2' then action in ('created', 'updated')
        when 'set_tenant_feature' then action in ('created', 'updated')
        when 'clear_tenant_feature_override' then action = 'cleared'
        when 'direct_sql' then action in ('created', 'updated', 'cleared')
        when 'tenant_deleted' then action = 'cleared'
        when 'feature_deleted' then action = 'cleared'
        else false
      end
    ),
  constraint tenant_feature_override_events_values_check
    check (
      case action
        when 'cleared' then old_enabled is not null
          and new_enabled is null and new_limit_value is null and new_review_at is null
        when 'updated' then old_enabled is not null and new_enabled is not null
        else old_enabled is null and old_limit_value is null and old_review_at is null
          and new_enabled is not null
      end
    ),
  constraint tenant_feature_override_events_attribution_check
    check (
      (source in ('migration', 'set_tenant_feature_v2', 'clear_tenant_feature_override'))
      = (reason is not null and operator is not null)
    )
);

create index tenant_feature_override_events_key_idx
  on public.tenant_feature_override_events (tenant_id, feature_id, id);

alter table public.tenant_feature_override_events enable row level security;

revoke all on table public.tenant_feature_override_events
  from public, anon, authenticated, service_role;
revoke all on sequence public.tenant_feature_override_events_id_seq
  from public, anon, authenticated, service_role;

comment on table public.tenant_feature_override_events is
  'Append-only history of tenant_feature_overrides (A1). One row per inserted, updated or deleted override. No foreign keys: it outlives tenants and features. No API role has privileges; operators read it as the database owner.';
comment on column public.tenant_feature_override_events.source is
  'set_tenant_feature_v2 / clear_tenant_feature_override (reason and operator required), set_tenant_feature (legacy v1), direct_sql, tenant_deleted / feature_deleted (cascade), migration (state found by A1).';
comment on column public.tenant_feature_override_events.reason is
  'Justification of this change (v2, clear, migration). NULL for unattributed paths.';
comment on column public.tenant_feature_override_events.operator is
  'Operator declared for this change (v2, clear, migration).';
comment on column public.tenant_feature_override_events.actor_db_user is
  'session_user of the change: authenticator (API), postgres (SQL editor or migration), supabase_admin.';

-- Refuses UPDATE/DELETE of history and TRUNCATE of either table.
create function public.tg_tenant_feature_audit_refuse_v1()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
begin
  raise exception '% on public.% is not allowed: the tenant feature history must stay complete',
    tg_op, tg_table_name
    using errcode = '42501';
end;
$function$;

comment on function public.tg_tenant_feature_audit_refuse_v1() is
  'Trigger only. Keeps tenant_feature_override_events append-only and tenant_feature_overrides untruncatable.';

revoke all on function public.tg_tenant_feature_audit_refuse_v1()
  from public, anon, authenticated, service_role;

create trigger trg_tenant_feature_override_events_append_only
  before update or delete on public.tenant_feature_override_events
  for each row execute function public.tg_tenant_feature_audit_refuse_v1();

create trigger trg_tenant_feature_override_events_no_truncate
  before truncate on public.tenant_feature_override_events
  for each statement execute function public.tg_tenant_feature_audit_refuse_v1();

-- State found by A1: one baseline event per existing override.
insert into public.tenant_feature_override_events (
  tenant_id, tenant_slug, feature_id, feature_code, action, source, reason, operator,
  new_enabled, new_limit_value, actor_db_user, actor_jwt_role
)
select
  o.tenant_id, t.slug, o.feature_id, f.code, 'baseline', 'migration',
  'Override present before A1; no recorded reason.', 'migration 20261017120000',
  o.enabled, o.limit_value, session_user, nullif(auth.role(), '')
from public.tenant_feature_overrides o
join public.tenants t on t.id = o.tenant_id
join public.features f on f.id = o.feature_id
order by t.slug, f.code;

-- 3. Recording every change of tenant_feature_overrides ---------------------
--
-- The path is the immediate PL/pgSQL caller of the INSERT/UPDATE/DELETE, read
-- from PG_CONTEXT: the first "PL/pgSQL function" frame after this trigger's
-- own frame (the fixed DML of the callers below never contains one). Unknown
-- or missing callers are direct_sql: attribution can only degrade, never
-- block a change. clear_tenant_feature_override passes its reason and
-- operator in the transaction-local setting app.tenant_feature_override_clear.
create function public.tg_tenant_feature_overrides_audit_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_context text;
  v_caller text;
  v_source text;
  v_marker jsonb;
  v_reason text;
  v_operator text;
begin
  get diagnostics v_context = pg_context;
  v_caller := pg_catalog.substring(v_context, '\nPL/pgSQL function ([^\n]+) line [0-9]+ at ');
  v_caller := pg_catalog.regexp_replace(coalesce(v_caller, ''), '^public\.', '');
  v_source := case v_caller
    when 'set_tenant_feature_v2(text,text,boolean,bigint,text,timestamp with time zone,text)'
      then 'set_tenant_feature_v2'
    when 'clear_tenant_feature_override(text,text,text,text)'
      then 'clear_tenant_feature_override'
    when 'set_tenant_feature(text,text,boolean,bigint)'
      then 'set_tenant_feature'
    else 'direct_sql'
  end;

  if tg_when = 'BEFORE' then
    if tg_op = 'UPDATE'
       and (new.tenant_id <> old.tenant_id or new.feature_id <> old.feature_id) then
      raise exception 'tenant_feature_overrides key is immutable'
        using errcode = '42501';
    end if;

    -- Terms belong to set_tenant_feature_v2 only.
    if v_source <> 'set_tenant_feature_v2' then
      if tg_op = 'INSERT' then
        new.reason := null;
        new.granted_by := null;
        new.granted_at := null;
        new.review_at := null;
      else
        if new.enabled is distinct from old.enabled
           or new.limit_value is distinct from old.limit_value then
          new.reason := null;
          new.granted_by := null;
          new.granted_at := null;
        else
          new.reason := old.reason;
          new.granted_by := old.granted_by;
          new.granted_at := old.granted_at;
        end if;
        new.review_at := old.review_at;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_source = 'clear_tenant_feature_override' then
      v_marker := nullif(pg_catalog.current_setting('app.tenant_feature_override_clear', true), '')::jsonb;
      if v_marker is null
         or (v_marker ->> 'tenant_id')::uuid is distinct from old.tenant_id
         or (v_marker ->> 'feature_id')::uuid is distinct from old.feature_id then
        raise exception 'clear_tenant_feature_override context missing'
          using errcode = 'P0001';
      end if;
      v_reason := v_marker ->> 'reason';
      v_operator := v_marker ->> 'operator';
    elsif v_source = 'direct_sql' then
      if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
        v_source := 'tenant_deleted';
      elsif not exists (select 1 from public.features f where f.id = old.feature_id) then
        v_source := 'feature_deleted';
      end if;
    end if;
  elsif v_source = 'set_tenant_feature_v2' then
    v_reason := new.reason;
    v_operator := new.granted_by;
  end if;

  insert into public.tenant_feature_override_events (
    tenant_id, tenant_slug, feature_id, feature_code, action, source, reason, operator,
    old_enabled, old_limit_value, old_review_at,
    new_enabled, new_limit_value, new_review_at,
    actor_db_user, actor_jwt_role, actor_user_id
  )
  select
    k.tenant_id,
    (select t.slug from public.tenants t where t.id = k.tenant_id),
    k.feature_id,
    (select f.code from public.features f where f.id = k.feature_id),
    case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'cleared' end,
    v_source,
    v_reason,
    v_operator,
    case when tg_op <> 'INSERT' then old.enabled end,
    case when tg_op <> 'INSERT' then old.limit_value end,
    case when tg_op <> 'INSERT' then old.review_at end,
    case when tg_op <> 'DELETE' then new.enabled end,
    case when tg_op <> 'DELETE' then new.limit_value end,
    case when tg_op <> 'DELETE' then new.review_at end,
    session_user,
    nullif(auth.role(), ''),
    auth.uid()
  from (
    select
      case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end as tenant_id,
      case when tg_op = 'DELETE' then old.feature_id else new.feature_id end as feature_id
  ) k;

  return null;
end;
$function$;

comment on function public.tg_tenant_feature_overrides_audit_v1() is
  'Trigger only. BEFORE: key immutable; terms writable only by set_tenant_feature_v2. AFTER: one tenant_feature_override_events row per change, attributed from the immediate caller.';

revoke all on function public.tg_tenant_feature_overrides_audit_v1()
  from public, anon, authenticated, service_role;

create trigger trg_tenant_feature_overrides_terms
  before insert or update on public.tenant_feature_overrides
  for each row execute function public.tg_tenant_feature_overrides_audit_v1();

create trigger trg_tenant_feature_overrides_audit
  after insert or update or delete on public.tenant_feature_overrides
  for each row execute function public.tg_tenant_feature_overrides_audit_v1();

create trigger trg_tenant_feature_overrides_no_truncate
  before truncate on public.tenant_feature_overrides
  for each statement execute function public.tg_tenant_feature_audit_refuse_v1();

revoke truncate on table public.tenant_feature_overrides from service_role;

comment on function public.set_tenant_feature(text, text, boolean, bigint) is
  'Idempotent operator override. service_role or database owner only. Legacy: prefer set_tenant_feature_v2 (reason and operator). Calls are recorded in tenant_feature_override_events without reason.';

-- 4. Operator functions -------------------------------------------------------

create function public.set_tenant_feature_v2 (
  p_slug text,
  p_code text,
  p_enabled boolean,
  p_limit bigint,
  p_reason text,
  p_review_at timestamp with time zone,
  p_operator text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_role text := coalesce(auth.role(), '');
  v_reason text := pg_catalog.btrim(p_reason);
  v_operator text := pg_catalog.btrim(p_operator);
  v_tenant uuid;
  v_feature uuid;
  v_event_id bigint;
  v_event public.tenant_feature_override_events%rowtype;
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

  if p_enabled is null then
    raise exception 'enabled is required'
      using errcode = '22023';
  end if;
  if p_limit < 0 then
    raise exception 'limit must be null or >= 0'
      using errcode = '22023';
  end if;
  if coalesce(pg_catalog.char_length(v_reason), 0) not between 1 and 500 then
    raise exception 'reason is required (1-500 characters)'
      using errcode = '22023';
  end if;
  if coalesce(pg_catalog.char_length(v_operator), 0) not between 1 and 200 then
    raise exception 'operator is required (1-200 characters)'
      using errcode = '22023';
  end if;
  if p_review_at <= pg_catalog.now() then
    raise exception 'review_at must be in the future'
      using errcode = '22023';
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
    tenant_id, feature_id, enabled, limit_value, reason, granted_by, granted_at, review_at
  ) values (
    v_tenant, v_feature, p_enabled, p_limit, v_reason, v_operator, pg_catalog.now(), p_review_at
  )
  on conflict (tenant_id, feature_id) do update
  set
    enabled = excluded.enabled,
    limit_value = excluded.limit_value,
    reason = excluded.reason,
    granted_by = excluded.granted_by,
    granted_at = excluded.granted_at,
    review_at = excluded.review_at,
    updated_at = pg_catalog.now();

  -- The event the trigger has just written (same session, single row).
  v_event_id := pg_catalog.currval(
    pg_catalog.pg_get_serial_sequence('public.tenant_feature_override_events', 'id'));

  select e.* into strict v_event
  from public.tenant_feature_override_events e
  where e.id = v_event_id
    and e.tenant_id = v_tenant
    and e.feature_id = v_feature
    and e.source = 'set_tenant_feature_v2';

  return pg_catalog.jsonb_build_object(
    'event_id', v_event.id,
    'action', v_event.action,
    'tenant_id', v_tenant,
    'tenant_slug', p_slug,
    'feature_code', p_code,
    'previous', case when v_event.action = 'updated' then
      pg_catalog.jsonb_build_object(
        'enabled', v_event.old_enabled,
        'limit_value', v_event.old_limit_value,
        'review_at', v_event.old_review_at
      )
    end,
    'current', pg_catalog.jsonb_build_object(
      'enabled', p_enabled,
      'limit_value', p_limit,
      'reason', v_reason,
      'granted_by', v_operator,
      'granted_at', pg_catalog.now(),
      'review_at', p_review_at
    )
  );
end;
$function$;

comment on function public.set_tenant_feature_v2(text, text, boolean, bigint, text, timestamp with time zone, text) is
  'Operator grant with terms. service_role or a postgres/supabase_admin session without JWT. Reason and operator required; review_at optional (future) and only a reminder. Upsert plus one history event, atomically. Returns the event, previous and current values.';

revoke all on function public.set_tenant_feature_v2(text, text, boolean, bigint, text, timestamp with time zone, text)
  from public, anon, authenticated;
grant execute on function public.set_tenant_feature_v2(text, text, boolean, bigint, text, timestamp with time zone, text)
  to service_role;

create function public.clear_tenant_feature_override (
  p_slug text,
  p_code text,
  p_reason text,
  p_operator text
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_role text := coalesce(auth.role(), '');
  v_reason text := pg_catalog.btrim(p_reason);
  v_operator text := pg_catalog.btrim(p_operator);
  v_tenant uuid;
  v_feature uuid;
  v_removed integer;
  v_event_id bigint;
  v_event public.tenant_feature_override_events%rowtype;
begin
  if not (
    v_role = 'service_role'
    or (v_role = '' and session_user in ('postgres', 'supabase_admin'))
  ) then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  if coalesce(pg_catalog.char_length(v_reason), 0) not between 1 and 500 then
    raise exception 'reason is required (1-500 characters)'
      using errcode = '22023';
  end if;
  if coalesce(pg_catalog.char_length(v_operator), 0) not between 1 and 200 then
    raise exception 'operator is required (1-200 characters)'
      using errcode = '22023';
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

  perform pg_catalog.set_config(
    'app.tenant_feature_override_clear',
    pg_catalog.jsonb_build_object(
      'tenant_id', v_tenant,
      'feature_id', v_feature,
      'reason', v_reason,
      'operator', v_operator
    )::text,
    true
  );

  delete from public.tenant_feature_overrides o
  where o.tenant_id = v_tenant
    and o.feature_id = v_feature;
  get diagnostics v_removed = row_count;

  perform pg_catalog.set_config('app.tenant_feature_override_clear', '', true);

  if v_removed = 0 then
    return pg_catalog.jsonb_build_object(
      'removed', false,
      'event_id', null,
      'tenant_id', v_tenant,
      'tenant_slug', p_slug,
      'feature_code', p_code,
      'previous', null
    );
  end if;

  v_event_id := pg_catalog.currval(
    pg_catalog.pg_get_serial_sequence('public.tenant_feature_override_events', 'id'));

  select e.* into strict v_event
  from public.tenant_feature_override_events e
  where e.id = v_event_id
    and e.tenant_id = v_tenant
    and e.feature_id = v_feature
    and e.source = 'clear_tenant_feature_override';

  return pg_catalog.jsonb_build_object(
    'removed', true,
    'event_id', v_event.id,
    'tenant_id', v_tenant,
    'tenant_slug', p_slug,
    'feature_code', p_code,
    'previous', pg_catalog.jsonb_build_object(
      'enabled', v_event.old_enabled,
      'limit_value', v_event.old_limit_value,
      'review_at', v_event.old_review_at
    )
  );
end;
$function$;

comment on function public.clear_tenant_feature_override(text, text, text, text) is
  'Operator withdrawal: deletes the override so the tenant falls back to its plan (the state before any override). Reason and operator required; one history event. Idempotent: returns removed=false and writes nothing when there is no override.';

revoke all on function public.clear_tenant_feature_override(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.clear_tenant_feature_override(text, text, text, text)
  to service_role;

create function public.list_tenant_feature_reviews_due (
  p_as_of timestamp with time zone default null
)
  returns table (
    tenant_id uuid,
    tenant_slug text,
    feature_code text,
    enabled boolean,
    limit_value bigint,
    reason text,
    granted_by text,
    granted_at timestamp with time zone,
    review_at timestamp with time zone
  )
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_role text := coalesce(auth.role(), '');
begin
  if not (
    v_role = 'service_role'
    or (v_role = '' and session_user in ('postgres', 'supabase_admin'))
  ) then
    raise exception 'forbidden'
      using errcode = '42501';
  end if;

  return query
  select o.tenant_id, t.slug, f.code, o.enabled, o.limit_value,
         o.reason, o.granted_by, o.granted_at, o.review_at
  from public.tenant_feature_overrides o
  join public.tenants t on t.id = o.tenant_id
  join public.features f on f.id = o.feature_id
  where o.review_at <= coalesce(p_as_of, pg_catalog.now())
  order by o.review_at, t.slug, f.code;
end;
$function$;

comment on function public.list_tenant_feature_reviews_due(timestamp with time zone) is
  'Read-only operator report: overrides whose review_at is due at p_as_of (default now). Changes nothing.';

revoke all on function public.list_tenant_feature_reviews_due(timestamp with time zone)
  from public, anon, authenticated;
grant execute on function public.list_tenant_feature_reviews_due(timestamp with time zone)
  to service_role;

commit;
