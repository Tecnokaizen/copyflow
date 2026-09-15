-- Invitation accept: public preview by token + specific email-mismatch code.
-- Does not change email confirmation globally.
-- Does not rewrite Personal-card rules from 20260914194305.

CREATE OR REPLACE FUNCTION public.preview_tenant_invitation(p_token text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_token text;
  v_token_hash bytea;
  v_invitation public.tenant_invitations%rowtype;
  v_tenant public.tenants%rowtype;
  v_status text;
  v_account_id uuid;
  v_email_confirmed boolean := false;
begin
  v_token := nullif(btrim(coalesce(p_token, '')), '');
  if v_token is null or length(v_token) <> 64 then
    return jsonb_build_object('status', 'not_found');
  end if;

  v_token_hash := public.hash_invitation_token(v_token);

  select i.*
  into v_invitation
  from public.tenant_invitations i
  where i.token_hash = v_token_hash;

  if v_invitation.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  v_status := v_invitation.status;
  if v_status = 'pending' and v_invitation.expires_at <= now() then
    v_status := 'expired';
  end if;

  if v_status <> 'pending' then
    return jsonb_build_object('status', v_status);
  end if;

  select t.*
  into v_tenant
  from public.tenants t
  where t.id = v_invitation.tenant_id
    and t.active = true;

  if v_tenant.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  select
    u.id,
    u.email_confirmed_at is not null
  into v_account_id, v_email_confirmed
  from auth.users u
  where public.normalize_invitation_email(u.email) = v_invitation.email_normalized
  limit 1;

  return jsonb_build_object(
    'status', 'pending',
    'email', v_invitation.email_normalized,
    'name', v_invitation.name,
    'role', v_invitation.role,
    'add_to_personal', v_invitation.add_to_personal,
    'tenant', jsonb_build_object(
      'id', v_tenant.id,
      'name', v_tenant.name,
      'slug', v_tenant.slug
    ),
    'account_exists', v_account_id is not null,
    'email_confirmed', coalesce(v_email_confirmed, false)
  );
end;
$function$;

COMMENT ON FUNCTION public.preview_tenant_invitation(text) IS
  'DEFINER acotado: preview de invitación por token. Anon+authenticated. No expone token_hash ni auth_user_id. Email y tenant solo si pending y no expirada.';

REVOKE ALL ON FUNCTION public.preview_tenant_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_tenant_invitation(text)
  TO anon, authenticated, service_role, postgres;

CREATE OR REPLACE FUNCTION public.resolve_invitation_auth_user(p_token text)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_token text;
  v_token_hash bytea;
  v_invitation public.tenant_invitations%rowtype;
  v_account_id uuid;
begin
  v_token := nullif(btrim(coalesce(p_token, '')), '');
  if v_token is null or length(v_token) <> 64 then
    return null;
  end if;

  v_token_hash := public.hash_invitation_token(v_token);

  select i.*
  into v_invitation
  from public.tenant_invitations i
  where i.token_hash = v_token_hash;

  if v_invitation.id is null then
    return null;
  end if;

  if v_invitation.status <> 'pending' or v_invitation.expires_at <= now() then
    return null;
  end if;

  if not exists (
    select 1
    from public.tenants t
    where t.id = v_invitation.tenant_id
      and t.active = true
  ) then
    return null;
  end if;

  select u.id
  into v_account_id
  from auth.users u
  where public.normalize_invitation_email(u.email) = v_invitation.email_normalized
  limit 1;

  return v_account_id;
end;
$function$;

COMMENT ON FUNCTION public.resolve_invitation_auth_user(text) IS
  'DEFINER interno: resuelve auth.users.id de una invitación pending vigente. Solo service_role/postgres. No exponer a anon/authenticated.';

REVOKE ALL ON FUNCTION public.resolve_invitation_auth_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_invitation_auth_user(text) FROM anon;
REVOKE ALL ON FUNCTION public.resolve_invitation_auth_user(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_invitation_auth_user(text)
  TO service_role, postgres;

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
    raise exception 'invitation email mismatch' using errcode = 'GTI01';
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
  'DEFINER acotado: acepta invitación por token. Email mismatch = GTI01. Si add_to_personal, crea team_member vinculado sin matching por email. Atomico.';
