-- SUR4 E7 · Work sequence of an order (multirresponsabilidad).
-- ADR SUR4-01, contract docs/SUR4-FICHA-POSTITS-CONTRATO.md §8, and the F1·01/02
-- design with the 27/10 adjustments (D5 executor, D6 inactive people, D14
-- optional person while pending, D15 version, D16 A1 grant).
--
-- An order keeps ONE responsible person (orders.assigned_team_member_id, not
-- touched) and may get an optional ordered sequence of 1-10 steps:
--   * public.work_stages       per-tenant catalog of stages (Diseño, Impresión…),
--                              no seed. Never deleted: deactivated.
--   * public.order_work_steps  one row per step: stage, assigned person (optional
--                              while pending), who did it, which account marked
--                              it and when. is_current marks the first step not
--                              done; only the RPCs maintain it.
-- Registers the A1 feature order_work_sequence, born off.
--
-- Access
--   * authenticated: SELECT only, with RLS is_tenant_member AND the feature
--     order_work_sequence. No direct writes: row triggers demand the
--     transaction-local markers gestcopy.order_work_steps_write and
--     gestcopy.work_stages_write = '1' (NULL = denied), which only the
--     SECURITY DEFINER RPCs below set.
--   * Without the feature every RPC answers not_found, like quotes and post-its.
--   * Steps: owner, admin, manager and staff. Stages: owner, admin and manager.
--
-- Rules
--   * Eligibility is R6 (team_member_is_assignable): checked only when a step's
--     person or executor takes a NEW non-null value, so done steps of people
--     deactivated later are kept untouched (D6).
--   * A done step cannot be removed or change its stage or person (step_done):
--     undo it first. Marking needs an assigned person (step_unassigned) and an
--     eligible assigned person and executor (member_unassignable).
--   * Changing the sequence and marking/unmarking bump orders.row_version once
--     (D15). Marking is idempotent and needs no version: two people marking at
--     the same time keep the executor and time of the first.
--   * No automation: finishing steps never changes status, responsible person
--     or sends anything (D10).
--
-- Concurrency: every step write locks the order FOR UPDATE first, then the
-- team_members rows it checks FOR SHARE, so nobody is deactivated between the
-- check and the write. A partial unique index keeps one current step per order.
--
-- R5: the RPCs are SECURITY DEFINER owned by postgres, so tg_orders_write_guard
-- lets their single UPDATE of orders through. They do not mention app.order_write
-- (release gate invariant 7c keeps that marker to SECURITY INVOKER writers).
--
-- Activity: order.work_steps_changed, order.work_step_completed and
-- order.work_step_reopened, entity order, with the names of that moment.
--
-- Not touched: orders columns and triggers (except the BEFORE DELETE purge),
-- team_members, kiosk, existing RPC signatures and answers. No data is filled.
-- Rollback: supabase/rollbacks/20261028130000_order_work_sequence_v1.sql
begin;

do $precondition$
begin
  if pg_catalog.to_regprocedure('public.tg_orders_write_guard()') is null then
    raise exception 'SUR4 E7 requires R5 (20261022120000_order_direct_write_guard_v1)';
  end if;
  if pg_catalog.to_regprocedure('public.team_member_is_assignable(uuid,uuid)') is null then
    raise exception 'SUR4 E7 requires R6 (20261022130000_assignee_eligibility_v1)';
  end if;
  if pg_catalog.to_regprocedure('public.tenant_has_feature(uuid,text)') is null then
    raise exception 'SUR4 E7 requires A1 (public.tenant_has_feature)';
  end if;
  if exists (
    select 1
    from public.features f
    where f.id = '31000000-0000-4000-8000-000000000014'
      and f.code <> 'order_work_sequence'
  ) then
    raise exception 'SUR4 E7: feature id 014 is already used by another code';
  end if;
end
$precondition$;

-- ---------------------------------------------------------------------------
-- 1. A1 feature (born off)
-- ---------------------------------------------------------------------------
insert into public.features (id, code, name, description)
values (
  '31000000-0000-4000-8000-000000000014',
  'order_work_sequence',
  'Secuencia de trabajo',
  'Pasos ordenados del pedido con fase, persona asignada y quién lo hizo.'
)
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = pg_catalog.now();

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.work_stages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  icon text not null default 'other',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint work_stages_tenant_id_unique unique (tenant_id, id),
  -- No BETWEEN next to AND: it is stored as a nested AND that pg_dump writes out
  -- and the restore flattens, which changes the definition the B1.3 backup
  -- check compares (same rule, different text).
  constraint work_stages_name_length
    check (
      pg_catalog.char_length(name) >= 1
      and pg_catalog.char_length(name) <= 40
      and name = pg_catalog.btrim(name)
    ),
  constraint work_stages_icon_check
    check (icon in ('design', 'prepare', 'print', 'finish', 'cut', 'bind', 'review', 'deliver', 'other')),
  constraint work_stages_sort_order_check check (sort_order between 0 and 1000)
);

create unique index work_stages_tenant_name_unique
  on public.work_stages (tenant_id, pg_catalog.lower(name));
create index work_stages_tenant_active_idx
  on public.work_stages (tenant_id, active, sort_order);

