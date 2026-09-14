-- Equipo, usuarios, roles y perfil operativo coherentes.
-- No toca realtime ni el refresco de pedidos.
-- El owner inicial sigue sin ser team_member (create_organization no cambia).

CREATE OR REPLACE FUNCTION public.actor_can_manage_owner_target(
  p_tenant_id uuid,
  p_actor_role text,
  p_target_user_id uuid
)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare
  v_other_owners integer;
begin
  if p_actor_role is distinct from 'owner' then
    return false;
  end if;

  select count(*)::integer
  into v_other_owners
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.role = 'owner'
    and m.active = true
    and m.user_id is distinct from p_target_user_id;

  return coalesce(v_other_owners, 0) >= 1;
end;
$function$;

REVOKE ALL ON FUNCTION public.actor_can_manage_owner_target(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.actor_can_manage_owner_target(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.actor_can_manage_owner_target(uuid, text, uuid) FROM authenticated;

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

CREATE OR REPLACE FUNCTION public.list_tenant_user_directory(
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_users jsonb;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_tenant_id is null then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner', 'admin', 'manager']::text[]
  ) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', m.user_id,
        'full_name', p.full_name,
        'email', u.email,
        'role', m.role,
        'active', m.active
      )
      order by p.full_name asc nulls last, u.email asc
    ),
    '[]'::jsonb
  )
  into v_users
  from public.memberships m
  join auth.users u on u.id = m.user_id
  left join public.profiles p on p.id = m.user_id
  where m.tenant_id = p_tenant_id;

  return jsonb_build_object('users', v_users);
end;
$function$;

COMMENT ON FUNCTION public.list_tenant_user_directory(uuid) IS
  'DEFINER acotado: directorio de usuarios Gestcopy del tenant para owner/admin/manager. Incluye email de auth.users. No crea asociaciones.';

REVOKE ALL ON FUNCTION public.list_tenant_user_directory(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_tenant_user_directory(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_user_directory(uuid)
  TO authenticated, postgres;

COMMENT ON FUNCTION public.create_organization(text, text, text) IS
  'DEFINER acotado: crea tenant + membership owner + tenant_settings + seed mínimo (incluye tienda Principal). El owner inicial NO es team_member: un onboarding futuro puede preguntar si también forma parte del equipo. Actor = auth.uid(). No aceptar user_id ni tenant_id del cliente. MVP: como máximo una membership owner activa por usuario.';

-- ---------------------------------------------------------------------------
-- update_team_member: una sola transacción (perfil operativo + user_id)
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.update_team_member(uuid, text, text, text, boolean, boolean, uuid);

CREATE OR REPLACE FUNCTION public.update_team_member (
  p_team_member_id     uuid,
  p_name               text,
  p_job_title          text,
  p_department         text,
  p_active             boolean,
  p_can_receive_orders boolean,
  p_tenant_id          uuid,
  p_email              text,
  p_phone              text,
  p_user_id            uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  v_user_id uuid := auth.uid();
  v_member public.team_members%rowtype;
  v_name text;
  v_job_title text;
  v_department text;
  v_email text;
  v_phone text;
  v_membership_active boolean;
  v_existing_member_id uuid;
begin
  if v_user_id is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  if p_tenant_id is null or p_team_member_id is null then
    raise exception 'invalid value'
      using errcode = '22023';
  end if;

  if not public.has_tenant_role(
    p_tenant_id,
    array['owner','admin','manager']::text[]
  ) then
    raise exception 'tenant access denied'
      using errcode = '42501';
  end if;

  select *
  into v_member
  from public.team_members tm
  where tm.id = p_team_member_id
    and tm.tenant_id = p_tenant_id
  for update;

  if not found then
    raise exception 'team member not found'
      using errcode = 'P0002';
  end if;

  v_name := nullif(pg_catalog.btrim(p_name), '');
  if v_name is null then
    raise exception 'team member name cannot be empty'
      using errcode = '22023';
  end if;

  v_job_title := nullif(pg_catalog.btrim(p_job_title), '');
  v_department := nullif(pg_catalog.btrim(p_department), '');
  v_email := nullif(pg_catalog.btrim(p_email), '');
  v_phone := nullif(pg_catalog.btrim(p_phone), '');

  if p_user_id is not null then
    select m.active
    into v_membership_active
    from public.memberships m
    where m.tenant_id = p_tenant_id
      and m.user_id = p_user_id;

    if not found then
      raise exception 'membership_missing'
        using errcode = '22023';
    end if;

    if v_membership_active is not true then
      raise exception 'membership_inactive'
        using errcode = '22023';
    end if;

    v_existing_member_id := null;
    select tm.id
    into v_existing_member_id
    from public.team_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id = p_user_id
      and tm.id is distinct from p_team_member_id
    for update;

    if v_existing_member_id is not null then
      raise exception 'already_linked'
        using errcode = '23505';
    end if;
  end if;

  update public.team_members
  set
    name = v_name,
    job_title = v_job_title,
    department = v_department,
    email = v_email,
    phone = v_phone,
    active = coalesce(p_active, true),
    can_receive_orders = coalesce(p_can_receive_orders, true),
    user_id = p_user_id,
    updated_at = pg_catalog.now()
  where id = p_team_member_id
    and tenant_id = p_tenant_id
  returning *
  into v_member;

  return pg_catalog.jsonb_build_object(
    'member',
    pg_catalog.jsonb_build_object(
      'id', v_member.id,
      'name', v_member.name,
      'email', v_member.email,
      'phone', v_member.phone,
      'job_title', v_member.job_title,
      'department', v_member.department,
      'active', v_member.active,
      'can_receive_orders', v_member.can_receive_orders,
      'user_id', v_member.user_id,
      'notes', v_member.notes,
      'created_at', v_member.created_at,
      'updated_at', v_member.updated_at
    )
  );
end;
$function$;

COMMENT ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, boolean, uuid, text, text, uuid) IS
  'INVOKER: actualiza el perfil operativo y la asociación user_id en una sola transacción. Actor = auth.uid(). Valida membership del mismo tenant, activa, y UNIQUE. No hace matching por email/nombre.';

REVOKE ALL ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, boolean, uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, boolean, uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_team_member(uuid, text, text, text, boolean, boolean, uuid, text, text, uuid)
  TO authenticated, postgres;
