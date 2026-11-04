-- Rollback of 20261104130000_order_work_sequence_auto_finish_v1.sql
--
-- Restores the previous bodies of public.tg_activity_log_order_status() and
-- public.set_order_work_step_done_v1(uuid, boolean, uuid), verbatim from
-- 20260907171432_remote_schema.sql and 20261028130000_order_work_sequence_v1.sql.
-- After it, finishing the last step no longer changes the order status.
-- Orders already moved to their ready status and the activity rows written
-- (metadata.automatic / metadata.auto_finish) are kept: data is not reverted.
-- Grants are kept by CREATE OR REPLACE; the trigger comment is restored.
-- Then: supabase migration repair --status reverted 20261104130000
begin;

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
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.status_id is not distinct from new.status_id then
    return new;
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
    pg_catalog.jsonb_build_object(
      'reference', new.reference
    )
  );

  return new;
end;
$function$;

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

comment on function public.tg_activity_log_order_status() is
  'DEFINER acotado: INSERT en activity_log al cambiar orders.status_id. tenant_id = NEW.tenant_id. user_id = auth.uid().';

commit;