create table public.order_work_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null,
  position integer not null,
  stage_id uuid not null,
  team_member_id uuid,
  executed_by_team_member_id uuid,
  completed_at timestamptz,
  completed_by uuid,
  completed_by_name text,
  is_current boolean not null default false,
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid not null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint order_work_steps_tenant_id_unique unique (tenant_id, id),
  -- Deferred: reordering swaps positions inside one statement sequence.
  constraint order_work_steps_position_unique
    unique (tenant_id, order_id, position) deferrable initially deferred,
  constraint order_work_steps_order_fk
    foreign key (tenant_id, order_id) references public.orders (tenant_id, id),
  constraint order_work_steps_stage_fk
    foreign key (tenant_id, stage_id) references public.work_stages (tenant_id, id),
  constraint order_work_steps_team_member_fk
    foreign key (tenant_id, team_member_id) references public.team_members (tenant_id, id),
  constraint order_work_steps_executed_by_fk
    foreign key (tenant_id, executed_by_team_member_id) references public.team_members (tenant_id, id),
  constraint order_work_steps_completed_by_membership_fk
    foreign key (tenant_id, completed_by) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_work_steps_created_by_membership_fk
    foreign key (tenant_id, created_by) references public.memberships (tenant_id, user_id) on delete restrict,
  constraint order_work_steps_position_check check (position between 1 and 10),
  -- D14/D5: a done step always has its person, its executor and the account
  -- that marked it; a pending step has none of the three marks.
  constraint order_work_steps_done_check check (
    (
      completed_at is null
      and executed_by_team_member_id is null
      and completed_by is null
      and completed_by_name is null
    )
    or (
      completed_at is not null
      and team_member_id is not null
      and executed_by_team_member_id is not null
      and completed_by is not null
      and completed_by_name is not null
    )
  ),
  constraint order_work_steps_current_check check (not is_current or completed_at is null)
);

create unique index order_work_steps_one_current
  on public.order_work_steps (tenant_id, order_id)
  where is_current;
create index order_work_steps_pending_member_idx
  on public.order_work_steps (tenant_id, team_member_id)
  where completed_at is null;
create index order_work_steps_stage_idx on public.order_work_steps (tenant_id, stage_id);
create index order_work_steps_executed_by_idx
  on public.order_work_steps (tenant_id, executed_by_team_member_id)
  where executed_by_team_member_id is not null;
create index order_work_steps_completed_by_idx
  on public.order_work_steps (tenant_id, completed_by)
  where completed_by is not null;
create index order_work_steps_created_by_idx on public.order_work_steps (tenant_id, created_by);

alter table public.work_stages enable row level security;
alter table public.order_work_steps enable row level security;

create policy work_stages_select_member
  on public.work_stages
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id) and public.tenant_has_feature(tenant_id, 'order_work_sequence'));

create policy order_work_steps_select_member
  on public.order_work_steps
  for select
  to authenticated
  using (public.is_tenant_member(tenant_id) and public.tenant_has_feature(tenant_id, 'order_work_sequence'));

revoke all on public.work_stages from public, anon, authenticated, service_role;
revoke all on public.order_work_steps from public, anon, authenticated, service_role;
grant select on public.work_stages to authenticated;
grant select on public.order_work_steps to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Row guards
-- ---------------------------------------------------------------------------
create or replace function public.tg_work_stages_guard_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  if tg_op = 'DELETE' then
    -- Only the tenant removal cascade deletes stages; otherwise they are deactivated.
    if not exists (select 1 from public.tenants t where t.id = old.tenant_id) then
      return old;
    end if;
    raise exception 'work_stages_deactivate_only'
      using errcode = '42501';
  end if;

  if coalesce(pg_catalog.current_setting('gestcopy.work_stages_write', true), '') <> '1' then
    raise exception 'work_stages_rpc_only'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE'
     and (new.id, new.tenant_id, new.created_at) is distinct from (old.id, old.tenant_id, old.created_at) then
    raise exception 'immutable_identity'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_work_stages_guard on public.work_stages;
create trigger trg_work_stages_guard
  before insert or update or delete on public.work_stages
  for each row
  execute function public.tg_work_stages_guard_v1();

drop trigger if exists work_stages_set_updated_at on public.work_stages;
create trigger work_stages_set_updated_at
  before update on public.work_stages
  for each row
  execute function public.set_updated_at();

create or replace function public.tg_order_work_steps_guard_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_archived timestamptz;
begin
  if tg_op = 'DELETE' then
    if coalesce(pg_catalog.current_setting('gestcopy.order_work_steps_purge', true), '') = '1' then
      return old;
    end if;
    if coalesce(pg_catalog.current_setting('gestcopy.order_work_steps_write', true), '') <> '1' then
      raise exception 'order_work_steps_rpc_only'
        using errcode = '42501';
    end if;
    if old.completed_at is not null then
      raise exception 'step_done'
        using errcode = '55000';
    end if;
  elsif coalesce(pg_catalog.current_setting('gestcopy.order_work_steps_write', true), '') <> '1' then
    raise exception 'order_work_steps_rpc_only'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if (new.id, new.tenant_id, new.order_id, new.created_at, new.created_by)
       is distinct from (old.id, old.tenant_id, old.order_id, old.created_at, old.created_by) then
      raise exception 'immutable_identity'
        using errcode = '55000';
    end if;

    -- A done step keeps its stage and person until it is undone.
    if old.completed_at is not null
       and new.completed_at is not null
       and (new.stage_id, new.team_member_id) is distinct from (old.stage_id, old.team_member_id) then
      raise exception 'step_done'
        using errcode = '55000';
    end if;
  end if;

  -- R6, only for new non-null values (D6 keeps done steps of people deactivated later).
  if tg_op in ('INSERT', 'UPDATE') then
    if new.team_member_id is not null
       and (tg_op = 'INSERT' or new.team_member_id is distinct from old.team_member_id)
       and not public.team_member_is_assignable(new.tenant_id, new.team_member_id) then
      raise exception 'member_unassignable'
        using errcode = '23514';
    end if;

    if new.executed_by_team_member_id is not null
       and (tg_op = 'INSERT' or new.executed_by_team_member_id is distinct from old.executed_by_team_member_id)
       and not public.team_member_is_assignable(new.tenant_id, new.executed_by_team_member_id) then
      raise exception 'member_unassignable'
        using errcode = '23514';
    end if;
  end if;

  select o.archived_at
    into v_archived
  from public.orders o
  where o.tenant_id = case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end
    and o.id = case when tg_op = 'DELETE' then old.order_id else new.order_id end;

  if not found then
    raise exception 'order_not_found'
      using errcode = 'P0002';
  end if;

  if v_archived is not null then
    raise exception 'order_archived'
      using errcode = '55000';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_order_work_steps_guard on public.order_work_steps;
