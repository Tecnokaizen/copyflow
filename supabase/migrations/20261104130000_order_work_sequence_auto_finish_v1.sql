-- Addendum 02 · Automatic finish of orders with a work sequence.
--
-- When the LAST pending step of an order's work sequence is marked done
-- (set_order_work_step_done_v1, p_done = true), the same transaction moves the
-- order to the tenant's production-final status: the single ACTIVE status with
-- is_ready = true («Listo», «Terminado»… resolved by flag, never by name).
--
-- Rules (owner decisions D-A..D-D, 04/11/2026)
--   * Only when the sequence becomes complete by MARKING a step. Removing
--     pending steps with replace_order_work_steps_v1 never finishes (D-C).
--   * Never touched: orders already in an is_ready, is_closed («Entregado») or
--     is_cancelled status; archived orders are already refused by the RPC.
--   * The tenant must have exactly one active is_ready status (D-A). With none
--     or several, the status is kept and the step activity says why.
--   * Undoing a step later keeps the status (D-B): no automatic reversal. The
--     RPC answers warning = order_stays_ready so the UI can tell the user.
--   * Only status_id and ready_at (set once, like change_order_status_v2)
--     change. delivered_at, payments, customer_notification_*, quotes and files
--     are not touched; nothing is sent to the customer.
--   * One transition and ONE row_version bump: the status rides on the UPDATE
--     that already bumps the version (D15 of SUR4 E7).
--
-- Concurrency: the RPC locks the order FOR UPDATE before reading anything, so
-- two people completing the last two steps are serialised; the second one sees
-- the order already is_ready and does not transition again. The target status
-- rows are locked FOR SHARE so they cannot be deactivated meanwhile.
--
-- Guards: the RPC is SECURITY DEFINER owned by postgres (tg_orders_write_guard
-- and tg_orders_lifecycle_guard let postgres through). It still sets
-- app.order_lifecycle = 'validated' around the UPDATE for clarity and never
-- mentions app.order_write (release gate invariant 7c).
--
-- Activity: the existing trigger keeps writing ONE order.status_changed row.
-- It now reads the transaction-local marker gestcopy.order_status_auto (only
-- when it names the same order) and adds to metadata:
--   automatic = true, trigger = work_sequence_completed, step_id, stage_name.
-- order.work_step_completed gains metadata.auto_finish {result, reason, status}.
--
-- Not touched: tables, RLS policies, grants, other RPCs, data.
-- Rollback: supabase/rollbacks/20261104130000_order_work_sequence_auto_finish_v1.sql
begin;

do $precondition$
begin
  if pg_catalog.to_regprocedure('public.set_order_work_step_done_v1(uuid,boolean,uuid)') is null then
    raise exception 'Addendum 02 requires SUR4 E7 (20261028130000_order_work_sequence_v1)';
  end if;
  if pg_catalog.to_regprocedure('public.tg_activity_log_order_status()') is null then
    raise exception 'Addendum 02 requires public.tg_activity_log_order_status()';
  end if;
end
$precondition$;

-- ---------------------------------------------------------------------------
-- 1. Status audit trigger: mark automatic transitions
-- Body verbatim from 20260907171432_remote_schema.sql; only the marker lines are new.
-- ---------------------------------------------------------------------------
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
  -- Addendum 02: transaction-local marker set by set_order_work_step_done_v1.
  v_auto_raw text := nullif(pg_catalog.current_setting('gestcopy.order_status_auto', true), '');
  v_auto jsonb;
  v_metadata jsonb;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.status_id is not distinct from new.status_id then
    return new;
  end if;

  -- The marker only counts for the order it names; anything else is ignored.
  if v_auto_raw is not null then
    begin
      v_auto := v_auto_raw::jsonb;
    exception when others then
      v_auto := null;
    end;
    if v_auto is not null
       and (pg_catalog.jsonb_typeof(v_auto) is distinct from 'object'
            or (v_auto ->> 'order_id') is distinct from new.id::text) then
      v_auto := null;
    end if;
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

  v_metadata := pg_catalog.jsonb_build_object('reference', new.reference);
  if v_auto is not null then
    v_metadata := v_metadata || pg_catalog.jsonb_build_object(
      'automatic', true,
      'trigger', 'work_sequence_completed',
      'step_id', v_auto -> 'step_id',
      'stage_name', v_auto -> 'stage_name'
    );
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
    v_metadata
  );

  return new;
end;
$function$;

comment on function public.tg_activity_log_order_status() is
  'DEFINER acotado: INSERT en activity_log al cambiar orders.status_id. tenant_id = NEW.tenant_id. user_id = auth.uid(). Con gestcopy.order_status_auto del mismo pedido añade metadata.automatic (Addendum 02).';

