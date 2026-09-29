-- Transferencia atómica de la propiedad de un tenant.
-- Owner es tenant-scoped: el mismo usuario puede ser owner activo de varios tenants.
-- No modifica update_tenant_membership_role ni create_organization.
-- No impone un índice global de un owner activo por usuario.

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

  -- Ausente, inactivo o de otro tenant: la misma denegación, sin revelar
  -- si el usuario existe fuera de esta organización.
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

COMMENT ON FUNCTION public.transfer_tenant_ownership(uuid, uuid) IS
  'DEFINER. El owner activo transfiere la propiedad a otro miembro activo del mismo tenant y pasa a admin. Actor=auth.uid(). No promociona vía update_tenant_membership_role.';

REVOKE ALL ON FUNCTION public.transfer_tenant_ownership(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transfer_tenant_ownership(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.transfer_tenant_ownership(uuid, uuid)
  TO authenticated, postgres;
