-- Clients · optional address (#101): v2 RPCs, v1 compatibility, roles,
-- tenant isolation, atomicity and history. Synthetic fixtures, rolled back.
begin;

create function pg_temp.phase48_as(p_user uuid)
  returns void
  language plpgsql
as $helper$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
end;
$helper$;

do $phase48$
declare
  tenant_a uuid := 'e4800000-0000-4000-8000-000000000011';
  tenant_b uuid := 'e4800000-0000-4000-8000-000000000012';
  owner_a uuid := 'e4800000-0000-4000-8000-000000000001';
  staff_a uuid := 'e4800000-0000-4000-8000-000000000002';
  viewer_a uuid := 'e4800000-0000-4000-8000-000000000003';
  owner_b uuid := 'e4800000-0000-4000-8000-000000000004';
  r jsonb;
  client_1 uuid;
  client_2 uuid;
  client_v1 uuid;
  err text;
  n integer;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (owner_a, 'owner-a@phase48.test', '{}'::jsonb),
    (staff_a, 'staff-a@phase48.test', '{}'::jsonb),
    (viewer_a, 'viewer-a@phase48.test', '{}'::jsonb),
    (owner_b, 'owner-b@phase48.test', '{}'::jsonb);
  insert into public.profiles (id, full_name) values
    (owner_a, 'Owner A'), (staff_a, 'Staff A'), (viewer_a, 'Viewer A'), (owner_b, 'Owner B');
  insert into public.tenants (id, name, slug, active) values
    (tenant_a, 'Phase48 A', 'phase48a', true),
    (tenant_b, 'Phase48 B', 'phase48b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (tenant_a, owner_a, 'owner', true),
    (tenant_a, staff_a, 'staff', true),
    (tenant_a, viewer_a, 'viewer', true),
    (tenant_b, owner_b, 'owner', true);

  -- Existing contract: v1 still works and leaves address NULL.
  perform pg_temp.phase48_as(staff_a);
  r := public.create_client(null, 'Cliente v1', null, null, null, 'v1@phase48.test', null, null, tenant_a);
  client_v1 := (r -> 'client' ->> 'id')::uuid;
  if (r -> 'client') ? 'address' is false or (r -> 'client' ->> 'address') is not null then
    raise exception 'phase48: v1 create must expose a NULL address';
  end if;

  -- v2 with address, without address and with a blank address.
  r := public.create_client_v2(null, 'Cliente con dirección', null, null, null, 'one@phase48.test', null, null, tenant_a,
    '  Calle Sintética 1, 3º B · 00000 Pruebas  ');
  client_1 := (r -> 'client' ->> 'id')::uuid;
  if r -> 'client' ->> 'address' is distinct from 'Calle Sintética 1, 3º B · 00000 Pruebas' then
    raise exception 'phase48: v2 did not store the trimmed address: %', r -> 'client' ->> 'address';
  end if;
  if (r -> 'client') ? 'metadata' or (r -> 'client') ? 'created_by' then
    raise exception 'phase48: v2 leaked internal columns';
  end if;
  r := public.create_client_v2(null, 'Cliente sin dirección', null, null, null, 'two@phase48.test', null, null, tenant_a, '   ');
  client_2 := (r -> 'client' ->> 'id')::uuid;
  if (select address from public.clients where id = client_2) is not null then
    raise exception 'phase48: blank address must be NULL';
  end if;

  -- One creation = one history entry (the address write is not a second event).
  execute 'reset role'; -- staff cannot read activity_log under RLS
  select count(*) into n from public.activity_log where entity_id = client_1 and entity_type = 'client';
  if n <> 1 then
    raise exception 'phase48: expected 1 history entry for the creation, got %', n;
  end if;
  perform pg_temp.phase48_as(staff_a);

  -- Atomic: an invalid address creates nothing.
  err := null;
  begin
    perform public.create_client_v2(null, 'Demasiado larga', null, null, null, 'long@phase48.test', null, null, tenant_a, pg_catalog.repeat('x', 501));
  exception when others then err := sqlstate;
  end;
  if err is distinct from '22023' or exists (select 1 from public.clients where email = 'long@phase48.test') then
    raise exception 'phase48: over-long address must fail with 22023 and create nothing (got %)', err;
  end if;

  -- Duplicate rules still run inside v2.
  err := null;
  begin
    perform public.create_client_v2(null, 'Duplicado', null, null, null, 'one@phase48.test', null, null, tenant_a, 'Otra calle');
  exception when others then err := sqlstate;
  end;
  if err is null or (select count(*) from public.clients where tenant_id = tenant_a and email = 'one@phase48.test') <> 1 then
    raise exception 'phase48: v2 bypassed duplicate detection';
  end if;

  -- Updates: v2 sets and clears; v1 leaves the address untouched.
  r := public.update_client_v2(client_1, null, 'Cliente con dirección', null, null, null, 'one@phase48.test', null, null, tenant_a, 'Avenida Sintética 2');
  if r -> 'client' ->> 'address' is distinct from 'Avenida Sintética 2' then
    raise exception 'phase48: v2 update did not change the address';
  end if;
  perform public.update_client(client_1, null, 'Cliente renombrado', null, null, null, 'one@phase48.test', null, null, tenant_a);
  if (select address from public.clients where id = client_1) is distinct from 'Avenida Sintética 2' then
    raise exception 'phase48: v1 update must not touch the address';
  end if;
  r := public.update_client_v2(client_1, null, 'Cliente renombrado', null, null, null, 'one@phase48.test', null, null, tenant_a, null);
  if (select address from public.clients where id = client_1) is not null then
    raise exception 'phase48: v2 update with NULL must clear the address';
  end if;
  perform public.update_client_v2(client_1, null, 'Cliente renombrado', null, null, null, 'one@phase48.test', null, null, tenant_a, 'Calle Final 3');

  -- Viewer: no create, no update, address unchanged.
  perform pg_temp.phase48_as(viewer_a);
  err := null;
  begin
    perform public.create_client_v2(null, 'Viewer', null, null, null, null, null, null, tenant_a, 'Calle');
  exception when others then err := sqlstate;
  end;
  if err is distinct from '42501' then
    raise exception 'phase48: viewer create_client_v2 expected 42501, got %', err;
  end if;
  err := null;
  begin
    perform public.update_client_v2(client_1, null, 'Viewer', null, null, null, 'one@phase48.test', null, null, tenant_a, 'Hijacked');
  exception when others then err := sqlstate;
  end;
  if err is null then
    raise exception 'phase48: viewer update_client_v2 succeeded';
  end if;

  -- Another tenant cannot read or change it, whatever tenant it claims.
  perform pg_temp.phase48_as(owner_b);
  if exists (select 1 from public.clients where id = client_1) then
    raise exception 'phase48: tenant B reads tenant A client';
  end if;
  foreach err in array array['a', 'b'] loop
    begin
      perform public.update_client_v2(client_1, null, 'B', null, null, null, null, null, null,
        case when err = 'a' then tenant_a else tenant_b end, 'Hijacked');
    exception when others then null;
    end;
  end loop;
  update public.clients set address = 'Hijacked' where id = client_1;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'phase48: tenant B updated tenant A client directly';
  end if;

  execute 'reset role';
  if (select address from public.clients where id = client_1) is distinct from 'Calle Final 3' then
    raise exception 'phase48: address changed by a denied caller';
  end if;

  -- Column constraint also protects direct writes.
  err := null;
  begin
    update public.clients set address = pg_catalog.repeat('y', 501) where id = client_v1;
  exception when check_violation then err := sqlstate;
  end;
  if err is distinct from '23514' then
    raise exception 'phase48: address length check missing';
  end if;

  if has_function_privilege('anon', 'public.create_client_v2(uuid,text,text,text,text,text,text,text,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.update_client_v2(uuid,uuid,text,text,text,text,text,text,text,uuid,text)', 'EXECUTE') then
    raise exception 'phase48: anon can execute client v2 RPCs';
  end if;
  if (select prosecdef from pg_proc where oid = 'public.create_client_v2(uuid,text,text,text,text,text,text,text,uuid,text)'::regprocedure)
     or (select prosecdef from pg_proc where oid = 'public.update_client_v2(uuid,uuid,text,text,text,text,text,text,text,uuid,text)'::regprocedure) then
    raise exception 'phase48: client v2 RPCs must stay SECURITY INVOKER';
  end if;
end;
$phase48$;
rollback;
