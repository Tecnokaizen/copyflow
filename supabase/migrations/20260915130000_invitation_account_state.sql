-- Invitation preview: Gestcopy membership, not auth.users existence.
-- Does not modify 20260914220000; that migration is already applied remotely.

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
  v_has_membership boolean := false;
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

  if v_account_id is not null then
    v_has_membership := exists (
      select 1
      from public.memberships m
      where m.user_id = v_account_id
    );
  end if;

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
    'requires_login',
      v_account_id is not null
      and coalesce(v_email_confirmed, false)
      and v_has_membership
  );
end;
$function$;

COMMENT ON FUNCTION public.preview_tenant_invitation(text) IS
  'DEFINER acotado: preview de invitación por token. Anon+authenticated. requires_login solo si hay auth user confirmado con membership Gestcopy. No expone token_hash, auth_user_id, account_exists ni email_confirmed.';

REVOKE ALL ON FUNCTION public.preview_tenant_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_tenant_invitation(text)
  TO anon, authenticated, service_role, postgres;