create trigger trg_order_work_steps_guard
  before insert or update or delete on public.order_work_steps
  for each row
  execute function public.tg_order_work_steps_guard_v1();

create or replace function public.tg_order_work_refuse_truncate_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  raise exception 'order_work_sequence_truncate_refused'
    using errcode = '42501';
end;
$function$;

drop trigger if exists trg_order_work_steps_refuse_truncate on public.order_work_steps;
create trigger trg_order_work_steps_refuse_truncate
  before truncate on public.order_work_steps
  for each statement
  execute function public.tg_order_work_refuse_truncate_v1();

drop trigger if exists trg_work_stages_refuse_truncate on public.work_stages;
create trigger trg_work_stages_refuse_truncate
  before truncate on public.work_stages
  for each statement
  execute function public.tg_order_work_refuse_truncate_v1();

create or replace function public.tg_orders_purge_work_steps_v1()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  perform pg_catalog.set_config('gestcopy.order_work_steps_purge', '1', true);
  delete from public.order_work_steps
  where tenant_id = old.tenant_id
    and order_id = old.id;
  perform pg_catalog.set_config('gestcopy.order_work_steps_purge', '', true);
  return old;
end;
$function$;

drop trigger if exists trg_orders_purge_work_steps on public.orders;
create trigger trg_orders_purge_work_steps
  before delete on public.orders
  for each row
  execute function public.tg_orders_purge_work_steps_v1();

-- ---------------------------------------------------------------------------
-- 4. Internal helpers (no API role can execute them)
-- ---------------------------------------------------------------------------
create or replace function public.work_sequence_actor_name_v1(p_tenant_id uuid, p_user_id uuid)
  returns text
  language sql
  stable
  set search_path to ''
as $function$
  select pg_catalog.left(coalesce(
    (
      select nullif(pg_catalog.btrim(tm.name), '')
      from public.team_members tm
      where tm.tenant_id = p_tenant_id
        and tm.user_id = p_user_id
      order by tm.active desc, tm.created_at
      limit 1
    ),
    (
      select nullif(pg_catalog.btrim(p.full_name), '')
      from public.profiles p
      where p.id = p_user_id
    ),
    'Usuario'
  ), 200);
$function$;

create or replace function public.order_work_step_payload_error_v1(p_step jsonb)
  returns text
  language sql
  immutable
  set search_path to ''
as $function$
  select case
    when pg_catalog.jsonb_typeof(p_step) is distinct from 'object' then 'step'
    when exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_step) k
      where k not in ('id', 'stage_id', 'team_member_id')
    ) then 'step'
    when pg_catalog.jsonb_typeof(p_step -> 'stage_id') is distinct from 'string'
      or (p_step ->> 'stage_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then 'stage_id'
    when p_step ? 'team_member_id'
      and pg_catalog.jsonb_typeof(p_step -> 'team_member_id') <> 'null'
      and (
        pg_catalog.jsonb_typeof(p_step -> 'team_member_id') <> 'string'
        or (p_step ->> 'team_member_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) then 'team_member_id'
    when p_step ? 'id'
      and pg_catalog.jsonb_typeof(p_step -> 'id') <> 'null'
      and (
        pg_catalog.jsonb_typeof(p_step -> 'id') <> 'string'
        or (p_step ->> 'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      ) then 'id'
    else null
  end;
$function$;

-- The validated input as rows: position is the 1-based array index.
create or replace function public.order_work_steps_input_v1(p_steps jsonb)
  returns table (step_position integer, id uuid, stage_id uuid, team_member_id uuid)
  language sql
  immutable
  set search_path to ''
as $function$
  select
    x.n::integer,
    (x.j ->> 'id')::uuid,
    (x.j ->> 'stage_id')::uuid,
    (x.j ->> 'team_member_id')::uuid
  from pg_catalog.jsonb_array_elements(p_steps) with ordinality as x(j, n);
$function$;

create or replace function public.order_work_step_json_v1(p_step public.order_work_steps)
  returns jsonb
  language sql
  stable
  set search_path to ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_step.id,
    'position', p_step.position,
    'stage_id', p_step.stage_id,
    'team_member_id', p_step.team_member_id,
    'executed_by_team_member_id', p_step.executed_by_team_member_id,
    'completed_at', p_step.completed_at,
    'completed_by', p_step.completed_by,
    'completed_by_name', p_step.completed_by_name,
    'is_current', p_step.is_current
  );
$function$;

create or replace function public.order_work_steps_json_v1(p_tenant_id uuid, p_order_id uuid)
  returns jsonb
  language sql
  stable
  set search_path to ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(public.order_work_step_json_v1(s) order by s.position),
    '[]'::jsonb
  )
  from public.order_work_steps s
  where s.tenant_id = p_tenant_id
    and s.order_id = p_order_id;
$function$;

-- What the activity keeps of a sequence: positions, stages and names of that moment.
create or replace function public.order_work_steps_snapshot_v1(p_tenant_id uuid, p_order_id uuid)
  returns jsonb
  language sql
  stable
  set search_path to ''
as $function$
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'step_id', s.id,
        'position', s.position,
        'stage_id', s.stage_id,
        'stage_name', ws.name,
        'team_member_id', s.team_member_id,
        'team_member_name', tm.name,
        'done', s.completed_at is not null
      )
      order by s.position
    ),
    '[]'::jsonb
  )
  from public.order_work_steps s
  join public.work_stages ws
    on ws.tenant_id = s.tenant_id
   and ws.id = s.stage_id
  left join public.team_members tm
    on tm.tenant_id = s.tenant_id
   and tm.id = s.team_member_id
  where s.tenant_id = p_tenant_id
    and s.order_id = p_order_id;
