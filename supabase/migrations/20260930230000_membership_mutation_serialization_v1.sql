-- Serializa las mutaciones estructurales de memberships de un tenant.
-- transfer_tenant_ownership, update_tenant_membership_role y
-- set_tenant_membership_active toman la misma clave antes de cualquier
-- FOR UPDATE:
--   hashtextextended('gestcopy.membership.tenant:' || tenant_id::text, 0)
-- Tenants distintos no comparten el lock. La semántica de cada RPC no cambia.

begin;

create or replace function public.transfer_tenant_ownership(
  p_tenant_id uuid,
  p_new_owner_user_id uuid
)
  returns jsonb
  language plpgsql
  security definer
  set search_path to ''
  as $function$
declare
  v_actor_id uuid := auth.uid();
  v_previous_owner public.memberships%rowtype;
  v_new_owner public.memberships%rowtype;
  v_new_owner_previous_role text;
  v_previous_owner_name text;
  v_previous_owner_email text;
  v_new_owner_name text;
  v_new_owner_email text;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_tenant_id is null or p_new_owner_user_id is null then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  if p_new_owner_user_id = v_actor_id then
    raise exception 'new owner must be another member' using errcode = '22023';
  end if;

  -- Same key as update_tenant_membership_role and set_tenant_membership_active.
  -- Taken before any membership row lock so those mutations cannot deadlock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'gestcopy.membership.tenant:' || p_tenant_id::text,
      0
    )
  );

  -- Keep the last-owner invariant coordinated with the existing membership
  -- RPCs, which also lock every active owner before demoting or revoking one.
  perform 1
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.role = 'owner'
    and m.active = true
  order by m.user_id
  for update;

  -- Lock the destination as well. Its active state and tenant membership must
  -- not change between validation and promotion.
  perform 1
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = p_new_owner_user_id
  for update;

  select m.*
  into v_previous_owner
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = v_actor_id;

  if v_previous_owner.id is null
     or v_previous_owner.active is distinct from true
     or v_previous_owner.role is distinct from 'owner' then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  select m.*
  into v_new_owner
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = p_new_owner_user_id;

  if v_new_owner.id is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  if v_new_owner.active is distinct from true then
    raise exception 'new owner must be active tenant member'
      using errcode = 'GTO02';
  end if;

  v_new_owner_previous_role := v_new_owner.role;

  -- One statement changes both memberships. PostgreSQL exposes either the
  -- complete committed transfer or none of it to concurrent transactions.
  update public.memberships m
  set
    role = case
      when m.user_id = p_new_owner_user_id then 'owner'
      else 'admin'
    end,
    updated_at = now()
  where m.tenant_id = p_tenant_id
    and m.user_id in (v_actor_id, p_new_owner_user_id);

  select m.*
  into v_previous_owner
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = v_actor_id;

  select m.*
  into v_new_owner
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = p_new_owner_user_id;

  if not exists (
    select 1
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.role = 'owner'
      and m.active = true
  ) then
    raise exception 'last owner required' using errcode = 'GTO01';
  end if;

  select p.full_name, u.email
  into v_previous_owner_name, v_previous_owner_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = v_actor_id;

  select p.full_name, u.email
  into v_new_owner_name, v_new_owner_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_new_owner_user_id;

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
    v_actor_id,
    pg_catalog.jsonb_build_object(
      'role', 'owner'
    ),
    pg_catalog.jsonb_build_object(
      'role', 'admin'
    ),
    pg_catalog.jsonb_build_object(
      'operation', 'ownership_transfer',
      'from_role', 'owner',
      'to_role', 'admin',
      'previous_owner_user_id', v_actor_id,
      'previous_owner_name', v_previous_owner_name,
      'previous_owner_email', v_previous_owner_email,
      'new_owner_user_id', p_new_owner_user_id,
      'new_owner_name', v_new_owner_name,
      'new_owner_email', v_new_owner_email,
      'full_name', v_previous_owner_name,
      'email', v_previous_owner_email
    )
  ), (
    p_tenant_id,
    v_actor_id,
    null,
    'membership.role_changed',
    'membership',
    p_new_owner_user_id,
    pg_catalog.jsonb_build_object(
      'role', v_new_owner_previous_role
    ),
    pg_catalog.jsonb_build_object(
      'role', 'owner'
    ),
    pg_catalog.jsonb_build_object(
      'operation', 'ownership_transfer',
      'from_role', v_new_owner_previous_role,
      'to_role', 'owner',
      'previous_owner_user_id', v_actor_id,
      'previous_owner_name', v_previous_owner_name,
      'previous_owner_email', v_previous_owner_email,
      'new_owner_user_id', p_new_owner_user_id,
      'new_owner_name', v_new_owner_name,
      'new_owner_email', v_new_owner_email,
      'full_name', v_new_owner_name,
      'email', v_new_owner_email
    )
  );

  return pg_catalog.jsonb_build_object(
    'tenant_id', p_tenant_id,
    'previous_owner', pg_catalog.jsonb_build_object(
      'user_id', v_previous_owner.user_id,
      'role', v_previous_owner.role,
      'active', v_previous_owner.active,
      'updated_at', v_previous_owner.updated_at
    ),
    'new_owner', pg_catalog.jsonb_build_object(
      'user_id', v_new_owner.user_id,
      'role', v_new_owner.role,
      'active', v_new_owner.active,
      'updated_at', v_new_owner.updated_at
    )
  );
end;
$function$;

comment on function public.transfer_tenant_ownership(uuid, uuid) is
  'DEFINER acotado: owner autenticado transfiere atómicamente a otra membership activa del mismo tenant; nuevo owner y owner anterior admin. Registra activity_log.';

revoke all on function public.transfer_tenant_ownership(uuid, uuid) from public;
revoke all on function public.transfer_tenant_ownership(uuid, uuid) from anon, service_role;
grant execute on function public.transfer_tenant_ownership(uuid, uuid)
  to authenticated, postgres;

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
    updated_at = now()
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

COMMENT ON FUNCTION public.update_tenant_membership_role(uuid, uuid, text) IS
  'DEFINER acotado: cambia membership.role sin tocar team_members. Permite demotar un owner si queda al menos otro owner activo. Nunca promociona a owner.';

REVOKE ALL ON FUNCTION public.update_tenant_membership_role(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_tenant_membership_role(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_membership_role(uuid, uuid, text)
  TO authenticated, postgres;

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
    updated_at = now()
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

COMMENT ON FUNCTION public.set_tenant_membership_active(uuid, uuid, boolean) IS
  'DEFINER acotado: activa/desactiva membership. Nunca DELETE. El último owner activo no se puede revocar.';

REVOKE ALL ON FUNCTION public.set_tenant_membership_active(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_tenant_membership_active(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_tenant_membership_active(uuid, uuid, boolean)
  TO authenticated, postgres;

commit;
