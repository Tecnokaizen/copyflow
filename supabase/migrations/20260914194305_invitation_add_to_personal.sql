-- Invitation: persist optional name + add_to_personal.
-- On accept, optionally create a linked team_member. Never match existing
-- Personal cards by email. Pending invitations created before this stay
-- access-only (add_to_personal default false).
-- Do not apply remotely until review.

ALTER TABLE public.tenant_invitations
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS add_to_personal boolean NOT NULL DEFAULT false;

ALTER TABLE public.tenant_invitations
  DROP CONSTRAINT IF EXISTS tenant_invitations_name_check;

ALTER TABLE public.tenant_invitations
  ADD CONSTRAINT tenant_invitations_name_check
  CHECK (name IS NULL OR (btrim(name) <> '' AND char_length(name) <= 120));

COMMENT ON COLUMN public.tenant_invitations.name IS
  'Nombre introducido al invitar. Nullable. Se usa al crear la ficha de Personal.';

COMMENT ON COLUMN public.tenant_invitations.add_to_personal IS
  'Si true, al aceptar se crea team_member vinculado. No concede permisos.';

DROP FUNCTION IF EXISTS public.create_tenant_invitation(uuid, text, text);

CREATE OR REPLACE FUNCTION public.create_tenant_invitation(
  p_tenant_id uuid,
  p_email text,
  p_role text,
  p_name text DEFAULT NULL,
  p_add_to_personal boolean DEFAULT false
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_email text;
  v_role text;
  v_name text;
  v_token text;
  v_token_hash bytea;
  v_expires_at timestamptz;
  v_invitation public.tenant_invitations%rowtype;
  v_existing public.tenant_invitations%rowtype;
  v_tenant public.tenants%rowtype;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_tenant_id is null then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  v_role := nullif(btrim(coalesce(p_role, '')), '');
  if v_role is null or not public.is_invitable_membership_role(v_role) then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  v_email := public.normalize_invitation_email(p_email);
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is not null and char_length(v_name) > 120 then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_tenant_id::text || ':' || v_email, 0)
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

  if not public.actor_can_assign_membership_role(v_actor_role, v_role) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  select t.*
  into v_tenant
  from public.tenants t
  where t.id = p_tenant_id
    and t.active = true;

  if v_tenant.id is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from auth.users u
    join public.memberships m
      on m.user_id = u.id
    where m.tenant_id = p_tenant_id
      and m.active = true
      and public.normalize_invitation_email(u.email) = v_email
  ) then
    raise exception 'already a member' using errcode = '23505';
  end if;

  select i.*
  into v_existing
  from public.tenant_invitations i
  where i.tenant_id = p_tenant_id
    and i.email_normalized = v_email
    and i.status = 'pending'
  for update;

  if v_existing.id is not null then
    if not public.actor_can_manage_membership_target(v_actor_role, v_existing.role) then
      raise exception 'tenant access denied' using errcode = '42501';
    end if;

    update public.tenant_invitations
    set
      status = 'superseded',
      updated_at = now()
    where id = v_existing.id;
  end if;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := public.hash_invitation_token(v_token);
  v_expires_at := now() + interval '7 days';

  insert into public.tenant_invitations (
    tenant_id,
    email,
    email_normalized,
    role,
    name,
    add_to_personal,
    token_hash,
    status,
    invited_by_user_id,
    expires_at,
    last_sent_at,
    send_attempts
  )
  values (
    p_tenant_id,
    v_email,
    v_email,
    v_role,
    v_name,
    coalesce(p_add_to_personal, false),
    v_token_hash,
    'pending',
    v_actor_id,
    v_expires_at,
    now(),
    1
  )
  returning * into v_invitation;

  return pg_catalog.jsonb_build_object(
    'invitation_id', v_invitation.id,
    'tenant_id', v_tenant.id,
    'tenant_name', v_tenant.name,
    'tenant_slug', v_tenant.slug,
    'email', v_invitation.email_normalized,
    'role', v_invitation.role,
    'name', v_invitation.name,
    'add_to_personal', v_invitation.add_to_personal,
    'expires_at', v_invitation.expires_at,
    'send_attempts', v_invitation.send_attempts,
    'token', v_token
  );
end;
$function$;

COMMENT ON FUNCTION public.create_tenant_invitation(uuid, text, text, text, boolean) IS
  'DEFINER acotado: crea/supersede invitación pending. Actor=auth.uid(). Nunca owner. name y add_to_personal opcionales. Token en claro solo una vez.';