$function$;

-- Le toca: the first step not done. Caller holds the order lock and the marker.
create or replace function public.order_work_steps_recompute_current_v1(p_tenant_id uuid, p_order_id uuid)
  returns void
  language plpgsql
  set search_path to ''
as $function$
declare
  v_first uuid;
begin
  select s.id
    into v_first
  from public.order_work_steps s
  where s.tenant_id = p_tenant_id
    and s.order_id = p_order_id
    and s.completed_at is null
  order by s.position
  limit 1;

  update public.order_work_steps s
  set is_current = false
  where s.tenant_id = p_tenant_id
    and s.order_id = p_order_id
    and s.is_current
    and s.id is distinct from v_first;

  if v_first is not null then
    update public.order_work_steps s
    set is_current = true
    where s.tenant_id = p_tenant_id
      and s.id = v_first
      and not s.is_current;
  end if;
end;
$function$;

create or replace function public.work_stage_json_v1(p_stage public.work_stages)
  returns jsonb
  language sql
  stable
  set search_path to ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_stage.id,
    'name', p_stage.name,
    'icon', p_stage.icon,
    'active', p_stage.active,
    'sort_order', p_stage.sort_order
  );
$function$;

-- ---------------------------------------------------------------------------
-- 5. replace_order_work_steps_v1: the whole sequence at once
-- ---------------------------------------------------------------------------
create or replace function public.replace_order_work_steps_v1(
  p_order_id uuid,
  p_expected_row_version text,
  p_steps jsonb
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_order public.orders%rowtype;
  v_count integer;
  v_bad_index integer;
  v_bad_field text;
  v_done_step uuid;
  v_before jsonb;
  v_after jsonb;
  v_version bigint;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or p_order_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found
     or not public.is_tenant_member(v_order.tenant_id)
     or not public.tenant_has_feature(v_order.tenant_id, 'order_work_sequence') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(v_order.tenant_id, array['owner', 'admin', 'manager', 'staff']::text[]) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_order.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
  end if;

  if p_expected_row_version is null
     or p_expected_row_version !~ '^[0-9]+$'
     or v_order.row_version::text is distinct from p_expected_row_version then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error', 'conflict',
      'row_version', v_order.row_version::text
    );
  end if;

  if p_steps is null or pg_catalog.jsonb_typeof(p_steps) is distinct from 'array' then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_steps');
  end if;

  v_count := pg_catalog.jsonb_array_length(p_steps);

  if v_count > 10 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'too_many_steps');
  end if;

  select x.n::integer, public.order_work_step_payload_error_v1(x.j)
    into v_bad_index, v_bad_field
  from pg_catalog.jsonb_array_elements(p_steps) with ordinality as x(j, n)
  where public.order_work_step_payload_error_v1(x.j) is not null
  order by x.n
  limit 1;

  if v_bad_field is not null then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'invalid_steps', 'index', v_bad_index - 1, 'field', v_bad_field
    );
  end if;

  -- An id appears once and belongs to this order.
  select i.step_position
    into v_bad_index
  from public.order_work_steps_input_v1(p_steps) i
  where i.id is not null
    and (
      (select pg_catalog.count(*) from public.order_work_steps_input_v1(p_steps) d where d.id = i.id) > 1
      or not exists (
        select 1
        from public.order_work_steps s
        where s.tenant_id = v_order.tenant_id
          and s.order_id = v_order.id
          and s.id = i.id
      )
    )
  order by i.step_position
  limit 1;

  if v_bad_index is not null then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'invalid_steps', 'index', v_bad_index - 1, 'field', 'id'
    );
  end if;

  -- Stages of this tenant; locked so nobody deactivates them meanwhile.
  perform 1
  from public.work_stages ws
  where ws.tenant_id = v_order.tenant_id
    and ws.id in (select i.stage_id from public.order_work_steps_input_v1(p_steps) i)
  order by ws.id
  for share;

  select i.step_position
    into v_bad_index
  from public.order_work_steps_input_v1(p_steps) i
  where not exists (
    select 1
    from public.work_stages ws
    where ws.tenant_id = v_order.tenant_id
      and ws.id = i.stage_id
  )
  order by i.step_position
  limit 1;

  if v_bad_index is not null then
    return pg_catalog.jsonb_build_object(
      'ok', false, 'error', 'invalid_steps', 'index', v_bad_index - 1, 'field', 'stage_id'
    );
  end if;

  -- A done step is neither removed nor changed: undo it first.
  select s.id
    into v_done_step
  from public.order_work_steps s
  where s.tenant_id = v_order.tenant_id
    and s.order_id = v_order.id
    and s.completed_at is not null
    and not exists (
      select 1 from public.order_work_steps_input_v1(p_steps) i where i.id = s.id
    )
  order by s.position
  limit 1;

  if v_done_step is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'step_done', 'step_id', v_done_step);
  end if;

  select i.step_position
    into v_bad_index
  from public.order_work_steps_input_v1(p_steps) i
  join public.order_work_steps s
    on s.tenant_id = v_order.tenant_id
   and s.id = i.id
  where s.completed_at is not null
    and (s.stage_id, s.team_member_id) is distinct from (i.stage_id, i.team_member_id)
  order by i.step_position
  limit 1;

  if v_bad_index is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'step_done', 'index', v_bad_index - 1);
  end if;

  -- A new stage on a step must be active.
  select i.step_position
    into v_bad_index
  from public.order_work_steps_input_v1(p_steps) i
  join public.work_stages ws
    on ws.tenant_id = v_order.tenant_id
   and ws.id = i.stage_id
  left join public.order_work_steps s
    on s.tenant_id = v_order.tenant_id
   and s.id = i.id
  where not ws.active
    and (s.id is null or s.stage_id is distinct from i.stage_id)
  order by i.step_position
  limit 1;

  if v_bad_index is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'stage_inactive', 'index', v_bad_index - 1);
  end if;

  -- A new person on a step must be assignable (R6). Locked FOR SHARE.
  perform 1
  from public.team_members tm
  where tm.tenant_id = v_order.tenant_id
    and tm.id in (
      select i.team_member_id
      from public.order_work_steps_input_v1(p_steps) i
      where i.team_member_id is not null
    )
  order by tm.id
  for share;

  select i.step_position
    into v_bad_index
  from public.order_work_steps_input_v1(p_steps) i
  left join public.order_work_steps s
    on s.tenant_id = v_order.tenant_id
   and s.id = i.id
  where i.team_member_id is not null
    and (s.id is null or s.team_member_id is distinct from i.team_member_id)
    and not public.team_member_is_assignable(v_order.tenant_id, i.team_member_id)
  order by i.step_position
  limit 1;

  if v_bad_index is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'member_unassignable', 'index', v_bad_index - 1);
  end if;

  -- Same steps, same order, same stages and people: nothing to write.
  if (
    select pg_catalog.count(*)
    from public.order_work_steps s
    where s.tenant_id = v_order.tenant_id
      and s.order_id = v_order.id
  ) = v_count
  and not exists (
    select 1
    from public.order_work_steps_input_v1(p_steps) i
    left join public.order_work_steps s
      on s.tenant_id = v_order.tenant_id
     and s.order_id = v_order.id
     and s.id = i.id
    where s.id is null
       or (s.position, s.stage_id, s.team_member_id) is distinct from (i.step_position, i.stage_id, i.team_member_id)
  ) then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'changed', false,
      'row_version', v_order.row_version::text,
      'steps', public.order_work_steps_json_v1(v_order.tenant_id, v_order.id)
    );
  end if;

  v_before := public.order_work_steps_snapshot_v1(v_order.tenant_id, v_order.id);

  perform pg_catalog.set_config('gestcopy.order_work_steps_write', '1', true);

  delete from public.order_work_steps s
  where s.tenant_id = v_order.tenant_id
    and s.order_id = v_order.id
    and not exists (
      select 1 from public.order_work_steps_input_v1(p_steps) i where i.id = s.id
    );

  update public.order_work_steps s
  set is_current = false
  where s.tenant_id = v_order.tenant_id
    and s.order_id = v_order.id
    and s.is_current;

  update public.order_work_steps s
  set position = i.step_position,
      stage_id = i.stage_id,
      team_member_id = i.team_member_id,
      updated_at = v_now
  from public.order_work_steps_input_v1(p_steps) i
  where s.tenant_id = v_order.tenant_id
    and s.order_id = v_order.id
    and s.id = i.id
    and (s.position, s.stage_id, s.team_member_id) is distinct from (i.step_position, i.stage_id, i.team_member_id);

  insert into public.order_work_steps (
    tenant_id, order_id, position, stage_id, team_member_id, created_at, created_by, updated_at
  )
  select v_order.tenant_id, v_order.id, i.step_position, i.stage_id, i.team_member_id, v_now, v_actor, v_now
  from public.order_work_steps_input_v1(p_steps) i
  where i.id is null
  order by i.step_position;

  perform public.order_work_steps_recompute_current_v1(v_order.tenant_id, v_order.id);

  perform pg_catalog.set_config('gestcopy.order_work_steps_write', '', true);

  -- D15: one version bump per change of the sequence.
  update public.orders
  set updated_at = v_now
  where id = v_order.id
    and tenant_id = v_order.tenant_id
  returning row_version into v_version;

  if not found then
    raise exception 'could not update order version';
  end if;

  v_after := public.order_work_steps_snapshot_v1(v_order.tenant_id, v_order.id);

  insert into public.activity_log (
    tenant_id, user_id, action, entity_type, entity_id,
    previous_values, new_values, metadata
  ) values (
    v_order.tenant_id,
    v_actor,
    'order.work_steps_changed',
    'order',
    v_order.id,
    pg_catalog.jsonb_build_object('steps', v_before),
    pg_catalog.jsonb_build_object('steps', v_after),
    pg_catalog.jsonb_build_object('reference', v_order.reference, 'field', 'work_steps')
  );

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'changed', true,
    'row_version', v_version::text,
    'steps', public.order_work_steps_json_v1(v_order.tenant_id, v_order.id)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. set_order_work_step_done_v1: mark or undo one step (idempotent, D5)
