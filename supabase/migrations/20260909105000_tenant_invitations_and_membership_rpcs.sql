-- Phase 2A: tenant invitations + membership management RPCs.
-- Mutations go exclusively through SECURITY DEFINER RPCs.
-- No service_role. No owner creation/promotion. No team_members changes.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE public.tenant_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  email_normalized text NOT NULL,
  role text NOT NULL,
  token_hash bytea NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  invited_by_user_id uuid NOT NULL,
  accepted_by_user_id uuid NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_by_user_id uuid NULL,
  last_sent_at timestamptz NULL,
  send_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_invitations_role_check
    CHECK (role = ANY (ARRAY['admin'::text, 'manager'::text, 'staff'::text, 'viewer'::text])),
  CONSTRAINT tenant_invitations_status_check
    CHECK (status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'superseded'::text])),
  CONSTRAINT tenant_invitations_email_normalized_check
    CHECK (email_normalized = lower(btrim(email_normalized)) AND email_normalized <> ''),
  CONSTRAINT tenant_invitations_token_hash_len_check
    CHECK (octet_length(token_hash) = 32),
  CONSTRAINT tenant_invitations_send_attempts_check
    CHECK (send_attempts >= 0),
  CONSTRAINT tenant_invitations_accepted_fields_check
    CHECK (
      (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by_user_id IS NOT NULL)
      OR (status <> 'accepted' AND accepted_at IS NULL AND accepted_by_user_id IS NULL)
    ),
  CONSTRAINT tenant_invitations_revoked_fields_check
    CHECK (
      (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by_user_id IS NOT NULL)
      OR (status <> 'revoked' AND revoked_at IS NULL AND revoked_by_user_id IS NULL)
    )
);

ALTER TABLE public.tenant_invitations
  ADD CONSTRAINT tenant_invitations_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

ALTER TABLE public.tenant_invitations
  ADD CONSTRAINT tenant_invitations_invited_by_membership_fk
  FOREIGN KEY (tenant_id, invited_by_user_id)
  REFERENCES public.memberships (tenant_id, user_id)
  ON DELETE RESTRICT;

ALTER TABLE public.tenant_invitations
  ADD CONSTRAINT tenant_invitations_accepted_by_membership_fk
  FOREIGN KEY (tenant_id, accepted_by_user_id)
  REFERENCES public.memberships (tenant_id, user_id)
  ON DELETE RESTRICT;

ALTER TABLE public.tenant_invitations
  ADD CONSTRAINT tenant_invitations_revoked_by_membership_fk
  FOREIGN KEY (tenant_id, revoked_by_user_id)
  REFERENCES public.memberships (tenant_id, user_id)
  ON DELETE RESTRICT;

CREATE INDEX tenant_invitations_tenant_id_idx
  ON public.tenant_invitations USING btree (tenant_id);

CREATE INDEX tenant_invitations_email_normalized_idx
  ON public.tenant_invitations USING btree (email_normalized);

CREATE INDEX tenant_invitations_expires_at_idx
  ON public.tenant_invitations USING btree (expires_at);

CREATE INDEX tenant_invitations_status_idx
  ON public.tenant_invitations USING btree (status);

CREATE UNIQUE INDEX tenant_invitations_one_pending_per_email_idx
  ON public.tenant_invitations (tenant_id, email_normalized)
  WHERE (status = 'pending');

CREATE UNIQUE INDEX tenant_invitations_token_hash_uidx
  ON public.tenant_invitations (token_hash);

CREATE TRIGGER tenant_invitations_set_updated_at
  BEFORE UPDATE ON public.tenant_invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.tenant_invitations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tenant_invitations FROM PUBLIC;
REVOKE ALL ON TABLE public.tenant_invitations FROM anon;
REVOKE ALL ON TABLE public.tenant_invitations FROM authenticated;

-- Drop ineffective DML policies; SELECT remains for getCurrentContext /api/me.
DROP POLICY IF EXISTS "memberships_insert_owner_admin" ON public.memberships;
DROP POLICY IF EXISTS "memberships_update_owner_admin" ON public.memberships;

