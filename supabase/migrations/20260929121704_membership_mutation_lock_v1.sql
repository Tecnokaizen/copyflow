-- Serializa las mutaciones de memberships de un tenant antes de los
-- FOR UPDATE. transfer_tenant_ownership, update_tenant_membership_role
-- y set_tenant_membership_active usan exactamente esta clave:
--   hashtextextended('gestcopy.membership.tenant:' || tenant_id::text, 0)
-- Así no se invierte el orden de locks de fila entre esas RPC.
-- Owner es tenant-scoped. No hay lock global por usuario ni índice
-- de un owner activo por usuario.

CREATE OR REPLACE FUNCTION public.transfer_tenant_ownership(
  p_tenant_id uuid,
  p_target_user_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor public.memberships%rowtype;
  v_target public.memberships%rowtype;
  v_target_updated integer;
  v_actor_updated integer;
begin
  if v_actor_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null or p_target_user_id is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if p_target_user_id = v_actor_id then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  -- Misma clave que update_tenant_membership_role y
  -- set_tenant_membership_active. Se toma antes de cualquier FOR UPDATE.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'gestcopy.membership.tenant:' || p_tenant_id::text,
      0
    )
  );

  select m.*
  into v_actor
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = v_actor_id
  for update;

  if v_actor.id is null
     or v_actor.active is distinct from true
     or v_actor.role is distinct from 'owner' then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select m.*
  into v_target
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = p_target_user_id
  for update;

  if v_target.id is null
     or v_target.active is distinct from true
     or v_target.role = 'owner' then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  update public.memberships
  set
    role = 'owner',
    updated_at = pg_catalog.now()
  where id = v_target.id
    and tenant_id = p_tenant_id
    and user_id = p_target_user_id
    and active = true
    and role is distinct from 'owner';

  get diagnostics v_target_updated = row_count;

  update public.memberships
  set
    role = 'admin',
    updated_at = pg_catalog.now()
  where id = v_actor.id
    and tenant_id = p_tenant_id
    and user_id = v_actor_id
    and active = true
    and role = 'owner';

  get diagnostics v_actor_updated = row_count;

  if v_target_updated <> 1 or v_actor_updated <> 1 then
    raise exception 'ownership transfer failed'
      using errcode = '40001';
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
    p_tenant_id,
    v_actor_id,
    null,
    'membership.ownership_transferred',
    'membership',
    p_target_user_id,
    jsonb_build_object(
      'user_id', v_actor_id,
      'role', 'owner'
    ),
    jsonb_build_object(
      'user_id', p_target_user_id,
      'role', 'owner'
    ),
    jsonb_build_object(
      'previous_owner_user_id', v_actor_id,
      'new_owner_user_id', p_target_user_id,
      'previous_owner_role', 'owner',
      'previous_owner_role_after', 'admin',
      'target_previous_role', v_target.role
    )
  );

  return jsonb_build_object(
    'ok', true,
    'previous_owner', jsonb_build_object(
      'user_id', v_actor_id,
      'role', 'admin',
      'active', true
    ),
    'new_owner', jsonb_build_object(
      'user_id', p_target_user_id,
      'role', 'owner',
      'active', true
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_tenant_membership_role(
  p_tenant_id uuid,
  p_user_id uuid,
  p_role text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target public.memberships%rowtype;
  v_role text;
  v_from_role text;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_tenant_id is null or p_user_id is null then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  v_role := nullif(btrim(coalesce(p_role, '')), '');
  if v_role is null or not public.is_invitable_membership_role(v_role) then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'gestcopy.membership.tenant:' || p_tenant_id::text,
      0
    )
  );

  select m.role
  into v_actor_role
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = v_actor_id
    and m.active = true
  for update;

  if v_actor_role is null then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  perform 1
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.role = 'owner'
    and m.active = true
  for update;

  select m.*
  into v_target
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = p_user_id
  for update;

  if v_target.id is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  if v_target.role = 'owner' then
    if v_actor_role is distinct from 'owner' then
      raise exception 'tenant access denied' using errcode = '42501';
    end if;
    if not public.actor_can_manage_owner_target(
      p_tenant_id,
      v_actor_role,
      p_user_id
    ) then
      raise exception 'last owner required' using errcode = 'GTO01';
    end if;
  elsif not public.actor_can_manage_membership_target(v_actor_role, v_target.role) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  if not public.actor_can_assign_membership_role(v_actor_role, v_role) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  v_from_role := v_target.role;

  update public.memberships
  set
    role = v_role,
    updated_at = pg_catalog.now()
  where id = v_target.id
  returning * into v_target;

  if v_from_role is distinct from v_target.role then
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
      p_tenant_id,
      v_actor_id,
      null,
      'membership.role_changed',
      'membership',
      p_user_id,
      jsonb_build_object('role', v_from_role),
      jsonb_build_object('role', v_target.role),
      jsonb_build_object(
        'from_role', v_from_role,
        'to_role', v_target.role
      )
    );
  end if;

  return jsonb_build_object(
    'membership', jsonb_build_object(
      'user_id', v_target.user_id,
      'tenant_id', v_target.tenant_id,
      'role', v_target.role,
      'active', v_target.active,
      'updated_at', v_target.updated_at
    )
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_tenant_membership_active(
  p_tenant_id uuid,
  p_user_id uuid,
  p_active boolean
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target public.memberships%rowtype;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_tenant_id is null or p_user_id is null or p_active is null then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'gestcopy.membership.tenant:' || p_tenant_id::text,
      0
    )
  );

  select m.role
  into v_actor_role
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = v_actor_id
    and m.active = true
  for update;

  if v_actor_role is null then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  perform 1
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.role = 'owner'
    and m.active = true
  for update;

  select m.*
  into v_target
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = p_user_id
  for update;

  if v_target.id is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  if v_target.role = 'owner' then
    if v_actor_role is distinct from 'owner' then
      raise exception 'tenant access denied' using errcode = '42501';
    end if;
    if not public.actor_can_manage_owner_target(
      p_tenant_id,
      v_actor_role,
      p_user_id
    ) then
      raise exception 'last owner required' using errcode = 'GTO01';
    end if;
  elsif not public.actor_can_manage_membership_target(v_actor_role, v_target.role) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  update public.memberships
  set
    active = p_active,
    updated_at = pg_catalog.now()
  where id = v_target.id
  returning * into v_target;

  return jsonb_build_object(
    'membership', jsonb_build_object(
      'user_id', v_target.user_id,
      'tenant_id', v_target.tenant_id,
      'role', v_target.role,
      'active', v_target.active,
      'updated_at', v_target.updated_at
    )
  );
end;
$function$;
