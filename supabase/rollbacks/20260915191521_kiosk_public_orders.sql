\set ON_ERROR_STOP on

begin;

drop function if exists public.submit_kiosk_order(
  text, text, bigint, text, text, text, uuid, uuid, text, uuid,
  text, text, text, text, timestamptz, text
);
drop function if exists public.admit_kiosk_request(
  text, text, bigint, text, text, text
);
drop function if exists public.kiosk_bootstrap(
  text, text, bigint, text, text, text
);

drop schema if exists kiosk_private cascade;

-- Exact pre-Kiosk trigger function from 20260907171432_remote_schema.sql.
create or replace function public.tg_activity_log_order_created()
  returns trigger
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  if v_actor is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if not public.has_tenant_role(
    new.tenant_id,
    array['owner', 'admin', 'manager', 'staff']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
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
  )
  values (
    new.tenant_id,
    v_actor,
    null,
    'order.created',
    'order',
    new.id,
    null,
    pg_catalog.jsonb_build_object(
      'title', new.title,
      'status_id', new.status_id,
      'priority', new.priority,
      'client_id', new.client_id,
      'service_id', new.service_id,
      'assigned_team_member_id', new.assigned_team_member_id,
      'entry_channel_id', new.entry_channel_id,
      'order_context_id', new.order_context_id,
      'due_at', new.due_at
    ),
    pg_catalog.jsonb_build_object(
      'reference', new.reference
    )
  );

  return new;
end;
$function$;

revoke all on function public.tg_activity_log_order_created() from public;
revoke all on function public.tg_activity_log_order_created()
  from anon, authenticated, service_role;
grant execute on function public.tg_activity_log_order_created() to postgres;

commit;
