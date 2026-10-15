-- Clients · optional postal address (#101). Additive and backward compatible.
--
-- - clients.address: nullable free text (max 500 characters). Existing clients
--   stay valid with NULL; no backfill and no change to tenant_id/RLS.
-- - create_client_v2 / update_client_v2: same contract as create_client /
--   update_client plus p_address, under a NEW name so PostgREST never has to
--   choose between overloads (PGRST203) and the app version currently deployed
--   keeps calling the unchanged v1 functions.
-- - SECURITY INVOKER like v1: the caller's role checks, RLS and duplicate rules
--   run unchanged inside the delegated v1 call; the address is written in the
--   same transaction.
-- - update_client_v2 always applies p_address (NULL or blank clears it). The
--   API only calls it when the request carries an address; otherwise it keeps
--   using update_client and the stored address is left untouched.
-- - The client activity trigger is unchanged: address edits are not logged in
--   the client history in V1.

begin;

alter table public.clients
  add column if not exists address text;

alter table public.clients
  add constraint clients_address_length_check
  check (address is null or pg_catalog.char_length(address) <= 500);

comment on column public.clients.address is
  'Optional free-text postal address (#101). NULL when unknown. Max 500 characters.';

create or replace function public.create_client_v2 (
  p_customer_type_id uuid,
  p_name text,
  p_contact_name text,
  p_company_name text,
  p_tax_id text,
  p_email text,
  p_phone text,
  p_notes text,
  p_tenant_id uuid,
  p_address text
)
  returns jsonb
  language plpgsql
  set search_path to ''
as $function$
declare
  v_address text := nullif(pg_catalog.btrim(p_address), '');
  v_result jsonb;
  v_client public.clients%rowtype;
begin
  if v_address is not null and pg_catalog.char_length(v_address) > 500 then
    raise exception 'client address too long'
      using errcode = '22023';
  end if;

  v_result := public.create_client(
    p_customer_type_id, p_name, p_contact_name, p_company_name, p_tax_id,
    p_email, p_phone, p_notes, p_tenant_id
  );

  if v_address is null then
    return v_result;
  end if;

  update public.clients
  set address = v_address
  where id = (v_result -> 'client' ->> 'id')::uuid
    and tenant_id = p_tenant_id
  returning * into v_client;

  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  return pg_catalog.jsonb_build_object(
    'client', pg_catalog.to_jsonb(v_client) - 'metadata' - 'created_by'
  );
end;
$function$;

comment on function public.create_client_v2(uuid, text, text, text, text, text, text, text, uuid, text) is
  'create_client plus optional address (#101), same transaction. SECURITY INVOKER: v1 role checks, RLS and duplicate rules apply.';

revoke all on function public.create_client_v2(uuid, text, text, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.create_client_v2(uuid, text, text, text, text, text, text, text, uuid, text) to authenticated;

create or replace function public.update_client_v2 (
  p_client_id uuid,
  p_customer_type_id uuid,
  p_name text,
  p_contact_name text,
  p_company_name text,
  p_tax_id text,
  p_email text,
  p_phone text,
  p_notes text,
  p_tenant_id uuid,
  p_address text
)
  returns jsonb
  language plpgsql
  set search_path to ''
as $function$
declare
  v_address text := nullif(pg_catalog.btrim(p_address), '');
  v_result jsonb;
  v_client public.clients%rowtype;
begin
  if v_address is not null and pg_catalog.char_length(v_address) > 500 then
    raise exception 'client address too long'
      using errcode = '22023';
  end if;

  v_result := public.update_client(
    p_client_id, p_customer_type_id, p_name, p_contact_name, p_company_name,
    p_tax_id, p_email, p_phone, p_notes, p_tenant_id
  );

  update public.clients
  set address = v_address
  where id = p_client_id
    and tenant_id = p_tenant_id
  returning * into v_client;

  if not found then
    raise exception 'client not found'
      using errcode = 'P0002';
  end if;

  return pg_catalog.jsonb_build_object(
    'client', pg_catalog.to_jsonb(v_client) - 'metadata' - 'created_by'
  );
end;
$function$;

comment on function public.update_client_v2(uuid, uuid, text, text, text, text, text, text, text, uuid, text) is
  'update_client plus address (#101), same transaction; NULL/blank clears it. SECURITY INVOKER: v1 role checks, RLS and duplicate rules apply.';

revoke all on function public.update_client_v2(uuid, uuid, text, text, text, text, text, text, text, uuid, text) from public, anon;
grant execute on function public.update_client_v2(uuid, uuid, text, text, text, text, text, text, text, uuid, text) to authenticated;

commit;
