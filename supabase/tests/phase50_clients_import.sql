-- Migration V1 · client import (#110, ADR 2026-10-16-clients-import-v1, S1–S12).
-- Roles, tenant isolation, feature gate, idempotency, classification, explicit
-- fill_blanks without overwrite, resumable commit, races, revert, limits and
-- purge. Synthetic fixtures only; everything is rolled back.
begin;

create function pg_temp.p50_as(p_user uuid)
  returns void
  language plpgsql
as $helper$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claim.role', case when p_user is null then '' else 'authenticated' end, true);
  if p_user is not null then
    execute 'set local role authenticated';
  end if;
end;
$helper$;

create function pg_temp.p50_expect(p_sql text, p_state text, p_label text)
  returns text
  language plpgsql
as $helper$
declare
  v_state text;
  v_message text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
  end;
  if v_state is distinct from p_state then
    raise exception 'phase50 %: expected %, got % (%)', p_label, p_state, coalesce(v_state, 'success'), v_message;
  end if;
  return v_message;
end;
$helper$;

create function pg_temp.p50_check(p_ok boolean, p_label text)
  returns void
  language plpgsql
as $helper$
begin
  if p_ok is not true then
    raise exception 'phase50: %', p_label;
  end if;
end;
$helper$;

do $phase50$
declare
  tenant_a uuid := 'e5000000-0000-4000-8000-0000000000a1';
  tenant_b uuid := 'e5000000-0000-4000-8000-0000000000b1';
  tenant_c uuid := 'e5000000-0000-4000-8000-0000000000c1';  -- feature disabled
  tenant_d uuid := 'e5000000-0000-4000-8000-0000000000d1';  -- inactive tenant
  owner_a uuid := 'e5000000-0000-4000-8000-000000000001';
  admin_a uuid := 'e5000000-0000-4000-8000-000000000002';
  manager_a uuid := 'e5000000-0000-4000-8000-000000000003';
  staff_a uuid := 'e5000000-0000-4000-8000-000000000004';
  viewer_a uuid := 'e5000000-0000-4000-8000-000000000005';
  former_a uuid := 'e5000000-0000-4000-8000-000000000006';  -- inactive membership
  owner_b uuid := 'e5000000-0000-4000-8000-000000000007';
  owner_c uuid := 'e5000000-0000-4000-8000-000000000008';
  owner_d uuid := 'e5000000-0000-4000-8000-000000000009';
  outsider uuid := 'e5000000-0000-4000-8000-000000000010';
  sha_a text := pg_catalog.repeat('a', 64);
  sha_b text := pg_catalog.repeat('b', 64);
  mapping jsonb := '{"Nombre":"name","Email":"email","Teléfono":"phone"}';
  type_empresa uuid;
  e1 uuid; e2 uuid; e3 uuid; foreign_b uuid; race uuid;
  batch uuid; batch_b uuid; batch_tmp uuid;
  r jsonb;
  rows_a jsonb;
  v integer;
  n integer;
  msg text;
  c public.clients%rowtype;
  client_row1 uuid; client_row10 uuid; client_row11 uuid;
  h jsonb := '{"description":"Copias","title":"Trabajo","issue_date":"2026-10-16","currency":"EUR","prices_include_tax":false}';
  items jsonb := '[{"concept":"Copias A4","quantity":"2","unit_price":"100","discount_percent":"0","tax_rate":"21"}]';
begin
  -- Fixtures ------------------------------------------------------------------
  insert into auth.users (id, email, raw_user_meta_data) values
    (owner_a, 'owner-a@phase50.test', '{}'), (admin_a, 'admin-a@phase50.test', '{}'),
    (manager_a, 'manager-a@phase50.test', '{}'), (staff_a, 'staff-a@phase50.test', '{}'),
    (viewer_a, 'viewer-a@phase50.test', '{}'), (former_a, 'former-a@phase50.test', '{}'),
    (owner_b, 'owner-b@phase50.test', '{}'), (owner_c, 'owner-c@phase50.test', '{}'),
    (owner_d, 'owner-d@phase50.test', '{}'), (outsider, 'outsider@phase50.test', '{}');
  insert into public.profiles (id, full_name) values
    (owner_a, 'Owner A'), (admin_a, 'Admin A'), (manager_a, 'Manager A'), (staff_a, 'Staff A'),
    (viewer_a, 'Viewer A'), (former_a, 'Former A'), (owner_b, 'Owner B'), (owner_c, 'Owner C'),
    (owner_d, 'Owner D'), (outsider, 'Outsider');
  insert into public.tenants (id, name, slug, active) values
    (tenant_a, 'Phase50 A', 'phase50a', true), (tenant_b, 'Phase50 B', 'phase50b', true),
    (tenant_c, 'Phase50 C', 'phase50c', true), (tenant_d, 'Phase50 D', 'phase50d', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (tenant_a, owner_a, 'owner', true), (tenant_a, admin_a, 'admin', true),
    (tenant_a, manager_a, 'manager', true), (tenant_a, staff_a, 'staff', true),
    (tenant_a, viewer_a, 'viewer', true), (tenant_a, former_a, 'manager', false),
    (tenant_b, owner_b, 'owner', true), (tenant_c, owner_c, 'owner', true),
    (tenant_d, owner_d, 'owner', true);
  perform public.set_tenant_feature('phase50a', 'clients_import', true, null);
  perform public.set_tenant_feature('phase50b', 'clients_import', true, null);
  perform public.set_tenant_feature('phase50d', 'clients_import', true, null);
  perform public.set_tenant_feature('phase50a', 'quotes', true, null);
  perform public.seed_quote_statuses(tenant_a);
  update public.tenants set active = false where id = tenant_d;
  insert into public.customer_types (tenant_id, name, active) values (tenant_a, 'Empresa', true)
    returning id into type_empresa;

  perform pg_temp.p50_as(owner_a);
  e1 := (public.create_client_v2(null, 'Existente Uno', 'Ana', 'Uno SL', 'B12345678', 'existe@phase50.test',
         '600111222', '<p>Nota</p>', tenant_a, 'Calle 1') -> 'client' ->> 'id')::uuid;
  e2 := (public.create_client_v2(null, 'Existente Dos', null, null, null, null, '+34 600333444', null, tenant_a, null)
         -> 'client' ->> 'id')::uuid;
  e3 := (public.create_client_v2(null, 'Existente Tres', null, null, null, 'tres@phase50.test', null, null, tenant_a, null)
         -> 'client' ->> 'id')::uuid;
  perform pg_temp.p50_as(owner_b);
  foreign_b := (public.create_client_v2(null, 'Ajeno B', null, null, null, 'ajeno@phase50.test', null, null, tenant_b, null)
         -> 'client' ->> 'id')::uuid;

  -- S2/S3: authentication, roles, membership, tenant and feature gates --------
  perform pg_temp.p50_as(null);
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14)',
    tenant_a, 'Programa X', 'clientes.csv', sha_a, mapping), '28000', 'anonymous create');
  execute 'set local role service_role';
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14)',
    tenant_a, 'Programa X', 'clientes.csv', sha_a, mapping), '42501', 'service_role cannot import');
  foreach v in array array[1, 2, 3, 4] loop
    perform pg_temp.p50_as((array[staff_a, viewer_a, former_a, outsider])[v]);
    perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14)',
      tenant_a, 'Programa X', 'clientes.csv', sha_a, mapping), '42501', 'role/membership denied #' || v);
  end loop;
  perform pg_temp.p50_as(owner_c);
  msg := pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14)',
    tenant_c, 'Programa X', 'clientes.csv', sha_a, mapping), '42501', 'feature disabled');
  perform pg_temp.p50_check(msg = 'clients_import_disabled', 'feature disabled message');
  perform pg_temp.p50_as(owner_d);
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14)',
    tenant_d, 'Programa X', 'clientes.csv', sha_a, mapping), '42501', 'inactive tenant');
  perform pg_temp.p50_as(owner_b);
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14)',
    tenant_a, 'Programa X', 'clientes.csv', sha_a, mapping), '42501', 'other tenant create');

  -- S4: private schema closed, maintenance not callable by users
  perform pg_temp.p50_as(staff_a);
  perform pg_temp.p50_expect(format('update public.clients set source_record_id = %L where id = %L', 'hack', e1),
    '42501', 'staff cannot forge client origin');
  perform pg_temp.p50_as(owner_a);
  perform pg_temp.p50_expect(format('update public.clients set import_batch_id = %L where id = %L', gen_random_uuid(), e1),
    '42501', 'owner cannot link a client to a batch');
  perform pg_temp.p50_expect(format('insert into public.clients (tenant_id, name, source_system, source_record_id, created_by) values (%L, %L, %L, %L, %L)',
    tenant_a, 'Forjado', 'X', '1', owner_a), '42501', 'insert with origin refused');
  perform pg_temp.p50_expect('select count(*) from imports_private.client_import_batches', '42501', 'private schema');
  perform pg_temp.p50_expect('select public.client_import_purge_expired(10)', '42501', 'purge by authenticated');

  -- S5: input validation ----------------------------------------------------
  perform pg_temp.p50_as(manager_a);
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14)',
    tenant_a, 'Programa X', 'clientes.csv', 'nothex', mapping), '22023', 'bad sha');
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 6000000, %L, %L, 14)',
    tenant_a, 'Programa X', 'clientes.csv', sha_a, mapping), '22023', 'file too big');
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14, %L)',
    tenant_a, 'Programa X', 'clientes.csv', sha_a, mapping, 'fill_blanks'), '22023', 'fill_blanks at creation');
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 0)',
    tenant_a, 'Programa X', 'clientes.csv', sha_a, mapping), '22023', 'row count required');
  perform pg_temp.p50_expect(format('select public.client_import_create_batch(%L, %L, %L, 10, %L, %L)',
    tenant_a, 'Programa X', 'clientes.csv', sha_a, mapping), '42501', 'v1 cannot declare the row count: not executable');

  -- S6: batch idempotency ---------------------------------------------------
  r := public.client_import_create_batch_v2(tenant_a, 'Programa X', 'clientes.csv', 2048, sha_a, mapping, 14);
  batch := (r ->> 'id')::uuid;
  perform pg_temp.p50_check((r ->> 'reused')::boolean = false and r ->> 'status' = 'uploaded' and (r ->> 'expected_rows')::integer = 14, 'new batch declares 14 rows');
  r := public.client_import_create_batch_v2(tenant_a, 'Programa X', 'clientes.csv', 2048, sha_a, mapping, 14);
  perform pg_temp.p50_check((r ->> 'id')::uuid = batch and (r ->> 'reused')::boolean, 'same file + mapping reuses the batch');
  r := public.client_import_create_batch_v2(tenant_a, 'Programa X', 'clientes.csv', 2048, sha_a, '{"Nombre":"name"}', 1);
  perform pg_temp.p50_check((r ->> 'id')::uuid <> batch, 'different mapping is a different batch');
  batch_tmp := (r ->> 'id')::uuid;

  -- Staging limits
  perform pg_temp.p50_expect(format('select public.client_import_stage_rows(%L, %L)', batch,
    (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('row_number', g, 'name', 'X' || g)) from pg_catalog.generate_series(1, 501) g)),
    '22023', 'more than 500 rows per call');
  perform pg_temp.p50_expect(format('select public.client_import_stage_rows(%L, %L)', batch,
    '[{"row_number": 10001, "name": "X"}]'), '22023', 'row_number above 10000');
  perform pg_temp.p50_expect(format('select public.client_import_stage_rows(%L, %L)', batch,
    '[{"row_number": "1", "name": "X"}]'), '22023', 'row_number must be a number');

  rows_a := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('row_number', 1, 'name', 'Nuevo Uno', 'email', 'nuevo1@phase50.test', 'phone', '611000001',
      'tax_id', '12345678Z', 'customer_type', ' empresa ', 'address', 'Calle Nueva 1', 'source_record_id', 'A-1',
      'notes', '<script>alert(1)</script>' || pg_catalog.chr(13) || pg_catalog.chr(10) || 'Segunda línea & más'),
    pg_catalog.jsonb_build_object('row_number', 2, 'name', '   ', 'email', 'x@phase50.test'),
    pg_catalog.jsonb_build_object('row_number', 3, 'name', 'Email malo', 'email', 'no-es-email'),
    pg_catalog.jsonb_build_object('row_number', 4, 'name', 'Dup email', 'email', ' EXISTE@phase50.test '),
    pg_catalog.jsonb_build_object('row_number', 5, 'name', 'Dup NIF', 'tax_id', 'b-12345678'),
    pg_catalog.jsonb_build_object('row_number', 6, 'name', 'Repetido A', 'email', 'rep@phase50.test', 'source_record_id', 'A-6'),
    pg_catalog.jsonb_build_object('row_number', 7, 'name', 'Repetido B', 'email', 'REP@phase50.test'),
    pg_catalog.jsonb_build_object('row_number', 8, 'name', 'Prefijo', 'phone', '600 333 444'),
    pg_catalog.jsonb_build_object('row_number', 9, 'name', 'Rellenar', 'email', 'tres@phase50.test',
      'contact_name', 'Contacto Nuevo', 'address', 'Dirección rellenada'),
    pg_catalog.jsonb_build_object('row_number', 10, 'name', 'Ajeno', 'email', 'ajeno@phase50.test'),
    pg_catalog.jsonb_build_object('row_number', 11, 'name', 'Tipo raro', 'customer_type', 'Inexistente', 'email', 'tipo@phase50.test'),
    pg_catalog.jsonb_build_object('row_number', 12, 'name', 'Fórmula', 'notes', '=HYPERLINK("http://x";"y")', 'email', 'formula@phase50.test'),
    pg_catalog.jsonb_build_object('row_number', 13, 'name', 'Carrera', 'email', 'carrera@phase50.test'),
    pg_catalog.jsonb_build_object('row_number', 14, 'name', 'Origen repetido', 'source_record_id', 'A-1', 'email', 'otro@phase50.test')
  );
  r := public.client_import_stage_rows(batch, rows_a);
  perform pg_temp.p50_check((r ->> 'staged')::integer = 14 and (r ->> 'invalid')::integer = 2, 'stage 14 rows, 2 invalid');
  -- Re-staging the same rows is idempotent by row_number.
  r := public.client_import_stage_rows(batch, rows_a);
  perform pg_temp.p50_check((r ->> 'total_rows')::integer = 14, 're-stage keeps 14 rows');

  -- S1: another tenant cannot see or act on the batch -------------------------
  perform pg_temp.p50_as(owner_b);
  perform pg_temp.p50_expect(format('select public.client_import_stage_rows(%L, %L)', batch, rows_a), 'P0002', 'B stages A batch');
  perform pg_temp.p50_expect(format('select public.client_import_summary(%L)', batch), 'P0002', 'B reads A summary');
  perform pg_temp.p50_expect(format('select public.client_import_finalize(%L)', batch), 'P0002', 'B finalizes A batch');
  perform pg_temp.p50_expect(format('select public.client_import_report(%L)', batch), 'P0002', 'B reads A report');
  perform pg_temp.p50_expect(format('select public.client_import_list_batches(%L)', tenant_a), '42501', 'B lists A batches');
  perform pg_temp.p50_as(staff_a);
  perform pg_temp.p50_expect(format('select public.client_import_summary(%L)', batch), 'P0002', 'staff reads summary');

  -- Classification ----------------------------------------------------------
  perform pg_temp.p50_as(manager_a);
  r := public.client_import_finalize(batch);
  perform pg_temp.p50_check(r ->> 'status' = 'validated', 'finalize -> validated');
  perform pg_temp.p50_check(
    (r -> 'counts' ->> 'total')::integer = 14 and (r -> 'counts' ->> 'error')::integer = 2
    and (r -> 'counts' ->> 'duplicate_existing')::integer = 3 and (r -> 'counts' ->> 'duplicate_in_file')::integer = 2
    and (r -> 'counts' ->> 'possible_duplicate')::integer = 1 and (r -> 'counts' ->> 'valid')::integer = 6,
    'classification counts: ' || (r -> 'counts')::text);

  execute 'reset role';
  perform pg_temp.p50_check((select classification = 'duplicate_existing' and matched_client_id = e1 and match_reasons = array['email']
    from imports_private.client_import_rows where batch_id = batch and row_number = 4), 'row 4 duplicates E1 by email');
  perform pg_temp.p50_check((select matched_client_id = e1 and match_reasons = array['tax_id']
    from imports_private.client_import_rows where batch_id = batch and row_number = 5), 'row 5 duplicates E1 by NIF');
  perform pg_temp.p50_check((select classification = 'duplicate_in_file' and matched_row_number = 6
    from imports_private.client_import_rows where batch_id = batch and row_number = 7), 'row 7 repeats row 6');
  perform pg_temp.p50_check((select classification = 'duplicate_in_file' and matched_row_number = 1 and match_reasons = array['source_record']
    from imports_private.client_import_rows where batch_id = batch and row_number = 14), 'row 14 repeats origin id of row 1');
  perform pg_temp.p50_check((select classification = 'possible_duplicate' and matched_client_id = e2
    from imports_private.client_import_rows where batch_id = batch and row_number = 8), 'row 8 is a +34 possible duplicate');
  perform pg_temp.p50_check((select classification = 'valid'
    from imports_private.client_import_rows where batch_id = batch and row_number = 10), 'row 10 ignores tenant B clients');
  perform pg_temp.p50_check((select warnings = '["customer_type_not_found"]'::jsonb and classification = 'valid'
    from imports_private.client_import_rows where batch_id = batch and row_number = 11), 'row 11 unknown type is a warning');
  perform pg_temp.p50_check((select errors = '["name_required"]'::jsonb from imports_private.client_import_rows
    where batch_id = batch and row_number = 2), 'row 2 name required');
  perform pg_temp.p50_check((select errors = '["invalid_email"]'::jsonb from imports_private.client_import_rows
    where batch_id = batch and row_number = 3), 'row 3 invalid email');
  perform pg_temp.p50_check((select (normalized ->> 'customer_type_id')::uuid = type_empresa
    and normalized ->> 'notes' = '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><p>Segunda línea &amp; más</p>'
    from imports_private.client_import_rows where batch_id = batch and row_number = 1), 'row 1 type resolved and notes escaped');
  perform pg_temp.p50_check((select pg_catalog.count(*) = 6 from imports_private.client_import_rows
    where batch_id = batch and decision = 'create'), 'only valid rows default to create');

  -- Review summary: rows that need attention come first, with the matched client.
  perform pg_temp.p50_as(manager_a);
  r := public.client_import_summary(batch, 5);
  execute 'reset role';
  perform pg_temp.p50_check((select pg_catalog.array_agg((t.x ->> 'row_number')::integer order by t.i)
    from pg_catalog.jsonb_array_elements(r -> 'rows') with ordinality as t(x, i)) = array[2, 3, 4, 5, 7],
    'summary lists the rows needing attention first: ' || (r -> 'rows')::text);
  perform pg_temp.p50_check((r -> 'rows' -> 2 -> 'matched_client' ->> 'id')::uuid = e1
    and (r -> 'rows' -> 2 -> 'matched_client' ->> 'name') = 'Existente Uno', 'summary shows the matched client');

  -- Finalize by ranges gives exactly the same classification as one pass.
  create temp table p50_single as
    select row_number, classification, matched_client_id, matched_row_number, match_reasons, decision
    from imports_private.client_import_rows where batch_id = batch;
  perform pg_temp.p50_as(manager_a);
  perform pg_temp.p50_expect(format('select public.client_import_finalize(%L, 5, 4)', batch), '55000', 'validated batch restarts from row 1');
  r := public.client_import_finalize(batch, 1, 4);
  perform pg_temp.p50_check(r ->> 'status' = 'uploaded' and (r ->> 'done')::boolean = false and (r ->> 'next_row')::integer = 5, 'first range');
  r := public.client_import_finalize(batch, 5, 4);
  r := public.client_import_finalize(batch, 9, 4);
  r := public.client_import_finalize(batch, 13, 4);
  perform pg_temp.p50_check(r ->> 'status' = 'validated' and (r ->> 'done')::boolean, 'last range validates');
  execute 'reset role';
  perform pg_temp.p50_check(not exists (
    select row_number, classification, matched_client_id, matched_row_number, match_reasons, decision
    from imports_private.client_import_rows where batch_id = batch
    except select * from p50_single), 'ranges == single pass');

  -- S7: explicit fill_blanks; decisions per row ------------------------------
  perform pg_temp.p50_as(manager_a);
  perform pg_temp.p50_expect(format('select public.client_import_set_strategy(%L, %L)', batch, 'fill_blanks'), '22023', 'fill without confirm');
  perform pg_temp.p50_expect(format('select public.client_import_set_row_decisions(%L, %L, %L)', batch, '{1}', 'skip'), '22023', 'valid row decision locked');
  perform pg_temp.p50_expect(format('select public.client_import_set_row_decisions(%L, %L, %L)', batch, '{4}', 'fill_blanks'), '22023', 'fill before strategy');
  r := public.client_import_set_strategy(batch, 'fill_blanks', true);
  perform pg_temp.p50_check(r ->> 'duplicate_strategy' = 'fill_blanks', 'strategy fill_blanks confirmed');
  r := public.client_import_set_row_decisions(batch, '{8}', 'create');
  perform pg_temp.p50_check((r ->> 'changed')::integer = 1, 'possible duplicate set to create');
  v := (r ->> 'row_version')::integer;

  -- A conflicting client appears between review and commit.
  perform pg_temp.p50_as(owner_a);
  race := (public.create_client_v2(null, 'Carrera previa', null, null, null, 'carrera@phase50.test', null, null, tenant_a, null)
           -> 'client' ->> 'id')::uuid;

  -- S6: resumable commit with optimistic version
  perform pg_temp.p50_as(manager_a);
  perform pg_temp.p50_expect(format('select public.client_import_commit_chunk(%L, %s, 4)', batch, v - 1), 'GC409', 'stale version');
  n := 0;
  loop
    r := public.client_import_commit_chunk(batch, v, 4);
    n := n + 1;
    v := (r ->> 'row_version')::integer;
    exit when (r ->> 'remaining')::integer = 0;
    perform pg_temp.p50_check(r ->> 'status' = 'committing' and (r ->> 'processed')::integer = 4, 'partial chunk');
    if n > 10 then raise exception 'phase50: commit did not finish'; end if;
  end loop;
  perform pg_temp.p50_check(n = 4 and r ->> 'status' = 'committed', 'four chunks of 4 commit 14 rows');
  perform pg_temp.p50_check((r -> 'counts' ->> 'created')::integer = 6 and (r -> 'counts' ->> 'filled')::integer = 1
    and (r -> 'counts' ->> 'skipped')::integer = 7 and (r -> 'counts' ->> 'failed')::integer = 0,
    'commit results: ' || (r -> 'counts')::text);
  perform pg_temp.p50_expect(format('select public.client_import_commit_chunk(%L, %s)', batch, v), '55000', 'commit after committed');
  r := public.client_import_create_batch_v2(tenant_a, 'Programa X', 'clientes.csv', 2048, sha_a, mapping, 14);
  perform pg_temp.p50_check((r ->> 'id')::uuid = batch and r ->> 'status' = 'committed', 're-import returns the committed batch');

  execute 'reset role';
  select client_id into client_row1 from imports_private.client_import_rows where batch_id = batch and row_number = 1;
  select client_id into client_row10 from imports_private.client_import_rows where batch_id = batch and row_number = 10;
  select client_id into client_row11 from imports_private.client_import_rows where batch_id = batch and row_number = 11;
  select * into c from public.clients where id = client_row1;
  perform pg_temp.p50_check(c.tenant_id = tenant_a and c.created_by = manager_a and c.source_system = 'Programa X'
    and c.source_record_id = 'A-1' and c.import_batch_id = batch and c.customer_type_id = type_empresa
    and c.address = 'Calle Nueva 1' and c.notes like '<p>&lt;script&gt;%', 'created client carries origin, type, address and safe notes');
  perform pg_temp.p50_check((select result = 'skipped' and result_reason = 'client_duplicate' and matched_client_id = race
    from imports_private.client_import_rows where batch_id = batch and row_number = 13), 'race duplicate skipped, not overwritten');
  perform pg_temp.p50_check((select result = 'skipped' and result_reason = 'nothing_to_fill'
    from imports_private.client_import_rows where batch_id = batch and row_number = 4), 'full client: nothing to fill');
  select * into c from public.clients where id = e3;
  perform pg_temp.p50_check(c.name = 'Existente Tres' and c.email = 'tres@phase50.test'
    and c.contact_name = 'Contacto Nuevo' and c.address = 'Dirección rellenada', 'fill_blanks fills only empty fields');
  select * into c from public.clients where id = e1;
  perform pg_temp.p50_check(c.name = 'Existente Uno' and c.contact_name = 'Ana' and c.notes = '<p>Nota</p>'
    and c.customer_type_id is null, 'existing data never overwritten');
  perform pg_temp.p50_check((select pg_catalog.count(*) from public.clients where import_batch_id = batch) = 6, 'six clients linked to the batch');
  perform pg_temp.p50_check((select pg_catalog.count(*) from public.activity_log a join public.clients cl on cl.id = a.entity_id
    where cl.import_batch_id = batch and a.action = 'client.created' and a.user_id = manager_a) = 6, 'one client.created per imported client');
  perform pg_temp.p50_check((select pg_catalog.count(*) from public.activity_log
    where entity_id = e3 and action = 'client.updated') = 1, 'fill_blanks leaves a client.updated entry');
  perform pg_temp.p50_check((select pg_catalog.count(*) from public.activity_log
    where entity_id = batch and action = 'client_import.committed' and entity_type = 'client_import') = 1, 'batch summary activity');
  perform pg_temp.p50_check((select pg_catalog.count(*) from public.clients where id = foreign_b and tenant_id = tenant_b) = 1, 'tenant B untouched');

  -- Revert: in use, edited and partially edited fills are kept -----------------
  perform pg_temp.p50_as(owner_a);
  r := public.create_quote_draft_v1(tenant_a, gen_random_uuid(), client_row10, null, null, h, items, false);
  perform pg_temp.p50_check(r ? 'error' is false, 'quote draft for imported client: ' || r::text);
  perform public.update_client_v2(client_row11, null, 'Tipo raro editado', null, null, null, 'tipo@phase50.test', null, null, tenant_a, null);
  perform public.update_client_v2(e3, null, 'Existente Tres', 'Contacto Nuevo', null, null, 'tres@phase50.test', null, null, tenant_a, 'Dirección cambiada');
  execute 'reset role';
  -- Same transaction in this test: simulate that the edit happened after the commit.
  update imports_private.client_import_rows set processed_at = processed_at - interval '1 minute'
  where batch_id = batch and row_number = 11;

  perform pg_temp.p50_as(staff_a);
  perform pg_temp.p50_expect(format('select public.client_import_revert(%L)', batch), 'P0002', 'staff revert');
  perform pg_temp.p50_as(admin_a);
  -- In chunks of 2: the batch stays committed until the last chunk.
  n := 0;
  v := 0;
  loop
    r := public.client_import_revert(batch, 2);
    n := n + 1;
    v := v + pg_catalog.jsonb_array_length(r -> 'kept');
    exit when (r ->> 'remaining')::integer = 0;
    perform pg_temp.p50_check(r ->> 'status' = 'committed', 'partial revert keeps the batch committed');
    if n > 10 then raise exception 'phase50: revert did not finish'; end if;
  end loop;
  perform pg_temp.p50_check(n = 4 and r ->> 'status' = 'reverted' and (r -> 'counts' ->> 'deactivated')::integer = 4
    and (r -> 'counts' ->> 'restored')::integer = 1 and v = 2,
    'revert in 4 chunks: 4 deactivated, 1 restored, 2 kept: ' || r::text);
  perform pg_temp.p50_expect(format('select public.client_import_revert(%L)', batch), '55000', 'second revert');

  execute 'reset role';
  perform pg_temp.p50_check((select active = false from public.clients where id = client_row1), 'unused imported client deactivated');
  perform pg_temp.p50_check((select active from public.clients where id = client_row10), 'client in use kept active');
  perform pg_temp.p50_check((select active from public.clients where id = client_row11), 'edited client kept active');
  select * into c from public.clients where id = e3;
  perform pg_temp.p50_check(c.contact_name is null and c.address = 'Dirección cambiada', 'revert restores only untouched filled fields');
  perform pg_temp.p50_check((select pg_catalog.count(*) from public.clients where import_batch_id = batch) = 6, 'revert never deletes clients');
  perform pg_temp.p50_check((select pg_catalog.count(*) from public.activity_log where entity_id = batch and action = 'client_import.reverted') = 1, 'revert activity');

  -- Report and history (management only)
  perform pg_temp.p50_as(manager_a);
  r := public.client_import_report(batch, 0, 1000);
  perform pg_temp.p50_check(pg_catalog.jsonb_array_length(r -> 'rows') = 14, 'report lists every row');
  r := public.client_import_list_batches(tenant_a);
  perform pg_temp.p50_check(pg_catalog.jsonb_array_length(r) = 2, 'history lists the two A batches');

  -- Tenant B: its own batch; duplicates are per tenant; cancel ----------------
  perform pg_temp.p50_as(owner_b);
  batch_b := (public.client_import_create_batch_v2(tenant_b, 'Otro CRM', 'b.xlsx', 4096, sha_b, mapping, 1) ->> 'id')::uuid;
  perform public.client_import_stage_rows(batch_b, '[{"row_number": 1, "name": "Mismo email que A", "email": "existe@phase50.test"}]');
  r := public.client_import_finalize(batch_b);
  perform pg_temp.p50_check((r -> 'counts' ->> 'valid')::integer = 1, 'A clients do not count as duplicates in B');
  r := public.client_import_cancel(batch_b);
  perform pg_temp.p50_check(r ->> 'status' = 'cancelled', 'cancel before commit');
  perform pg_temp.p50_expect(format('select public.client_import_stage_rows(%L, %L)', batch_b,
    '[{"row_number": 1, "name": "X"}]'), '55000', 'stage on cancelled');
  perform pg_temp.p50_expect(format('select public.client_import_cancel(%L)', batch_b), '55000', 'cancel twice');
  -- At most 10 open batches per tenant (cancelled ones do not count).
  for v in 1 .. 10 loop
    perform public.client_import_create_batch_v2(tenant_b, 'Otro CRM', 'b' || v || '.csv', 10,
      pg_catalog.lpad(v::text, 64, 'f'), mapping, 1);
  end loop;
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 14)',
    tenant_b, 'Otro CRM', 'b11.csv', pg_catalog.repeat('e', 64), mapping), '54000', 'eleventh open batch');

  -- Retention: purge rows of expired batches (service_role only) ---------------
  execute 'reset role';
  update imports_private.client_import_batches set expires_at = pg_catalog.now() - interval '1 day'
  where id in (batch_b, batch_tmp);
  perform pg_temp.p50_as(null);
  execute 'set local role service_role';
  r := public.client_import_purge_expired(10);
  perform pg_temp.p50_check((r ->> 'batches')::integer = 2 and (r ->> 'rows')::integer = 1, 'purge: ' || r::text);
  execute 'reset role';
  perform pg_temp.p50_check((select status from imports_private.client_import_batches where id = batch_tmp) = 'expired', 'uploaded batch expires');
  perform pg_temp.p50_check((select status from imports_private.client_import_batches where id = batch_b) = 'cancelled', 'cancelled stays cancelled');
  perform pg_temp.p50_check(not exists (select 1 from imports_private.client_import_rows where batch_id = batch_b), 'expired rows purged');

  -- Stale statistics (Staging QA): the rows table is analyzed with an earlier
  -- batch only, so the planner estimates 1 row for the batch staged next, as in
  -- a real import. Classifying it must stay linear (500 rows used to take > 60 s).
  perform pg_temp.p50_as(owner_a);
  batch_tmp := (public.client_import_create_batch_v2(tenant_a, 'Estadísticas', 'previo.csv', 10, pg_catalog.repeat('9', 64), mapping, 500) ->> 'id')::uuid;
  perform public.client_import_stage_rows(batch_tmp, (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'row_number', g, 'name', 'Previa ' || g, 'email', 'prev' || g || '@phase50.test', 'phone', (660000000 + g)::text))
    from pg_catalog.generate_series(1, 500) g));
  execute 'reset role';
  analyze imports_private.client_import_rows;
  perform pg_temp.p50_as(owner_a);
  batch_tmp := (public.client_import_create_batch_v2(tenant_a, 'Estadísticas', 'stale.csv', 10, pg_catalog.repeat('c', 64), mapping, 1000) ->> 'id')::uuid;
  for v in 0 .. 1 loop
    perform public.client_import_stage_rows(batch_tmp, (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'row_number', g, 'name', 'Fila ' || g,
      'email', case when g % 10 = 0 then 'existe@phase50.test' else 'stale' || (g % 750) || '@phase50.test' end,
      'phone', (650000000 + g)::text, 'tax_id', 'S' || pg_catalog.lpad(g::text, 8, '0'), 'source_record_id', 'S-' || g))
      from pg_catalog.generate_series(v * 500 + 1, v * 500 + 500) g));
  end loop;
  msg := pg_catalog.clock_timestamp()::text;
  r := public.client_import_finalize(batch_tmp, 1, 2000);
  perform pg_temp.p50_check(pg_catalog.clock_timestamp() - msg::timestamptz < interval '4 seconds',
    'fresh 1000-row batch classified in ' || (pg_catalog.clock_timestamp() - msg::timestamptz)::text);
  -- 100 rows reuse E1's email; 225 repeat an earlier email of the file.
  perform pg_temp.p50_check(r ->> 'status' = 'validated' and (r -> 'counts' ->> 'valid')::integer = 675
    and (r -> 'counts' ->> 'duplicate_existing')::integer = 100 and (r -> 'counts' ->> 'duplicate_in_file')::integer = 225,
    'stale-statistics counts: ' || (r -> 'counts')::text);

  -- Audit P1 (20261016124000) -------------------------------------------------
  -- 1. Ranges out of order never validate a batch with unclassified rows.
  perform pg_temp.p50_as(owner_a);
  batch_tmp := (public.client_import_create_batch_v2(tenant_a, 'Auditoría', 'orden.csv', 10, pg_catalog.repeat('1', 64), mapping, 10) ->> 'id')::uuid;
  perform public.client_import_stage_rows(batch_tmp, (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'row_number', g, 'name', 'Orden ' || g, 'email', 'orden' || g || '@phase50.test')) from pg_catalog.generate_series(1, 10) g));
  r := public.client_import_finalize(batch_tmp, 9, 2);
  perform pg_temp.p50_check(r ->> 'status' = 'uploaded' and (r ->> 'done')::boolean = false and (r ->> 'next_row')::integer = 1,
    'last range first: not validated, next_row 1: ' || r::text);
  perform pg_temp.p50_expect(format('select public.client_import_commit_chunk(%L, %s)', batch_tmp, (r ->> 'row_version')::integer),
    '55000', 'commit refused before full classification');
  r := public.client_import_finalize(batch_tmp, 101, 10);
  perform pg_temp.p50_check(r ->> 'status' = 'uploaded' and (r ->> 'next_row')::integer = 1, 'range beyond the end: still row 1 pending');
  r := public.client_import_finalize(batch_tmp, 1, 4);
  perform pg_temp.p50_check((r ->> 'next_row')::integer = 5 and r ->> 'status' = 'uploaded', 'next_row is the first unclassified row');
  r := public.client_import_finalize(batch_tmp, 5, 4);
  perform pg_temp.p50_check(r ->> 'status' = 'validated' and (r ->> 'done')::boolean and r ->> 'next_row' is null
    and (r -> 'counts' ->> 'valid')::integer = 10, 'validated once every row is classified: ' || r::text);
  -- Nothing can be staged or replaced once classification started.
  perform pg_temp.p50_expect(format('select public.client_import_stage_rows(%L, %L)', batch_tmp,
    '[{"row_number": 3, "name": "Cambiada"}]'), '55000', 'no restaging after classification');
  -- A batch validated by an older version with an unclassified row cannot be committed.
  execute 'reset role';
  update imports_private.client_import_rows set classification = null where batch_id = batch_tmp and row_number = 3;
  perform pg_temp.p50_as(owner_a);
  v := (public.client_import_summary(batch_tmp, 1) ->> 'row_version')::integer;
  perform pg_temp.p50_expect(format('select public.client_import_commit_chunk(%L, %s)', batch_tmp, v), 'GC422', 'commit refuses unclassified rows');
  r := public.client_import_finalize(batch_tmp, 1, 2000);
  perform pg_temp.p50_check(r ->> 'status' = 'validated' and (r -> 'counts' ->> 'valid')::integer = 10, 'reclassification from row 1 repairs it');
  r := public.client_import_commit_chunk(batch_tmp, (r ->> 'row_version')::integer, 200);
  perform pg_temp.p50_check(r ->> 'status' = 'committed' and (r -> 'counts' ->> 'created')::integer = 10, 'all 10 rows created, none skipped');

  -- 2. The server knows how many rows the file has.
  batch_tmp := (public.client_import_create_batch_v2(tenant_a, 'Auditoría', 'parcial.csv', 10, pg_catalog.repeat('2', 64), mapping, 5) ->> 'id')::uuid;
  perform public.client_import_stage_rows(batch_tmp, (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'row_number', g, 'name', 'Parcial ' || g, 'email', 'parcial' || g || '@phase50.test')) from pg_catalog.generate_series(1, 3) g));
  msg := pg_temp.p50_expect(format('select public.client_import_finalize(%L)', batch_tmp), 'GC422', 'finalize refuses 3 of 5 rows');
  perform pg_temp.p50_check(msg = 'batch_incomplete', 'incomplete message');
  perform pg_temp.p50_expect(format('select public.client_import_stage_rows(%L, %L)', batch_tmp,
    '[{"row_number": 6, "name": "Sobra"}]'), '22023', 'row beyond the declared count');
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 6)',
    tenant_a, 'Auditoría', 'parcial.csv', pg_catalog.repeat('2', 64), mapping), '22023', 'same file, other row count');
  r := public.client_import_create_batch_v2(tenant_a, 'Auditoría', 'parcial.csv', 10, pg_catalog.repeat('2', 64), mapping, 5);
  perform pg_temp.p50_check((r ->> 'id')::uuid = batch_tmp and (r ->> 'reused')::boolean and (r -> 'counts' ->> 'total')::integer = 3
    and (r ->> 'expected_rows')::integer = 5, 'resumed batch shows 3 of 5 rows');
  perform public.client_import_stage_rows(batch_tmp, (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'row_number', g, 'name', 'Parcial ' || g, 'email', 'parcial' || g || '@phase50.test')) from pg_catalog.generate_series(1, 5) g));
  r := public.client_import_finalize(batch_tmp);
  perform pg_temp.p50_check(r ->> 'status' = 'validated' and (r -> 'counts' ->> 'total')::integer = 5, 'complete batch validates');
  -- A batch created before the row count existed adopts it while nothing is classified.
  execute 'reset role';
  update imports_private.client_import_batches set expected_rows = null
  where tenant_id = tenant_a and file_name = 'previo.csv';
  perform pg_temp.p50_as(owner_a);
  perform pg_temp.p50_expect(format('select public.client_import_create_batch_v2(%L, %L, %L, 10, %L, %L, 400)',
    tenant_a, 'Estadísticas', 'previo.csv', pg_catalog.repeat('9', 64), mapping), '22023', 'cannot adopt fewer rows than staged');
  r := public.client_import_create_batch_v2(tenant_a, 'Estadísticas', 'previo.csv', 10, pg_catalog.repeat('9', 64), mapping, 500);
  perform pg_temp.p50_check((r ->> 'expected_rows')::integer = 500 and (r ->> 'reused')::boolean, 'older batch adopts its row count');

  -- 3. Purging a half-committed batch keeps its history and blocks every change.
  v := (public.client_import_summary(batch_tmp, 1) ->> 'row_version')::integer;
  r := public.client_import_commit_chunk(batch_tmp, v, 2);
  perform pg_temp.p50_check(r ->> 'status' = 'committing' and (r -> 'counts' ->> 'created')::integer = 2, 'first chunk of the parcial batch');
  v := (r ->> 'row_version')::integer;
  execute 'reset role';
  update imports_private.client_import_batches set expires_at = pg_catalog.now() - interval '1 day' where id = batch_tmp;
  perform pg_temp.p50_as(null);
  execute 'set local role service_role';
  r := public.client_import_purge_expired(10);
  perform pg_temp.p50_check((r ->> 'batches')::integer = 1 and (r ->> 'rows')::integer = 5, 'half-committed batch purged: ' || r::text);
  perform pg_temp.p50_as(owner_a);
  perform pg_temp.p50_expect(format('select public.client_import_commit_chunk(%L, %s)', batch_tmp, v), '55000', 'no commit after purge');
  perform pg_temp.p50_expect(format('select public.client_import_revert(%L)', batch_tmp), '55000', 'no revert after purge');
  perform pg_temp.p50_expect(format('select public.client_import_finalize(%L)', batch_tmp), '55000', 'no finalize after purge');
  perform pg_temp.p50_expect(format('select public.client_import_cancel(%L)', batch_tmp), '55000', 'no cancel after purge');
  r := public.client_import_summary(batch_tmp, 5);
  perform pg_temp.p50_check(r ->> 'status' = 'committing' and (r ->> 'rows_purged')::boolean
    and (r -> 'counts' ->> 'created')::integer = 2 and (r -> 'counts' ->> 'total')::integer = 5,
    'purged batch keeps its counters: ' || (r -> 'counts')::text);
  execute 'reset role';
  perform imports_private.refresh_batch_counters(batch_tmp);
  perform pg_temp.p50_check((select created_count = 2 and total_rows = 5 from imports_private.client_import_batches where id = batch_tmp),
    'counters of a purged batch are never recomputed');

  -- Plan settings that keep chunks linear on fresh data (see 20261016122000).
  perform pg_temp.p50_check((select p.proconfig @> array['enable_nestloop=off'] from pg_proc p
    where p.oid = 'public.client_import_finalize(uuid, integer, integer)'::regprocedure), 'finalize avoids nested loops');
  perform pg_temp.p50_check((select p.proconfig @> array['plan_cache_mode=force_custom_plan', 'gin_pending_list_limit=64MB'] from pg_proc p
    where p.oid = 'public.client_import_commit_chunk(uuid, integer, integer)'::regprocedure), 'commit forces custom plans and defers GIN flushes');
  perform pg_temp.p50_check((select p.proconfig @> array['gin_pending_list_limit=64MB'] from pg_proc p
    where p.oid = 'public.client_import_revert(uuid, integer)'::regprocedure), 'revert defers GIN flushes');

  raise notice 'phase50 clients import PASS';
end;
$phase50$;

rollback;