-- ---------------------------------------------------------------------------
-- 2. set_order_work_step_done_v1: automatic finish on the last step
-- Body verbatim from 20261028130000_order_work_sequence_v1.sql; the auto-finish
-- lines and the extra answer fields are new.
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
  -- Addendum 02: automatic finish.
  v_current_status public.order_statuses%rowtype;
  v_ready_ids uuid[];
  v_target public.order_statuses%rowtype;
  v_auto boolean := false;
  v_auto_finish jsonb;
  v_warning text;
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

  -- Addendum 02. The order is locked FOR UPDATE since the start, so its status
  -- is current and a concurrent completion waits here until we commit.
  select *
    into v_current_status
  from public.order_statuses st
  where st.tenant_id = v_order.tenant_id
    and st.id = v_order.status_id;

  if p_done
     and not exists (
       select 1
       from public.order_work_steps s
       where s.tenant_id = v_order.tenant_id
         and s.order_id = v_order.id
         and s.completed_at is null
     ) then
    if v_current_status.is_ready is true then
      v_auto_finish := pg_catalog.jsonb_build_object('result', 'skipped', 'reason', 'already_ready');
    elsif v_current_status.is_closed is true then
      v_auto_finish := pg_catalog.jsonb_build_object('result', 'skipped', 'reason', 'order_closed');
    elsif v_current_status.is_cancelled is true then
      v_auto_finish := pg_catalog.jsonb_build_object('result', 'skipped', 'reason', 'order_cancelled');
    else
      -- D-A: the single active is_ready status of the tenant, by flag.
      select coalesce(pg_catalog.array_agg(r.id order by r.id), '{}'::uuid[])
        into v_ready_ids
      from (
        select st.id
        from public.order_statuses st
        where st.tenant_id = v_order.tenant_id
          and st.active
          and st.is_ready
        order by st.id
        for share
      ) r;

      if pg_catalog.cardinality(v_ready_ids) = 1 then
        select *
          into v_target
        from public.order_statuses st
        where st.tenant_id = v_order.tenant_id
          and st.id = v_ready_ids[1];
        v_auto := true;
        v_auto_finish := pg_catalog.jsonb_build_object(
          'result', 'finished',
          'status_id', v_target.id,
          'status_code', v_target.code,
          'status_name', v_target.name
        );
      else
        v_auto_finish := pg_catalog.jsonb_build_object(
          'result', 'skipped',
          'reason', case
            when pg_catalog.cardinality(v_ready_ids) = 0 then 'ready_status_missing'
            else 'ready_status_ambiguous'
          end
        );
      end if;
    end if;
  elsif not p_done and v_current_status.is_ready is true then
    -- D-B: undoing a step never reverts the status; tell the caller.
    v_warning := 'order_stays_ready';
  end if;

  if v_auto then
    -- One UPDATE: status, ready_at (once) and the single version bump (D15).
    perform pg_catalog.set_config('app.order_lifecycle', 'validated', true);
    perform pg_catalog.set_config(
      'gestcopy.order_status_auto',
      pg_catalog.jsonb_build_object(
        'order_id', v_order.id,
        'step_id', v_step.id,
        'stage_name', v_stage_name
      )::text,
      true
    );

    update public.orders
    set updated_at = v_now,
        status_id = v_target.id,
        ready_at = coalesce(ready_at, v_now)
    where id = v_order.id
      and tenant_id = v_order.tenant_id
    returning row_version into v_version;

    if not found then
      raise exception 'could not update order version';
    end if;

    perform pg_catalog.set_config('gestcopy.order_status_auto', '', true);
    perform pg_catalog.set_config('app.order_lifecycle', '', true);
  else
    update public.orders
    set updated_at = v_now
    where id = v_order.id
      and tenant_id = v_order.tenant_id
    returning row_version into v_version;

    if not found then
      raise exception 'could not update order version';
    end if;
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
        || case
          when v_auto_finish is not null then pg_catalog.jsonb_build_object('auto_finish', v_auto_finish)
          else '{}'::jsonb
        end
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
        || case
          when v_warning is not null then pg_catalog.jsonb_build_object('order_stays_ready', true)
          else '{}'::jsonb
        end
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'changed', true,
    'row_version', v_version::text,
    'step', public.order_work_step_json_v1(v_updated)
  )
  || case
    when v_auto then pg_catalog.jsonb_build_object(
      'order_status', pg_catalog.jsonb_build_object(
        'id', v_target.id,
        'code', v_target.code,
        'name', v_target.name,
        'automatic', true
      )
    )
    else '{}'::jsonb
  end
  || case
    when v_warning is not null then pg_catalog.jsonb_build_object(
      'warning', v_warning,
      'order_status', pg_catalog.jsonb_build_object(
        'id', v_current_status.id,
        'code', v_current_status.code,
        'name', v_current_status.name,
        'automatic', false
      )
    )
    else '{}'::jsonb
  end;
end;
$function$;

comment on function public.set_order_work_step_done_v1(uuid, boolean, uuid) is
  'SUR4 E7 + Addendum 02. Marks/undoes one step (idempotent). Marking the last pending step moves the order to the single active is_ready status of the tenant in the same UPDATE that bumps row_version (never closed/cancelled/ready orders); undoing never reverts the status.';

commit;