-- ---------------------------------------------------------------------------
-- Internal helpers (not granted to authenticated)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.normalize_invitation_email(value text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select nullif(lower(btrim(coalesce(value, ''))), '');
$function$;

CREATE OR REPLACE FUNCTION public.hash_invitation_token(p_token text)
  RETURNS bytea
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select extensions.digest(coalesce(p_token, ''), 'sha256');
$function$;

CREATE OR REPLACE FUNCTION public.is_invitable_membership_role(p_role text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select p_role = any (array['admin'::text, 'manager'::text, 'staff'::text, 'viewer'::text]);
$function$;

CREATE OR REPLACE FUNCTION public.actor_can_assign_membership_role(
  p_actor_role text,
  p_target_role text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case
    when p_target_role = 'owner' then false
    when p_actor_role = 'owner'
      and p_target_role = any (array['admin'::text, 'manager'::text, 'staff'::text, 'viewer'::text])
      then true
    when p_actor_role = 'admin'
      and p_target_role = any (array['manager'::text, 'staff'::text, 'viewer'::text])
      then true
    else false
  end;
$function$;

CREATE OR REPLACE FUNCTION public.actor_can_manage_membership_target(
  p_actor_role text,
  p_target_role text
)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  SET search_path TO ''
  AS $function$
  select case
    when p_target_role = 'owner' then false
    when p_actor_role = 'owner'
      and p_target_role = any (array['admin'::text, 'manager'::text, 'staff'::text, 'viewer'::text])
      then true
    when p_actor_role = 'admin'
      and p_target_role = any (array['manager'::text, 'staff'::text, 'viewer'::text])
      then true
    else false
  end;
$function$;

REVOKE ALL ON FUNCTION public.normalize_invitation_email(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_invitation_email(text) FROM anon;
REVOKE ALL ON FUNCTION public.normalize_invitation_email(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.hash_invitation_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hash_invitation_token(text) FROM anon;
REVOKE ALL ON FUNCTION public.hash_invitation_token(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.is_invitable_membership_role(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_invitable_membership_role(text) FROM anon;
REVOKE ALL ON FUNCTION public.is_invitable_membership_role(text) FROM authenticated;

REVOKE ALL ON FUNCTION public.actor_can_assign_membership_role(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.actor_can_assign_membership_role(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.actor_can_assign_membership_role(text, text) FROM authenticated;

REVOKE ALL ON FUNCTION public.actor_can_manage_membership_target(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.actor_can_manage_membership_target(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.actor_can_manage_membership_target(text, text) FROM authenticated;

-- ---------------------------------------------------------------------------
-- create_tenant_invitation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_tenant_invitation(
  p_tenant_id uuid,
  p_email text,
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
  v_email text;
  v_role text;
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
    'expires_at', v_invitation.expires_at,
    'send_attempts', v_invitation.send_attempts,
    'token', v_token
  );
end;
$function$;

COMMENT ON FUNCTION public.create_tenant_invitation(uuid, text, text) IS
  'DEFINER acotado: crea/supersede invitación pending. Actor=auth.uid(). Nunca owner. Token en claro solo una vez.';

REVOKE ALL ON FUNCTION public.create_tenant_invitation(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_tenant_invitation(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_tenant_invitation(uuid, text, text)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- list_tenant_access
-- ---------------------------------------------------------------------------

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

COMMENT ON FUNCTION public.list_tenant_access(uuid) IS
  'DEFINER acotado: lista memberships + invitaciones pending del tenant. Solo owner/admin. Sin token_hash.';

REVOKE ALL ON FUNCTION public.list_tenant_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_tenant_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_tenant_access(uuid)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- accept_tenant_invitation
-- ---------------------------------------------------------------------------

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
  values (v_actor_id, v_full_name)
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
    )
  );
end;
$function$;

COMMENT ON FUNCTION public.accept_tenant_invitation(text) IS
  'DEFINER acotado: acepta invitación por token. Garantiza profile. Crea/reactiva membership. Atomico.';

REVOKE ALL ON FUNCTION public.accept_tenant_invitation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_tenant_invitation(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_tenant_invitation(text)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- revoke_tenant_invitation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_tenant_invitation(
  p_invitation_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_invitation public.tenant_invitations%rowtype;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_invitation_id is null then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  select i.*
  into v_invitation
  from public.tenant_invitations i
  where i.id = p_invitation_id
  for update;

  if v_invitation.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  select m.role
  into v_actor_role
  from public.memberships m
  where m.tenant_id = v_invitation.tenant_id
    and m.user_id = v_actor_id
    and m.active = true
  for update;

  if v_actor_role is null then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'invitation not pending' using errcode = '22023';
  end if;

  if not public.actor_can_manage_membership_target(v_actor_role, v_invitation.role) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  update public.tenant_invitations
  set
    status = 'revoked',
    revoked_at = now(),
    revoked_by_user_id = v_actor_id,
    updated_at = now()
  where id = v_invitation.id
  returning * into v_invitation;

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'status', v_invitation.status,
    'revoked_at', v_invitation.revoked_at
  );
end;
$function$;

COMMENT ON FUNCTION public.revoke_tenant_invitation(uuid) IS
  'DEFINER acotado: revoca invitación pending. Jerarquía owner/admin en BD.';

REVOKE ALL ON FUNCTION public.revoke_tenant_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_tenant_invitation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.revoke_tenant_invitation(uuid)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- resend_tenant_invitation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.resend_tenant_invitation(
  p_invitation_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_invitation public.tenant_invitations%rowtype;
  v_token text;
  v_token_hash bytea;
  v_tenant public.tenants%rowtype;
begin
  if v_actor_id is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_invitation_id is null then
    raise exception 'invalid value' using errcode = '22023';
  end if;

  select i.*
  into v_invitation
  from public.tenant_invitations i
  where i.id = p_invitation_id
  for update;

  if v_invitation.id is null then
    raise exception 'invitation not found' using errcode = 'P0002';
  end if;

  select m.role
  into v_actor_role
  from public.memberships m
  where m.tenant_id = v_invitation.tenant_id
    and m.user_id = v_actor_id
    and m.active = true
  for update;

  if v_actor_role is null then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  if v_invitation.status <> 'pending' then
    raise exception 'invitation not pending' using errcode = '22023';
  end if;

  if not public.actor_can_manage_membership_target(v_actor_role, v_invitation.role) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  select t.*
  into v_tenant
  from public.tenants t
  where t.id = v_invitation.tenant_id;

  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_token_hash := public.hash_invitation_token(v_token);

  update public.tenant_invitations
  set
    token_hash = v_token_hash,
    expires_at = now() + interval '7 days',
    last_sent_at = now(),
    send_attempts = send_attempts + 1,
    updated_at = now()
  where id = v_invitation.id
  returning * into v_invitation;

  return jsonb_build_object(
    'invitation_id', v_invitation.id,
    'tenant_id', v_tenant.id,
    'tenant_name', v_tenant.name,
    'tenant_slug', v_tenant.slug,
    'email', v_invitation.email_normalized,
    'role', v_invitation.role,
    'expires_at', v_invitation.expires_at,
    'send_attempts', v_invitation.send_attempts,
    'token', v_token
  );
end;
$function$;

COMMENT ON FUNCTION public.resend_tenant_invitation(uuid) IS
  'DEFINER acotado: rota token, renueva expires_at e incrementa send_attempts. Token nuevo solo una vez.';

REVOKE ALL ON FUNCTION public.resend_tenant_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resend_tenant_invitation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resend_tenant_invitation(uuid)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- update_tenant_membership_role
-- ---------------------------------------------------------------------------

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

  select m.*
  into v_target
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = p_user_id
  for update;

  if v_target.id is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  if not public.actor_can_manage_membership_target(v_actor_role, v_target.role) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  if not public.actor_can_assign_membership_role(v_actor_role, v_role) then
    raise exception 'tenant access denied' using errcode = '42501';
  end if;

  update public.memberships
  set
    role = v_role,
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

COMMENT ON FUNCTION public.update_tenant_membership_role(uuid, uuid, text) IS
  'DEFINER acotado: cambia rol membership. Jerarquía en BD. Nunca owner.';

REVOKE ALL ON FUNCTION public.update_tenant_membership_role(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_tenant_membership_role(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_tenant_membership_role(uuid, uuid, text)
  TO authenticated, postgres;

-- ---------------------------------------------------------------------------
-- set_tenant_membership_active
-- ---------------------------------------------------------------------------

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

  select m.*
  into v_target
  from public.memberships m
  where m.tenant_id = p_tenant_id
    and m.user_id = p_user_id
  for update;

  if v_target.id is null then
    raise exception 'membership not found' using errcode = 'P0002';
  end if;

  if not public.actor_can_manage_membership_target(v_actor_role, v_target.role) then
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
  'DEFINER acotado: activa/desactiva membership. Nunca DELETE. Owners inmutables vía jerarquía.';

REVOKE ALL ON FUNCTION public.set_tenant_membership_active(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_tenant_membership_active(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_tenant_membership_active(uuid, uuid, boolean)
  TO authenticated, postgres;