-- ---------------------------------------------------------------------------
create or replace function public.set_order_work_step_done_v1(
  p_step_id uuid,
  p_done boolean,
  p_executed_by uuid default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_actor uuid := auth.uid();
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_step public.order_work_steps%rowtype;
  v_updated public.order_work_steps%rowtype;
  v_executor uuid;
  v_stage_name text;
  v_assigned_name text;
  v_executor_name text;
  v_actor_name text;
  v_version bigint;
  v_now timestamptz := pg_catalog.now();
begin
  if v_actor is null or p_step_id is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select s.order_id
    into v_order_id
  from public.order_work_steps s
  where s.id = p_step_id;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select *
    into v_order
  from public.orders
  where id = v_order_id
  for update;

  if not found
     or not public.is_tenant_member(v_order.tenant_id)
     or not public.tenant_has_feature(v_order.tenant_id, 'order_work_sequence') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(v_order.tenant_id, array['owner', 'admin', 'manager', 'staff']::text[]) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if v_order.archived_at is not null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'order_archived');
  end if;

  if p_done is null then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_action');
  end if;

  -- Re-read under the order lock: a replace may have removed it meanwhile.
  select *
    into v_step
  from public.order_work_steps s
  where s.tenant_id = v_order.tenant_id
    and s.order_id = v_order.id
    and s.id = p_step_id
  for update;

  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- Idempotent: the first mark (or undo) wins, the second writes nothing.
  if (p_done and v_step.completed_at is not null) or (not p_done and v_step.completed_at is null) then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'changed', false,
      'row_version', v_order.row_version::text,
      'step', public.order_work_step_json_v1(v_step)
    );
  end if;

  select ws.name
    into v_stage_name
  from public.work_stages ws
  where ws.tenant_id = v_step.tenant_id
    and ws.id = v_step.stage_id;

  select tm.name
    into v_assigned_name
  from public.team_members tm
  where tm.tenant_id = v_step.tenant_id
    and tm.id = v_step.team_member_id;

  if p_done then
    if v_step.team_member_id is null then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'step_unassigned');
    end if;

    v_executor := coalesce(p_executed_by, v_step.team_member_id);

    perform 1
    from public.team_members tm
    where tm.tenant_id = v_step.tenant_id
      and tm.id in (v_step.team_member_id, v_executor)
    order by tm.id
    for share;

    if not public.team_member_is_assignable(v_step.tenant_id, v_step.team_member_id)
       or not public.team_member_is_assignable(v_step.tenant_id, v_executor) then
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'member_unassignable');
    end if;

    select tm.name
      into v_executor_name
    from public.team_members tm
    where tm.tenant_id = v_step.tenant_id
      and tm.id = v_executor;

    v_actor_name := public.work_sequence_actor_name_v1(v_step.tenant_id, v_actor);

    perform pg_catalog.set_config('gestcopy.order_work_steps_write', '1', true);

    update public.order_work_steps s
    set completed_at = v_now,
        completed_by = v_actor,
        completed_by_name = v_actor_name,
        executed_by_team_member_id = v_executor,
        is_current = false,
        updated_at = v_now
    where s.tenant_id = v_step.tenant_id
      and s.id = v_step.id;
  else
    perform pg_catalog.set_config('gestcopy.order_work_steps_write', '1', true);

    update public.order_work_steps s
    set completed_at = null,
        completed_by = null,
        completed_by_name = null,
        executed_by_team_member_id = null,
        updated_at = v_now
    where s.tenant_id = v_step.tenant_id
      and s.id = v_step.id;

    select tm.name
      into v_executor_name
    from public.team_members tm
    where tm.tenant_id = v_step.tenant_id
      and tm.id = v_step.executed_by_team_member_id;
  end if;

  perform public.order_work_steps_recompute_current_v1(v_order.tenant_id, v_order.id);

  perform pg_catalog.set_config('gestcopy.order_work_steps_write', '', true);

  update public.orders
  set updated_at = v_now
  where id = v_order.id
    and tenant_id = v_order.tenant_id
  returning row_version into v_version;

  if not found then
    raise exception 'could not update order version';
  end if;

  select *
    into v_updated
  from public.order_work_steps s
  where s.tenant_id = v_step.tenant_id
    and s.id = v_step.id;

  if p_done then
    insert into public.activity_log (
      tenant_id, user_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    ) values (
      v_order.tenant_id,
      v_actor,
      'order.work_step_completed',
      'order',
      v_order.id,
      pg_catalog.jsonb_build_object(
        'step_id', v_step.id,
        'position', v_step.position,
        'stage_name', v_stage_name,
        'done', false
      ),
      pg_catalog.jsonb_build_object(
        'step_id', v_step.id,
        'position', v_step.position,
        'stage_id', v_step.stage_id,
        'stage_name', v_stage_name,
        'team_member_id', v_step.team_member_id,
        'team_member_name', v_assigned_name,
        'executed_by_team_member_id', v_executor,
        'executed_by_name', v_executor_name,
        'completed_by', v_actor,
        'completed_by_name', v_actor_name,
        'done', true
      ),
      pg_catalog.jsonb_build_object('reference', v_order.reference, 'field', 'work_steps')
    );
  else
    insert into public.activity_log (
      tenant_id, user_id, action, entity_type, entity_id,
      previous_values, new_values, metadata
    ) values (
      v_order.tenant_id,
      v_actor,
      'order.work_step_reopened',
      'order',
      v_order.id,
      pg_catalog.jsonb_build_object(
        'step_id', v_step.id,
        'position', v_step.position,
        'stage_name', v_stage_name,
        'team_member_id', v_step.team_member_id,
        'team_member_name', v_assigned_name,
        'executed_by_team_member_id', v_step.executed_by_team_member_id,
        'executed_by_name', v_executor_name,
        'completed_by', v_step.completed_by,
        'completed_by_name', v_step.completed_by_name,
        'completed_at', v_step.completed_at,
        'done', true
      ),
      pg_catalog.jsonb_build_object(
        'step_id', v_step.id,
        'position', v_step.position,
        'stage_name', v_stage_name,
        'done', false
      ),
      pg_catalog.jsonb_build_object('reference', v_order.reference, 'field', 'work_steps')
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'changed', true,
    'row_version', v_version::text,
    'step', public.order_work_step_json_v1(v_updated)
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. team_work_load_v1: per active person, distinct operational orders
-- ---------------------------------------------------------------------------
-- responsible: operational orders whose responsible person they are (as today).
-- current:     operational orders whose current step is theirs (Le toca ahora).
-- upcoming:    operational orders with a later pending step of theirs and no
--              current one (Más adelante).
-- Every figure is count(distinct order); columns are never added together and
-- no amount is read.
create or replace function public.team_work_load_v1(p_tenant_id uuid)
  returns jsonb
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_members jsonb;
  v_unassigned integer;
  v_blocked integer;
  v_total integer;
begin
  if auth.uid() is null
     or p_tenant_id is null
     or not public.is_tenant_member(p_tenant_id)
     or not public.tenant_has_feature(p_tenant_id, 'order_work_sequence') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  with operational as (
    select o.id, o.assigned_team_member_id
    from public.orders o
    join public.order_statuses st
      on st.tenant_id = o.tenant_id
     and st.id = o.status_id
    where o.tenant_id = p_tenant_id
      and o.archived_at is null
      and st.is_closed is not true
      and st.is_cancelled is not true
  ),
  pending as (
    select s.order_id, s.team_member_id, s.is_current
    from public.order_work_steps s
    join operational op on op.id = s.order_id
    where s.tenant_id = p_tenant_id
      and s.completed_at is null
  )
  select
    coalesce(
      (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'team_member_id', tm.id,
            'name', tm.name,
            'responsible', (
              select pg_catalog.count(distinct op.id) from operational op where op.assigned_team_member_id = tm.id
            ),
            'current', (
              select pg_catalog.count(distinct p.order_id) from pending p where p.team_member_id = tm.id and p.is_current
            ),
            'upcoming', (
              select pg_catalog.count(distinct p.order_id)
              from pending p
              where p.team_member_id = tm.id
                and not p.is_current
                and not exists (
                  select 1 from pending c
                  where c.order_id = p.order_id
                    and c.team_member_id = tm.id
                    and c.is_current
                )
            )
          )
          order by tm.name, tm.id
        )
        from public.team_members tm
        where tm.tenant_id = p_tenant_id
          and tm.active
      ),
      '[]'::jsonb
    ),
    (select pg_catalog.count(distinct p.order_id) from pending p where p.is_current and p.team_member_id is null),
    (
      select pg_catalog.count(distinct p.order_id)
      from pending p
      where p.is_current
        and p.team_member_id is not null
        and not public.team_member_is_assignable(p_tenant_id, p.team_member_id)
    ),
    (select pg_catalog.count(*) from operational)
    into v_members, v_unassigned, v_blocked, v_total;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'members', v_members,
    'current_unassigned', v_unassigned,
    'current_unavailable', v_blocked,
    'operational_total', v_total
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Stages: upsert_work_stage_v1 and create_suggested_work_stages_v1
-- ---------------------------------------------------------------------------
create or replace function public.upsert_work_stage_v1(
  p_tenant_id uuid,
  p_stage_id uuid,
  p_name text,
  p_icon text,
  p_active boolean default null,
  p_sort_order integer default null
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_name text := pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_stage public.work_stages%rowtype;
  v_updated public.work_stages%rowtype;
  v_count integer;
  v_sort integer;
begin
  if auth.uid() is null
     or p_tenant_id is null
     or not public.is_tenant_member(p_tenant_id)
     or not public.tenant_has_feature(p_tenant_id, 'order_work_sequence') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(p_tenant_id, array['owner', 'admin', 'manager']::text[]) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  if pg_catalog.char_length(v_name) not between 1 and 40 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_name');
  end if;

  if p_icon is null
     or p_icon not in ('design', 'prepare', 'print', 'finish', 'cut', 'bind', 'review', 'deliver', 'other') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_icon');
  end if;

  if p_sort_order is not null and p_sort_order not between 0 and 1000 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'invalid_sort_order');
  end if;

  -- One catalog writer per tenant: names and the 30-stage limit stay exact.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gestcopy.work_stages:' || p_tenant_id::text, 0)
  );

  if exists (
    select 1
    from public.work_stages ws
    where ws.tenant_id = p_tenant_id
      and pg_catalog.lower(ws.name) = pg_catalog.lower(v_name)
      and ws.id is distinct from p_stage_id
  ) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'duplicate_name');
  end if;

  perform pg_catalog.set_config('gestcopy.work_stages_write', '1', true);

  if p_stage_id is null then
    select pg_catalog.count(*), coalesce(pg_catalog.max(ws.sort_order) + 1, 0)
      into v_count, v_sort
    from public.work_stages ws
    where ws.tenant_id = p_tenant_id;

    if v_count >= 30 then
      perform pg_catalog.set_config('gestcopy.work_stages_write', '', true);
      return pg_catalog.jsonb_build_object('ok', false, 'error', 'too_many_stages');
    end if;

    insert into public.work_stages (tenant_id, name, icon, active, sort_order)
    values (p_tenant_id, v_name, p_icon, coalesce(p_active, true), coalesce(p_sort_order, least(v_sort, 1000)))
    returning * into v_updated;

    perform pg_catalog.set_config('gestcopy.work_stages_write', '', true);

    return pg_catalog.jsonb_build_object('ok', true, 'changed', true, 'stage', public.work_stage_json_v1(v_updated));
  end if;

  select *
    into v_stage
  from public.work_stages ws
  where ws.tenant_id = p_tenant_id
    and ws.id = p_stage_id
  for update;

  if not found then
    perform pg_catalog.set_config('gestcopy.work_stages_write', '', true);
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if (v_stage.name, v_stage.icon, v_stage.active, v_stage.sort_order)
     is not distinct from (v_name, p_icon, coalesce(p_active, v_stage.active), coalesce(p_sort_order, v_stage.sort_order)) then
    perform pg_catalog.set_config('gestcopy.work_stages_write', '', true);
    return pg_catalog.jsonb_build_object('ok', true, 'changed', false, 'stage', public.work_stage_json_v1(v_stage));
  end if;

  update public.work_stages ws
  set name = v_name,
      icon = p_icon,
      active = coalesce(p_active, v_stage.active),
      sort_order = coalesce(p_sort_order, v_stage.sort_order)
  where ws.tenant_id = p_tenant_id
    and ws.id = p_stage_id
  returning * into v_updated;

  perform pg_catalog.set_config('gestcopy.work_stages_write', '', true);

  return pg_catalog.jsonb_build_object('ok', true, 'changed', true, 'stage', public.work_stage_json_v1(v_updated));
