-- Phase 2C-B: resend rate-limit (cooldown 60s, max 10 attempts) before token rotate.
-- Run locally after applying 20260909120000_invitation_resend_rate_limit.sql
-- Rolls back at end.

do $phase2cb$
declare
  v_owner uuid := 'c1000000-0000-4000-8000-000000000001';
  v_invitee uuid := 'c1000000-0000-4000-8000-000000000011';
  v_tenant uuid := 'c2000000-0000-4000-8000-000000000001';
  v_invitation_id uuid;
  v_result jsonb;
  v_token text;
  v_hash bytea;
  v_sqlstate text;
  v_err text;
  v_attempts integer;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-2cb@phase2cb.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner 2CB"}'::jsonb, now(), now(), '', '', '', ''),
    (v_invitee, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'invitee-2cb@phase2cb.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Invitee 2CB"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner, 'Owner 2CB');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant, 'Tenant 2CB', 'tenant-2cb', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant, v_owner, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  v_result := public.create_tenant_invitation(v_tenant, 'invitee-2cb@phase2cb.test', 'staff');
  v_invitation_id := (v_result ->> 'invitation_id')::uuid;
  v_token := v_result ->> 'token';
  select token_hash into v_hash from public.tenant_invitations where id = v_invitation_id;

  -- E: resend too soon → P0003, hash unchanged
  begin
    perform public.resend_tenant_invitation(v_invitation_id);
    raise exception 'FAIL E: expected cooldown';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_err = message_text;
    if v_sqlstate <> 'GTC01' then
      raise exception 'FAIL E: expected GTC01 got % %', v_sqlstate, v_err;
    end if;
  end;

  if (select token_hash from public.tenant_invitations where id = v_invitation_id) is distinct from v_hash then
    raise exception 'FAIL E: token rotated despite cooldown';
  end if;

  -- Advance last_sent_at to allow resend (F)
  update public.tenant_invitations
  set last_sent_at = now() - interval '61 seconds'
  where id = v_invitation_id;

  v_result := public.resend_tenant_invitation(v_invitation_id);
  if (v_result ->> 'token') is null or (v_result ->> 'token') = v_token then
    raise exception 'FAIL F: expected new token after cooldown';
  end if;
  if (v_result ->> 'send_attempts')::int <> 2 then
    raise exception 'FAIL F: send_attempts should be 2';
  end if;

  -- G: max attempts — set to 10, ensure no rotate
  update public.tenant_invitations
  set
    send_attempts = 10,
    last_sent_at = now() - interval '61 seconds'
  where id = v_invitation_id;

  select token_hash into v_hash from public.tenant_invitations where id = v_invitation_id;

  begin
    perform public.resend_tenant_invitation(v_invitation_id);
    raise exception 'FAIL G: expected max attempts';
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate, v_err = message_text;
    if v_sqlstate <> 'GTC02' then
      raise exception 'FAIL G: expected GTC02 got % %', v_sqlstate, v_err;
    end if;
  end;

  if (select token_hash from public.tenant_invitations where id = v_invitation_id) is distinct from v_hash then
    raise exception 'FAIL G: token rotated despite max attempts';
  end if;

  select send_attempts into v_attempts from public.tenant_invitations where id = v_invitation_id;
  if v_attempts <> 10 then
    raise exception 'FAIL G: send_attempts mutated on block';
  end if;

  -- I: accept still works with a fresh create token path
  update public.tenant_invitations
  set
    send_attempts = 1,
    last_sent_at = now() - interval '61 seconds',
    status = 'pending'
  where id = v_invitation_id;

  v_result := public.resend_tenant_invitation(v_invitation_id);
  v_token := v_result ->> 'token';

  perform set_config('request.jwt.claim.sub', v_invitee::text, true);
  v_result := public.accept_tenant_invitation(v_token);
  if (v_result #>> '{membership,role}') <> 'staff' then
    raise exception 'FAIL I: accept after resend';
  end if;

  raise notice 'PASS_P2CB_RATE_LIMIT';
  raise exception 'ROLLBACK_P2CB';
exception
  when others then
    if sqlerrm = 'ROLLBACK_P2CB' then
      raise notice 'phase2cb rolled back cleanly';
    else
      raise;
    end if;
end;
$phase2cb$;
