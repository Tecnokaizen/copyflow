-- Files V1 · F2-A / F2-A.1 / F2-A.2: grants, RPC-only, HMAC capability, activity.
-- Run against local db after 20260918220000_order_files_v1.sql.

begin;

select vault.create_secret(
  'phase17-files-signing-secret-at-least-32-chars',
  'files_signing_secret',
  'Files phase17 test secret'
);

create or replace function pg_temp.files_signature(
  p_secret text,
  p_purpose text,
  p_user_id uuid,
  p_tenant_id uuid,
  p_order_id uuid,
  p_file_id uuid,
  p_issued_at bigint
)
returns text
language sql
immutable
as $$
  select encode(
    extensions.hmac(
      convert_to(
        'files-v1|' || p_purpose || '|' || p_user_id::text || '|' ||
        p_tenant_id::text || '|' || p_order_id::text || '|' ||
        p_file_id::text || '|' || p_issued_at::text,
        'UTF8'
      ),
      convert_to(p_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

do $phase17$
declare
  v_secret text := 'phase17-files-signing-secret-at-least-32-chars';
  v_owner_a uuid := 'e1000000-0000-4000-8000-000000000001';
  v_staff_a uuid := 'e1000000-0000-4000-8000-000000000002';
  v_viewer_a uuid := 'e1000000-0000-4000-8000-000000000003';
  v_owner_b uuid := 'e1000000-0000-4000-8000-000000000004';
  v_tenant_a uuid := 'e1000000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e1000000-0000-4000-8000-000000000012';
  v_status_a uuid := 'e1000000-0000-4000-8000-000000000021';
  v_status_closed_a uuid := 'e1000000-0000-4000-8000-000000000022';
  v_status_b uuid := 'e1000000-0000-4000-8000-000000000023';
  v_service_a uuid := 'e1000000-0000-4000-8000-000000000031';
  v_service_b uuid := 'e1000000-0000-4000-8000-000000000032';
  v_order_open uuid := 'e1000000-0000-4000-8000-000000000061';
  v_order_archived uuid := 'e1000000-0000-4000-8000-000000000062';
  v_order_b uuid := 'e1000000-0000-4000-8000-000000000063';
  v_file_pending uuid := 'e1000000-0000-4000-8000-000000000071';
  v_file_ready uuid := 'e1000000-0000-4000-8000-000000000072';
  v_file_dup uuid := 'e1000000-0000-4000-8000-000000000073';
  v_file_cross uuid := 'e1000000-0000-4000-8000-000000000074';
  v_file_viewer uuid := 'e1000000-0000-4000-8000-000000000075';
  v_file_arch uuid := 'e1000000-0000-4000-8000-000000000076';
  v_file_forge uuid := 'e1000000-0000-4000-8000-000000000077';
  v_file_cap uuid := 'e1000000-0000-4000-8000-000000000078';
  v_issued_at bigint;
  v_sig text;
  v_sqlstate text;
  v_message text;
  v_count integer;
  v_activity integer;
  v_status text;
  v_result jsonb;
  v_storage_key text;
  v_has_insert boolean;
  v_has_update boolean;
  v_has_delete boolean;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase17.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase17.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Staff A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase17.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Viewer A"}'::jsonb, now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase17.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb,
     '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'),
    (v_staff_a, 'Staff A'),
    (v_viewer_a, 'Viewer A'),
    (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase17', 'tenant-a-phase17', true),
    (v_tenant_b, 'Tenant B Phase17', 'tenant-b-phase17', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.order_statuses (
    id, tenant_id, name, code, active, sort_order,
    is_initial, is_ready, is_closed, is_cancelled
  ) values
    (v_status_a, v_tenant_a, 'Recibido', 'received', true, 1, true, false, false, false),
    (v_status_closed_a, v_tenant_a, 'Entregado', 'delivered', true, 2, false, false, true, false);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_a, v_tenant_a, 'Servicio A', true, 1);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values
    (v_order_open, v_tenant_a, 'Abierto files', v_service_a, v_status_a, v_owner_a),
    (v_order_archived, v_tenant_a, 'Archivado files', v_service_a, v_status_closed_a, v_owner_a);

  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.order_statuses (
    id, tenant_id, name, code, active, sort_order,
    is_initial, is_ready, is_closed, is_cancelled
  ) values
    (v_status_b, v_tenant_b, 'Recibido', 'received', true, 1, true, false, false, false);

  insert into public.services (id, tenant_id, name, active, sort_order) values
    (v_service_b, v_tenant_b, 'Servicio B', true, 1);

  insert into public.orders (
    id, tenant_id, title, service_id, status_id, created_by
  ) values
    (v_order_b, v_tenant_b, 'Pedido B', v_service_b, v_status_b, v_owner_b);

  execute 'reset role';

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  perform public.archive_order(v_order_archived, v_tenant_a);
  execute 'reset role';

  -- Grants: SELECT yes, INSERT/UPDATE/DELETE no
  if not has_table_privilege('authenticated', 'public.order_files', 'SELECT') then
    raise exception 'FAIL authenticated must have SELECT on order_files';
  end if;
  select has_table_privilege('authenticated', 'public.order_files', 'INSERT') into v_has_insert;
  select has_table_privilege('authenticated', 'public.order_files', 'UPDATE') into v_has_update;
  select has_table_privilege('authenticated', 'public.order_files', 'DELETE') into v_has_delete;
  if v_has_insert or v_has_update or v_has_delete then
    raise exception 'FAIL authenticated must not have INSERT/UPDATE/DELETE on order_files';
  end if;

  -- ==========================================================
  -- A) direct INSERT denied
  -- ==========================================================
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  v_sqlstate := null;
  begin
    insert into public.order_files (
      id, tenant_id, order_id, original_name, size_bytes,
      storage_key, status, uploaded_by, upload_expires_at
    ) values (
      v_file_forge, v_tenant_a, v_order_open, 'direct.pdf', 100,
      'orders/' || v_tenant_a::text || '/' || v_order_open::text || '/' || v_file_forge::text,
      'pending', v_staff_a, now() + interval '15 minutes'
    );
  exception when insufficient_privilege then
    v_sqlstate := '42501';
  when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is null then
    raise exception 'FAIL A: direct INSERT must be denied';
  end if;

  -- ==========================================================
  -- Capability denials (create)
  -- ==========================================================
  v_issued_at := extract(epoch from now())::bigint;

  -- without signature
  v_sqlstate := null; v_message := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cap, 'c.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, null
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is null then
    raise exception 'FAIL create without signature must deny';
  end if;

  -- forged signature
  v_sqlstate := null; v_message := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cap, 'c.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, repeat('a', 64)
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'invalid capability' then
    raise exception 'FAIL forged signature got % / %', v_sqlstate, v_message;
  end if;

  -- expired
  v_sqlstate := null; v_message := null;
  v_issued_at := extract(epoch from now())::bigint - 121;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_a, v_order_open, v_file_cap, v_issued_at
  );
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cap, 'c.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'invalid capability' then
    raise exception 'FAIL expired capability got % / %', v_sqlstate, v_message;
  end if;

  -- wrong user (signed as owner, called as staff)
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_owner_a, v_tenant_a, v_order_open, v_file_cap, v_issued_at
  );
  v_sqlstate := null; v_message := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cap, 'c.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'invalid capability' then
    raise exception 'FAIL wrong user capability got % / %', v_sqlstate, v_message;
  end if;

  -- wrong tenant in payload
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_b, v_order_open, v_file_cap, v_issued_at
  );
  v_sqlstate := null; v_message := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cap, 'c.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'invalid capability' then
    raise exception 'FAIL wrong tenant capability got % / %', v_sqlstate, v_message;
  end if;

  -- wrong order
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_a, v_order_b, v_file_cap, v_issued_at
  );
  v_sqlstate := null; v_message := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cap, 'c.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'invalid capability' then
    raise exception 'FAIL wrong order capability got % / %', v_sqlstate, v_message;
  end if;

  -- wrong file
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_a, v_order_open, v_file_dup, v_issued_at
  );
  v_sqlstate := null; v_message := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cap, 'c.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'invalid capability' then
    raise exception 'FAIL wrong file capability got % / %', v_sqlstate, v_message;
  end if;

  -- wrong purpose
  v_sig := pg_temp.files_signature(
    v_secret, 'complete', v_staff_a, v_tenant_a, v_order_open, v_file_cap, v_issued_at
  );
  v_sqlstate := null; v_message := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cap, 'c.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'invalid capability' then
    raise exception 'FAIL wrong purpose capability got % / %', v_sqlstate, v_message;
  end if;

  -- ==========================================================
  -- D) RPC create with valid capability PASS
  -- ==========================================================
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_a, v_order_open, v_file_pending, v_issued_at
  );
  v_result := public.create_order_file_upload(
    v_order_open, v_file_pending, 'doc.pdf', 'application/pdf', 1024,
    now() + interval '15 minutes', v_issued_at, v_sig
  );
  if v_result #>> '{file,id}' is distinct from v_file_pending::text then
    raise exception 'FAIL D: create RPC id';
  end if;
  if v_result #>> '{file,status}' is distinct from 'pending' then
    raise exception 'FAIL D: create RPC status';
  end if;
  v_storage_key := v_result->>'storage_key';
  if v_storage_key is distinct from
     ('orders/' || v_tenant_a::text || '/' || v_order_open::text || '/' || v_file_pending::text)
  then
    raise exception 'FAIL D: storage_key contract got %', v_storage_key;
  end if;

  -- Viewer SELECT
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_count from public.order_files where id = v_file_pending;
  if v_count <> 1 then
    raise exception 'FAIL viewer SELECT';
  end if;

  -- I) viewer RPC create DENIED (role before/with capability)
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_viewer_a, v_tenant_a, v_order_open, v_file_viewer, v_issued_at
  );
  v_sqlstate := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_viewer, 'v.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL I: viewer create expected 42501 got %', v_sqlstate;
  end if;

  -- B/F/G) direct UPDATE denied
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  v_sqlstate := null;
  begin
    update public.order_files
    set status = 'ready', etag = '"x"', completed_at = now()
    where id = v_file_pending;
  exception when insufficient_privilege then
    v_sqlstate := '42501';
  when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is null then
    raise exception 'FAIL B/F: direct pending->ready must be denied';
  end if;

  v_sqlstate := null;
  begin
    update public.order_files
    set etag = '"forged"', completed_at = now()
    where id = v_file_pending;
  exception when insufficient_privilege then
    v_sqlstate := '42501';
  when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is null then
    raise exception 'FAIL G: direct etag/completed_at must be denied';
  end if;

  -- C) direct DELETE denied
  v_sqlstate := null;
  begin
    delete from public.order_files where id = v_file_pending;
  exception when insufficient_privilege then
    v_sqlstate := '42501';
  when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is null then
    select count(*) into v_count from public.order_files where id = v_file_pending;
    if v_count <> 1 then
      raise exception 'FAIL C: direct DELETE removed row';
    end if;
    raise exception 'FAIL C: direct DELETE must be denied';
  end if;

  -- E) complete with capability PASS + activity
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'complete', v_staff_a, v_tenant_a, v_order_open, v_file_pending, v_issued_at
  );
  v_result := public.complete_order_file_upload(
    v_order_open, v_file_pending, '"etag-1"', v_issued_at, v_sig
  );
  if v_result #>> '{file,status}' is distinct from 'ready' then
    raise exception 'FAIL E: complete status';
  end if;
  if (v_result->>'replay')::boolean is distinct from false then
    raise exception 'FAIL E: first complete replay=false';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_activity
  from public.activity_log
  where tenant_id = v_tenant_a
    and action = 'order.file_uploaded'
    and (metadata->>'file_id') = v_file_pending::text;
  if v_activity <> 1 then
    raise exception 'FAIL L: expected 1 file_uploaded, got %', v_activity;
  end if;

  -- M) complete replay
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'complete', v_staff_a, v_tenant_a, v_order_open, v_file_pending, v_issued_at
  );
  v_result := public.complete_order_file_upload(
    v_order_open, v_file_pending, '"etag-2"', v_issued_at, v_sig
  );
  if (v_result->>'replay')::boolean is distinct from true then
    raise exception 'FAIL M: complete replay expected true';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_activity
  from public.activity_log
  where tenant_id = v_tenant_a
    and action = 'order.file_uploaded'
    and (metadata->>'file_id') = v_file_pending::text;
  if v_activity <> 1 then
    raise exception 'FAIL M: duplicate file_uploaded, got %', v_activity;
  end if;

  -- H) delete + replay
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'delete', v_staff_a, v_tenant_a, v_order_open, v_file_pending, v_issued_at
  );
  v_result := public.soft_delete_order_file(v_order_open, v_file_pending, v_issued_at, v_sig);
  if (v_result->>'replay')::boolean is distinct from false then
    raise exception 'FAIL H: first delete replay=false';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_activity
  from public.activity_log
  where tenant_id = v_tenant_a
    and action = 'order.file_deleted'
    and (metadata->>'file_id') = v_file_pending::text;
  if v_activity <> 1 then
    raise exception 'FAIL L/H: expected 1 file_deleted, got %', v_activity;
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'delete', v_staff_a, v_tenant_a, v_order_open, v_file_pending, v_issued_at
  );
  v_result := public.soft_delete_order_file(v_order_open, v_file_pending, v_issued_at, v_sig);
  if (v_result->>'replay')::boolean is distinct from true then
    raise exception 'FAIL M: delete replay expected true';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  select count(*) into v_activity
  from public.activity_log
  where tenant_id = v_tenant_a
    and action = 'order.file_deleted'
    and (metadata->>'file_id') = v_file_pending::text;
  if v_activity <> 1 then
    raise exception 'FAIL M: duplicate file_deleted, got %', v_activity;
  end if;

  -- Prepare ready file for viewer/archived/unique tests
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_a, v_order_open, v_file_ready, v_issued_at
  );
  perform public.create_order_file_upload(
    v_order_open, v_file_ready, 'ready.pdf', 'application/pdf', 2048,
    now() + interval '15 minutes', v_issued_at, v_sig
  );
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'complete', v_staff_a, v_tenant_a, v_order_open, v_file_ready, v_issued_at
  );
  perform public.complete_order_file_upload(
    v_order_open, v_file_ready, '"e"', v_issued_at, v_sig
  );

  -- I) viewer complete/delete DENIED
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'complete', v_viewer_a, v_tenant_a, v_order_open, v_file_ready, v_issued_at
  );
  v_sqlstate := null;
  begin
    perform public.complete_order_file_upload(
      v_order_open, v_file_ready, '"x"', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL I: viewer complete expected 42501 got %', v_sqlstate;
  end if;

  v_sig := pg_temp.files_signature(
    v_secret, 'delete', v_viewer_a, v_tenant_a, v_order_open, v_file_ready, v_issued_at
  );
  v_sqlstate := null;
  begin
    perform public.soft_delete_order_file(v_order_open, v_file_ready, v_issued_at, v_sig);
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL I: viewer delete expected 42501 got %', v_sqlstate;
  end if;

  -- J) archived create/complete/delete DENIED
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_a, v_order_archived, v_file_arch, v_issued_at
  );
  v_sqlstate := null; v_message := null;
  begin
    perform public.create_order_file_upload(
      v_order_archived, v_file_arch, 'a.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL J: archived create got % / %', v_sqlstate, v_message;
  end if;

  v_sig := pg_temp.files_signature(
    v_secret, 'complete', v_staff_a, v_tenant_a, v_order_archived, v_file_ready, v_issued_at
  );
  v_sqlstate := null; v_message := null;
  begin
    perform public.complete_order_file_upload(
      v_order_archived, v_file_ready, '"x"', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL J: archived complete got % / %', v_sqlstate, v_message;
  end if;

  v_sig := pg_temp.files_signature(
    v_secret, 'delete', v_staff_a, v_tenant_a, v_order_archived, v_file_ready, v_issued_at
  );
  v_sqlstate := null; v_message := null;
  begin
    perform public.soft_delete_order_file(v_order_archived, v_file_ready, v_issued_at, v_sig);
  exception when others then
    v_sqlstate := sqlstate; v_message := sqlerrm;
  end;
  if v_sqlstate is distinct from '42501' or v_message is distinct from 'order is archived' then
    raise exception 'FAIL J: archived delete got % / %', v_sqlstate, v_message;
  end if;

  -- K) cross-tenant RPC DENIED
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_owner_b, v_tenant_a, v_order_open, v_file_cross, v_issued_at
  );
  v_sqlstate := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_cross, 'x.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '42501' then
    raise exception 'FAIL K: cross-tenant create expected 42501 got %', v_sqlstate;
  end if;

  select count(*) into v_count from public.order_files where id = v_file_ready;
  if v_count <> 0 then
    raise exception 'FAIL K: cross-tenant SELECT leaked';
  end if;

  -- Unique storage_key / PK via RPC
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';
  v_issued_at := extract(epoch from now())::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_a, v_order_open, v_file_ready, v_issued_at
  );
  v_sqlstate := null;
  begin
    perform public.create_order_file_upload(
      v_order_open, v_file_ready, 'dup.pdf', 'application/pdf', 10,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
  exception when unique_violation then
    v_sqlstate := '23505';
  when others then
    v_sqlstate := sqlstate;
  end;
  if v_sqlstate is distinct from '23505' then
    raise exception 'FAIL unique storage_key expected 23505 got %', v_sqlstate;
  end if;

  select status into v_status from public.order_files where id = v_file_ready;
  if v_status is distinct from 'ready' then
    raise exception 'FAIL fixture ready status';
  end if;

  -- files_private not usable by authenticated
  begin
    perform files_private.verify_files_capability(
      'create', v_staff_a, v_tenant_a, v_order_open, v_file_cap, v_issued_at, repeat('b', 64)
    );
    raise exception 'FAIL files_private must not be executable by authenticated';
  exception when insufficient_privilege then
    null;
  when undefined_function then
    null;
  when others then
    -- schema privilege / permission denied variants
    if sqlstate not in ('42501', '42000') then
      raise exception 'FAIL files_private unexpected: % %', sqlstate, sqlerrm;
    end if;
  end;

  execute 'reset role';
  raise notice 'PASS phase17_order_files';
end;
$phase17$;

rollback;