end;
$function$;

-- «Crear fases sugeridas»: Diseño, Preparación, Impresión and Acabado, skipping
-- the names the tenant already has. Repeating it creates nothing.
create or replace function public.create_suggested_work_stages_v1(p_tenant_id uuid)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_count integer;
  v_missing integer;
  v_base integer;
  v_created integer;
begin
  if auth.uid() is null
     or p_tenant_id is null
     or not public.is_tenant_member(p_tenant_id)
     or not public.tenant_has_feature(p_tenant_id, 'order_work_sequence') then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if not public.has_tenant_role(p_tenant_id, array['owner', 'admin', 'manager']::text[]) then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('gestcopy.work_stages:' || p_tenant_id::text, 0)
  );

  select pg_catalog.count(*), coalesce(pg_catalog.max(ws.sort_order) + 1, 0)
    into v_count, v_base
  from public.work_stages ws
  where ws.tenant_id = p_tenant_id;

  select pg_catalog.count(*)
    into v_missing
  from (values ('Diseño'), ('Preparación'), ('Impresión'), ('Acabado')) as s(name)
  where not exists (
    select 1
    from public.work_stages ws
    where ws.tenant_id = p_tenant_id
      and pg_catalog.lower(ws.name) = pg_catalog.lower(s.name)
  );

  if v_missing = 0 then
    return pg_catalog.jsonb_build_object('ok', true, 'changed', false, 'created', 0);
  end if;

  if v_count + v_missing > 30 then
    return pg_catalog.jsonb_build_object('ok', false, 'error', 'too_many_stages');
  end if;

  perform pg_catalog.set_config('gestcopy.work_stages_write', '1', true);

  insert into public.work_stages (tenant_id, name, icon, active, sort_order)
  select p_tenant_id, s.name, s.icon, true, least(v_base + s.n - 1, 1000)
  from (
    values (1, 'Diseño', 'design'), (2, 'Preparación', 'prepare'), (3, 'Impresión', 'print'), (4, 'Acabado', 'finish')
  ) as s(n, name, icon)
  where not exists (
    select 1
    from public.work_stages ws
    where ws.tenant_id = p_tenant_id
      and pg_catalog.lower(ws.name) = pg_catalog.lower(s.name)
  )
  order by s.n;

  get diagnostics v_created = row_count;

  perform pg_catalog.set_config('gestcopy.work_stages_write', '', true);

  return pg_catalog.jsonb_build_object('ok', true, 'changed', v_created > 0, 'created', v_created);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 9. Privileges