REVOKE ALL ON FUNCTION public.create_tenant_invitation(uuid, text, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tenant_invitation(uuid, text, text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_invitation(uuid, text, text, text, boolean)
  TO authenticated, postgres;

CREATE OR REPLACE FUNCTION public.list_tenant_access(
  p_tenant_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_memberships jsonb;
  v_invitations jsonb;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_tenant_id is null then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  select m.role
  into v_actor_role
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = v_actor_id
    and m.active = true;

  if v_actor_role is null
     or v_actor_role not in ('owner', 'admin') then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'user_id', m.user_id,
        'full_name', p.full_name,
        'email', u.email,
        'role', m.role,
        'active', m.active,
        'created_at', m.created_at
      )
      order by m.created_at asc
    ),
    '[]'::jsonb
  )
  into v_memberships
  from public.memberships m
  join public.profiles p on p.id = m.user_id
  join auth.users u on u.id = m.user_id
  where m.tenant_id = p_tenant_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'invitation_id', i.id,
        'email', i.email_normalized,
        'role', i.role,
        'name', i.name,
        'add_to_personal', i.add_to_personal,
        'status', i.status,
        'expires_at', i.expires_at,
        'invited_by_user_id', i.invited_by_user_id,
        'created_at', i.created_at,
        'last_sent_at', i.last_sent_at,
        'send_attempts', i.send_attempts
      )
      order by i.created_at desc
    ),
    '[]'::jsonb
  )
  into v_invitations
  from public.tenant_invitations i
  where i.tenant_id = p_tenant_id
    and i.status = 'pending';

  return jsonb_build_object(
    'memberships', v_memberships,
    'invitations', v_invitations
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.accept_tenant_invitation(
  p_token text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_email text;
  v_full_name text;
  v_token text;
  v_token_hash bytea;
  v_invitation public.tenant_invitations%rowtype;
  v_tenant public.tenants%rowtype;
  v_membership public.memberships%rowtype;
  v_member_name text;
  v_team_member_id uuid;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  v_token := nullif(btrim(coalesce(p_token, '')), '');
  if v_token is null or length(v_token) <> 64 then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  v_token_hash := public.hash_invitation_token(v_token);

  select i.*
  into v_invitation
  from public.tenant_invitations i
  where i.token_hash = v_token_hash
  for update;

  if v_invitation.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  if v_invitation.status = 'accepted' then
    raise exception 'invitation already accepted' using errcode = '23505';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'invitation not pending' using errcode = '22023';
  end if;

  if v_invitation.expires_at <= now() then
    raise exception 'invitation expired' using errcode = '22023';
  end if;

  select
    public.normalize_invitation_email(u.email),
    nullif(
      btrim(
        coalesce(
          u.raw_user_meta_data ->> 'full_name',
          u.raw_user_meta_data ->> 'name',
          split_part(coalesce(u.email, ''), '@', 1)
        )
      ),
      ''
    )
  into v_actor_email, v_full_name
  from auth.users u
  where u.id = v_actor_id;

  if v_actor_email is null
     or v_actor_email is distinct from v_invitation.email_normalized then
    raise exception 'invitation email mismatch' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_invitation.tenant_id::text || ':' || v_invitation.email_normalized,
      0
    )
  );

  select t.*
  into v_tenant
  from public.tenants t
  where t.id = v_invitation.tenant_id
    and t.active = true;

  if v_tenant.id is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;

  insert into public.profiles (id, full_name)
  values (
    v_actor_id,
    coalesce(
      nullif(btrim(coalesce(v_invitation.name, '')), ''),
      v_full_name
    )
  )
  on conflict (id) do nothing;

  select m.*
  into v_membership
  from public.memberships m
  where m.tenant_id = v_invitation.tenant_id
    and m.user_id = v_actor_id
  for update;

  if v_membership.id is not null and v_membership.active = true then
    raise exception 'already a member' using errcode = '23505';
  end if;

  if v_membership.id is not null then
    update public.memberships
    set
      role = v_invitation.role,
      active = true,
      updated_at = now()
    where id = v_membership.id
    returning * into v_membership;
  else
    insert into public.memberships (
      tenant_id,
      user_id,
      role,
      active
    )
    values (
      v_invitation.tenant_id,
      v_actor_id,
      v_invitation.role,
      true
    )
    returning * into v_membership;
  end if;

  if v_invitation.add_to_personal then
    select tm.id
    into v_team_member_id
    from public.team_members tm
    where tm.tenant_id = v_invitation.tenant_id
      and tm.user_id = v_actor_id;

    if v_team_member_id is null then
      v_member_name := nullif(btrim(coalesce(v_invitation.name, '')), '');
      if v_member_name is null then
        v_member_name := v_full_name;
      end if;
      if v_member_name is null then
        v_member_name := split_part(v_invitation.email_normalized, '@', 1);
      end if;

      begin
        insert into public.team_members (
          tenant_id,
          user_id,
          name,
          email,
          active,
          can_receive_orders
        )
        values (
          v_invitation.tenant_id,
          v_actor_id,
          v_member_name,
          v_invitation.email_normalized,
          true,
          true
        )
        returning id into v_team_member_id;
      exception
        when unique_violation then
          select tm.id
          into v_team_member_id
          from public.team_members tm
          where tm.tenant_id = v_invitation.tenant_id
            and tm.user_id = v_actor_id;
      end;
    end if;
  end if;

  update public.tenant_invitations
  set
    status = 'accepted',
    accepted_by_user_id = v_actor_id,
    accepted_at = now(),
    updated_at = now()
  where id = v_invitation.id;

  return jsonb_build_object(
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'name', v_tenant.name,
      'slug', v_tenant.slug
    ),
    'membership', jsonb_build_object(
      'role', v_membership.role,
      'active', v_membership.active
    ),
    'team_member_id', v_team_member_id
  );
end;
$function$;

COMMENT ON FUNCTION public.accept_tenant_invitation(text) IS
  'DEFINER acotado: acepta invitación por token. Garantiza profile. Crea/reactiva membership. Si add_to_personal, crea team_member vinculado sin matching por email. Atomico.';
