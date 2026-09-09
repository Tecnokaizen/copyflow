-- Phase 2C-B: rate-limit resend_tenant_invitation before token rotation.
-- Cooldown: 60 seconds since last_sent_at.
-- Cap: 10 send_attempts per invitation.

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

  -- Rate limits BEFORE rotating the token.
  if v_invitation.send_attempts >= 10 then
    raise exception 'invitation resend limit reached' using errcode = 'GTC02';
  end if;

  if v_invitation.last_sent_at is not null
     and v_invitation.last_sent_at > (now() - interval '60 seconds') then
    raise exception 'invitation resend too soon' using errcode = 'GTC01';
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
  'DEFINER acotado: rate-limit (60s / 10 attempts), rota token, renueva expires_at. Token nuevo solo una vez.';

REVOKE ALL ON FUNCTION public.resend_tenant_invitation(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resend_tenant_invitation(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resend_tenant_invitation(uuid)
  TO authenticated, postgres;