-- ---------------------------------------------------------------------------
revoke all on function public.tg_work_stages_guard_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_order_work_steps_guard_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_order_work_refuse_truncate_v1() from public, anon, authenticated, service_role;
revoke all on function public.tg_orders_purge_work_steps_v1() from public, anon, authenticated, service_role;
revoke all on function public.work_sequence_actor_name_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.order_work_step_payload_error_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.order_work_steps_input_v1(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.order_work_step_json_v1(public.order_work_steps) from public, anon, authenticated, service_role;
revoke all on function public.order_work_steps_json_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.order_work_steps_snapshot_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.order_work_steps_recompute_current_v1(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.work_stage_json_v1(public.work_stages) from public, anon, authenticated, service_role;

revoke all on function public.replace_order_work_steps_v1(uuid, text, jsonb) from public, anon, service_role;
revoke all on function public.set_order_work_step_done_v1(uuid, boolean, uuid) from public, anon, service_role;
revoke all on function public.team_work_load_v1(uuid) from public, anon, service_role;
revoke all on function public.upsert_work_stage_v1(uuid, uuid, text, text, boolean, integer) from public, anon, service_role;
revoke all on function public.create_suggested_work_stages_v1(uuid) from public, anon, service_role;

grant execute on function public.replace_order_work_steps_v1(uuid, text, jsonb) to authenticated;
grant execute on function public.set_order_work_step_done_v1(uuid, boolean, uuid) to authenticated;
grant execute on function public.team_work_load_v1(uuid) to authenticated;
grant execute on function public.upsert_work_stage_v1(uuid, uuid, text, text, boolean, integer) to authenticated;
grant execute on function public.create_suggested_work_stages_v1(uuid) to authenticated;

commit;
