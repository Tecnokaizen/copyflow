-- Local only. SUR4 E7: work sequence (20261028130000_order_work_sequence_v1.sql).
-- Feature gate, stages catalog, replace/mark/undo, D5 executor, D6 inactive
-- people, D14 unassigned steps, D15 version, team load without double counting,
-- tenants, roles, direct writes and purge. Rollback-only.
begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase61 sequence: %', label;
  end if;
end $$;

create function pg_temp.boom(statement text, expected text, msg text default null) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected and (msg is null or sqlerrm = msg) then
      return;
    end if;
    raise exception 'phase61 sequence expected % %, got %: % (statement: %)', expected, coalesce(msg, ''), sqlstate, sqlerrm, statement;
  end;
  raise exception 'phase61 sequence unexpectedly succeeded: %', statement;
end $$;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
end $$;

create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function pg_temp.err(r jsonb) returns text language sql as $$
  select case when (r->>'ok')::boolean then 'ok' else r->>'error' end
$$;

create function pg_temp.rv(o uuid) returns bigint language sql as $$
  select row_version from public.orders where id = o
$$;

create function pg_temp.current_pos(o uuid) returns integer language sql as $$
  select position from public.order_work_steps where order_id = o and is_current
$$;

create function pg_temp.step(o uuid, p integer) returns uuid language sql as $$
  select id from public.order_work_steps where order_id = o and position = p
$$;

create function pg_temp.load(r jsonb, m uuid, field text) returns integer language sql as $$
  select (x->>field)::integer from jsonb_array_elements(r->'members') x where x->>'team_member_id' = m::text
$$;

do $$
declare
  a uuid := 'e6100000-0000-4000-8000-000000000001';    -- owner, tenant A
  mg uuid := 'e6100000-0000-4000-8000-000000000003';   -- manager, tenant A
  s uuid := 'e6100000-0000-4000-8000-000000000004';    -- staff, tenant A (Raquel)
  s2 uuid := 'e6100000-0000-4000-8000-000000000005';   -- staff, tenant A, no team member
  vw uuid := 'e6100000-0000-4000-8000-000000000006';   -- viewer, tenant A
  b uuid := 'e6100000-0000-4000-8000-000000000007';    -- owner, tenant B
  c uuid := 'e6100000-0000-4000-8000-000000000008';    -- owner, tenant C (feature off)
  gone uuid := 'e6100000-0000-4000-8000-000000000009'; -- inactive membership, tenant A
  ta uuid := 'e6100000-0000-4000-8000-000000000011';
  tb uuid := 'e6100000-0000-4000-8000-000000000012';
  tc uuid := 'e6100000-0000-4000-8000-000000000013';
  st_a uuid := 'e6100000-0000-4000-8000-000000000021';
  st_a_closed uuid := 'e6100000-0000-4000-8000-000000000022';
  st_b uuid := 'e6100000-0000-4000-8000-000000000023';
  st_c uuid := 'e6100000-0000-4000-8000-000000000024';
  m_raquel uuid := 'e6100000-0000-4000-8000-000000000031';
  m_jesus uuid := 'e6100000-0000-4000-8000-000000000032';
  m_davinia uuid := 'e6100000-0000-4000-8000-000000000033';
  m_gone uuid := 'e6100000-0000-4000-8000-000000000034';
  m_noorders uuid := 'e6100000-0000-4000-8000-000000000035';
  m_b uuid := 'e6100000-0000-4000-8000-000000000036';
  o1 uuid := 'e6100000-0000-4000-8000-000000000041';
  o_arch uuid := 'e6100000-0000-4000-8000-000000000042';
  o_b uuid := 'e6100000-0000-4000-8000-000000000043';
  o_c uuid := 'e6100000-0000-4000-8000-000000000044';
  o_x uuid := 'e6100000-0000-4000-8000-000000000045';
  o_y uuid := 'e6100000-0000-4000-8000-000000000046';
  o_z uuid := 'e6100000-0000-4000-8000-000000000047';
  o_closed uuid := 'e6100000-0000-4000-8000-000000000048';
  o_purge uuid := 'e6100000-0000-4000-8000-000000000049';
  o_plain uuid := 'e6100000-0000-4000-8000-000000000050';
  g_design uuid;
  g_prep uuid;
  g_print uuid;
  g_finish uuid;
  g_old uuid;
  g_b uuid;
  r jsonb;
  ver bigint;
  s1 uuid;
  s2_id uuid;
  s3 uuid;
  i integer;
  plain_ver bigint;
begin
  -- Fixtures (postgres).
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase61.test', '{}'), (mg, 'mg@phase61.test', '{}'), (s, 's@phase61.test', '{}'),
    (s2, 's2@phase61.test', '{}'), (vw, 'vw@phase61.test', '{}'), (b, 'b@phase61.test', '{}'),
    (c, 'c@phase61.test', '{}'), (gone, 'gone@phase61.test', '{}');
  insert into public.profiles (id, full_name) values
    (a, 'Tamara'), (mg, 'Marta'), (s, 'Raquel Cuenta'), (s2, 'Sergio'), (vw, 'Vera'),
    (b, 'Bruno'), (c, 'Carla'), (gone, 'Gonzalo');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase61 A', 'phase61a', true), (tb, 'Phase61 B', 'phase61b', true), (tc, 'Phase61 C', 'phase61c', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, mg, 'manager', true), (ta, s, 'staff', true), (ta, s2, 'staff', true),
    (ta, vw, 'viewer', true), (ta, gone, 'staff', false), (tb, b, 'owner', true), (tc, c, 'owner', true);
  insert into public.order_statuses (id, tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled) values
    (st_a, ta, 'Recibido', 'received', true, 1, true, false, false, false),
    (st_a_closed, ta, 'Entregado', 'delivered', true, 2, false, false, true, false),
    (st_b, tb, 'Recibido', 'received', true, 1, true, false, false, false),
    (st_c, tc, 'Recibido', 'received', true, 1, true, false, false, false);
  perform pg_temp.as_user(a);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders, user_id) values
    (m_raquel, ta, 'Raquel', true, true, s),
    (m_jesus, ta, 'Jesús', true, true, null),
    (m_davinia, ta, 'Davinia', true, true, null),
    (m_gone, ta, 'De baja', false, true, null),
    (m_noorders, ta, 'Sin pedidos', true, false, null);
  insert into public.orders (id, tenant_id, title, status_id, created_by, assigned_team_member_id) values
    (o1, ta, 'SUR4-0106', st_a, a, null),
    (o_arch, ta, 'Archivado con pasos', st_a_closed, a, null),
    (o_x, ta, 'Carga X', st_a, a, null),
    (o_y, ta, 'Carga Y', st_a, a, null),
    (o_z, ta, 'Carga Z', st_a, a, m_raquel),
    (o_closed, ta, 'Cerrado', st_a_closed, a, m_raquel),
    (o_purge, ta, 'Se borra', st_a, a, null),
    (o_plain, ta, 'Sin secuencia', st_a, a, m_jesus);
  perform pg_temp.as_user(b);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values (m_b, tb, 'Otro tenant', true, true);
  insert into public.orders (id, tenant_id, title, status_id, created_by) values (o_b, tb, 'Pedido B', st_b, b);
  perform pg_temp.as_user(c);
  insert into public.orders (id, tenant_id, title, status_id, created_by) values (o_c, tc, 'Pedido C', st_c, c);

  plain_ver := pg_temp.rv(o_plain);

  -- Catalog: the feature is registered with its fixed id and born off.
  perform pg_temp.as_postgres();
  perform pg_temp.ok((select id = '31000000-0000-4000-8000-000000000014' from public.features where code = 'order_work_sequence'), 'fixed id 014');
  perform pg_temp.ok(not exists (
    select 1 from public.plan_features pf join public.features f on f.id = pf.feature_id where f.code = 'order_work_sequence'
  ), 'no plan includes order_work_sequence');
  perform pg_temp.ok(not public.tenant_has_feature(ta, 'order_work_sequence'), 'born off for every tenant');

  -- Privileges (T6, T8).
  perform pg_temp.ok(not has_table_privilege('anon', 'public.order_work_steps', 'select'), 'anon cannot read steps');
  perform pg_temp.ok(not has_table_privilege('anon', 'public.work_stages', 'select'), 'anon cannot read stages');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.order_work_steps', 'insert'), 'authenticated cannot insert steps');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.order_work_steps', 'update'), 'authenticated cannot update steps');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.work_stages', 'insert'), 'authenticated cannot insert stages');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.work_stages', 'delete'), 'authenticated cannot delete stages');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.replace_order_work_steps_v1(uuid,text,jsonb)', 'execute'), 'anon cannot replace steps');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.team_work_load_v1(uuid)', 'execute'), 'anon cannot read the load');
  perform pg_temp.ok(not has_function_privilege('service_role', 'public.set_order_work_step_done_v1(uuid,boolean,uuid)', 'execute'), 'service_role does not mark steps');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.order_work_steps_recompute_current_v1(uuid,uuid)', 'execute'), 'helpers stay internal');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.order_work_steps_input_v1(jsonb)', 'execute'), 'input helper stays internal');

  -- Feature off: every RPC answers not_found, nothing is created (D16 with A1).
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'Diseño', 'design')) = 'not_found', 'feature off: no stages');
  perform pg_temp.ok(pg_temp.err(public.create_suggested_work_stages_v1(ta)) = 'not_found', 'feature off: no suggested stages');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o1, pg_temp.rv(o1)::text, '[]')) = 'not_found', 'feature off: no steps');
  perform pg_temp.ok(pg_temp.err(public.team_work_load_v1(ta)) = 'not_found', 'feature off: no load');
  reset role;

  perform public.set_tenant_feature('phase61a', 'order_work_sequence', true, null);
  perform public.set_tenant_feature('phase61b', 'order_work_sequence', true, null);

  -- Stages: owner, admin and manager; staff and viewer cannot.
  perform pg_temp.as_user(s);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'Diseño', 'design')) = 'forbidden', 'staff cannot create stages');
  perform pg_temp.ok(pg_temp.err(public.create_suggested_work_stages_v1(ta)) = 'forbidden', 'staff cannot create suggested stages');
  reset role;
  perform pg_temp.as_user(vw);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'Diseño', 'design')) = 'forbidden', 'viewer cannot create stages');
  reset role;

  perform pg_temp.as_user(mg);
  set local role authenticated;
  r := public.upsert_work_stage_v1(ta, null, '  Diseño   gráfico ', 'design');
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and r->'stage'->>'name' = 'Diseño gráfico', 'manager creates a stage, spaces collapsed: ' || r::text);
  g_design := (r->'stage'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'diseño GRÁFICO', 'design')) = 'duplicate_name', 'names are unique without case');
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, '   ', 'design')) = 'invalid_name', 'blank name');
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, repeat('x', 41), 'design')) = 'invalid_name', 'name over 40');
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'Corte', '✂️')) = 'invalid_icon', 'icons come from a closed set, never emoji');
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'Corte', 'cut', true, 5000)) = 'invalid_sort_order', 'sort order range');
  r := public.upsert_work_stage_v1(ta, g_design, 'Diseño', 'design');
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean, 'rename a stage');
  r := public.upsert_work_stage_v1(ta, g_design, 'Diseño', 'design');
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not (r->>'changed')::boolean, 'same values write nothing');
  r := public.create_suggested_work_stages_v1(ta);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'created')::integer = 3, 'suggested stages skip the existing Diseño: ' || r::text);
  r := public.create_suggested_work_stages_v1(ta);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'created')::integer = 0 and not (r->>'changed')::boolean, 'suggested stages are idempotent');
  select id into g_prep from public.work_stages where tenant_id = ta and name = 'Preparación';
  select id into g_print from public.work_stages where tenant_id = ta and name = 'Impresión';
  select id into g_finish from public.work_stages where tenant_id = ta and name = 'Acabado';
  perform pg_temp.ok(g_prep is not null and g_print is not null and g_finish is not null, 'manager reads the stages');
  perform pg_temp.ok((select icon = 'print' from public.work_stages where id = g_print), 'suggested icons');
  r := public.upsert_work_stage_v1(ta, null, 'Antigua', 'other');
  g_old := (r->'stage'->>'id')::uuid;
  reset role;

  perform pg_temp.as_user(b);
  set local role authenticated;
  perform pg_temp.ok((select count(*) = 0 from public.work_stages where tenant_id = ta), 'T1: other tenant reads no stages');
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(tb, g_design, 'Robada', 'design')) = 'not_found', 'T2: stage of another tenant');
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'Intrusa', 'design')) = 'not_found', 'T2: catalog of another tenant');
  r := public.upsert_work_stage_v1(tb, null, 'Diseño', 'design');
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'each tenant has its own names');
  g_b := (r->'stage'->>'id')::uuid;
  reset role;

  -- Stages are never deleted and never written directly.
  perform pg_temp.boom(format('delete from public.work_stages where id = %L', g_old), '42501', 'work_stages_deactivate_only');
  perform pg_temp.boom(format('update public.work_stages set name = %L where id = %L', 'X', g_old), '42501', 'work_stages_rpc_only');
  perform pg_temp.boom(format('insert into public.work_stages (tenant_id, name) values (%L, %L)', ta, 'X'), '42501', 'work_stages_rpc_only');
  perform pg_temp.boom('truncate public.work_stages cascade', '42501');
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform pg_temp.boom(format('insert into public.work_stages (tenant_id, name) values (%L, %L)', ta, 'X'), '42501');
  perform pg_temp.boom(format('update public.work_stages set active = false where id = %L', g_old), '42501');

  -- 30 stages at most per tenant.
  for i in 1..25 loop
    perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'Fase ' || i, 'other')) = 'ok', 'stage ' || i);
  end loop;
  perform pg_temp.ok((select count(*) = 30 from public.work_stages where tenant_id = ta), '30 stages');
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, null, 'Fase 26', 'other')) = 'too_many_stages', 'stage limit');

  -- Replace: SUR4-0106, Diseño (Jesús) → Preparación (Raquel) → Impresión (sin asignar, D14).
  reset role;
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o1);
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('stage_id', g_design, 'team_member_id', m_jesus),
    jsonb_build_object('stage_id', g_prep, 'team_member_id', m_raquel),
    jsonb_build_object('stage_id', g_print, 'team_member_id', null)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean, 'staff creates a sequence: ' || r::text);
  perform pg_temp.ok(pg_temp.rv(o1) = ver + 1 and (r->>'row_version')::bigint = ver + 1, 'D15: one version bump');
  perform pg_temp.ok(jsonb_array_length(r->'steps') = 3, 'three steps returned');
  perform pg_temp.ok(pg_temp.current_pos(o1) = 1, 'le toca: first step');
  s1 := pg_temp.step(o1, 1); s2_id := pg_temp.step(o1, 2); s3 := pg_temp.step(o1, 3);
  perform pg_temp.ok((select team_member_id is null from public.order_work_steps where id = s3), 'D14: a pending step may stay unassigned');
  perform pg_temp.ok((select assigned_team_member_id is null from public.orders where id = o1), 'the responsible person does not change');
  reset role;
  perform pg_temp.ok((
    select count(*) = 1
    from public.activity_log
    where entity_id = o1 and action = 'order.work_steps_changed'
      and metadata->>'field' = 'work_steps'
      and new_values->'steps'->0->>'team_member_name' = 'Jesús'
      and new_values->'steps'->1->>'stage_name' = 'Preparación'
      and previous_values->'steps' = '[]'::jsonb
  ), 'activity keeps stages and names of that moment');
  perform pg_temp.ok(not exists (
    select 1 from public.activity_log where entity_id = o1 and action not like 'order.work_step%' and action <> 'order.created'
  ), 'the version bump logs nothing else');

  perform pg_temp.as_user(s);
  set local role authenticated;
  -- Same sequence again: nothing written, no version.
  ver := pg_temp.rv(o1);
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_jesus),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_raquel),
    jsonb_build_object('id', s3, 'stage_id', g_print)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not (r->>'changed')::boolean and pg_temp.rv(o1) = ver, 'identical sequence writes nothing');

  -- Validation.
  r := public.replace_order_work_steps_v1(o1, (ver - 1)::text, '[]');
  perform pg_temp.ok(pg_temp.err(r) = 'conflict' and (r->>'row_version')::bigint = ver, 'stale version: conflict with the current one');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o1, 'x', '[]')) = 'conflict', 'malformed version');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o1, ver::text, '{}')) = 'invalid_steps', 'not an array');
  r := public.replace_order_work_steps_v1(o1, ver::text, '[1]');
  perform pg_temp.ok(pg_temp.err(r) = 'invalid_steps' and r->>'field' = 'step' and (r->>'index')::integer = 0, 'not an object');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(jsonb_build_object('team_member_id', m_jesus)));
  perform pg_temp.ok(r->>'field' = 'stage_id', 'stage required');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(jsonb_build_object('stage_id', g_design, 'team_member_id', 'nadie')));
  perform pg_temp.ok(r->>'field' = 'team_member_id', 'malformed person');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(jsonb_build_object('stage_id', g_design, 'note', 'x')));
  perform pg_temp.ok(r->>'field' = 'step', 'unknown keys are refused');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('stage_id', g_design), jsonb_build_object('id', gen_random_uuid(), 'stage_id', g_design)
  ));
  perform pg_temp.ok(r->>'field' = 'id' and (r->>'index')::integer = 1, 'foreign step id');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s1, 'stage_id', g_design), jsonb_build_object('id', s1, 'stage_id', g_design)
  ));
  perform pg_temp.ok(r->>'field' = 'id', 'duplicate step id');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(jsonb_build_object('stage_id', g_b)));
  perform pg_temp.ok(r->>'field' = 'stage_id', 'T3: stage of another tenant');
  r := public.replace_order_work_steps_v1(o1, ver::text, (select jsonb_agg(jsonb_build_object('stage_id', g_design)) from generate_series(1, 11)));
  perform pg_temp.ok(pg_temp.err(r) = 'too_many_steps', 'at most 10 steps');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(jsonb_build_object('stage_id', g_design, 'team_member_id', m_gone)));
  perform pg_temp.ok(pg_temp.err(r) = 'member_unassignable' and (r->>'index')::integer = 0, 'R6: inactive person');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(jsonb_build_object('stage_id', g_design, 'team_member_id', m_noorders)));
  perform pg_temp.ok(pg_temp.err(r) = 'member_unassignable', 'R6: person who cannot receive orders');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(jsonb_build_object('stage_id', g_design, 'team_member_id', m_b)));
  perform pg_temp.ok(pg_temp.err(r) = 'member_unassignable', 'T3: person of another tenant');
  perform pg_temp.ok(pg_temp.rv(o1) = ver and (select count(*) = 3 from public.order_work_steps where order_id = o1), 'failed replaces change nothing');
  reset role;

  -- Mark done (D5): default executor is the assigned person; the account is the caller.
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o1);
  r := public.set_order_work_step_done_v1(s1, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean, 'mark step 1: ' || r::text);
  perform pg_temp.ok(r->'step'->>'executed_by_team_member_id' = m_jesus::text, 'D5: executor defaults to the assigned person');
  perform pg_temp.ok(r->'step'->>'completed_by' = s::text and r->'step'->>'completed_by_name' = 'Raquel', 'D5: marking account and its name');
  perform pg_temp.ok(pg_temp.rv(o1) = ver + 1, 'marking bumps the version once');
  perform pg_temp.ok(pg_temp.current_pos(o1) = 2, 'le toca: Preparación');
  r := public.set_order_work_step_done_v1(s1, true, m_davinia);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not (r->>'changed')::boolean and pg_temp.rv(o1) = ver + 1, 'marking again writes nothing');
  perform pg_temp.ok((select executed_by_team_member_id = m_jesus from public.order_work_steps where id = s1), 'the first executor is kept');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s3, true)) = 'step_unassigned', 'D14: unassigned step cannot be done');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s3, null)) = 'invalid_action', 'done flag required');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s2_id, true, m_gone)) = 'member_unassignable', 'executor must be eligible');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s2_id, true, m_b)) = 'member_unassignable', 'T3: executor of another tenant');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(gen_random_uuid(), true)) = 'not_found', 'unknown step');
  reset role;

  -- Mark someone else's step, choosing who did it (staff without a team member).
  perform pg_temp.as_user(s2);
  set local role authenticated;
  r := public.set_order_work_step_done_v1(s2_id, true, m_davinia);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and r->'step'->>'executed_by_team_member_id' = m_davinia::text, 'D5: done by Davinia, marked by Sergio');
  perform pg_temp.ok(r->'step'->>'completed_by_name' = 'Sergio', 'an account without a team member uses its profile name');
  perform pg_temp.ok((select team_member_id = m_raquel from public.order_work_steps where id = s2_id), 'D5: the assignment is kept');
  perform pg_temp.ok(pg_temp.current_pos(o1) = 3, 'le toca: Impresión, unassigned');
  reset role;
  perform pg_temp.ok((
    select count(*) = 1 from public.activity_log
    where entity_id = o1 and action = 'order.work_step_completed'
      and new_values->>'executed_by_name' = 'Davinia'
      and new_values->>'team_member_name' = 'Raquel'
      and new_values->>'completed_by_name' = 'Sergio'
  ), 'activity: assigned, executor and marking account');

  -- Out of order: assign and finish step 3, then undo step 1: le toca returns to 1.
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o1);
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_jesus),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_raquel),
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_davinia)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean, 'assign the pending step');
  perform pg_temp.ok((select completed_at is not null and executed_by_team_member_id = m_jesus from public.order_work_steps where id = s1), 'done steps survive a replace');
  r := public.set_order_work_step_done_v1(s3, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and pg_temp.current_pos(o1) is null, 'sequence complete: nobody has the turn');
  ver := pg_temp.rv(o1);
  r := public.set_order_work_step_done_v1(s1, false);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean and pg_temp.rv(o1) = ver + 1, 'undo step 1');
  perform pg_temp.ok((select completed_at is null and executed_by_team_member_id is null and completed_by is null and team_member_id = m_jesus from public.order_work_steps where id = s1), 'undo clears the marks and keeps the person');
  perform pg_temp.ok(pg_temp.current_pos(o1) = 1, 'out of order: le toca is the first step not done');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s1, false)) = 'ok', 'undo again is a no-op');
  reset role;
  perform pg_temp.ok((
    select count(*) = 1 from public.activity_log
    where entity_id = o1 and action = 'order.work_step_reopened'
      and previous_values->>'executed_by_name' = 'Jesús'
      and previous_values->>'completed_by_name' = 'Raquel'
  ), 'reopen keeps the previous executor and account in the activity');

  -- Done steps: cannot be removed or change stage or person; may move.
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o1);
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_jesus)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'step_done' and r->>'step_id' = s2_id::text, 'a done step cannot be removed');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_jesus),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_jesus),
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_davinia)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'step_done' and (r->>'index')::integer = 1, 'a done step keeps its person');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_jesus),
    jsonb_build_object('id', s2_id, 'stage_id', g_finish, 'team_member_id', m_raquel),
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_davinia)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'step_done', 'a done step keeps its stage');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_davinia),
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_jesus),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_raquel),
    jsonb_build_object('stage_id', g_finish, 'team_member_id', m_raquel)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'reorder with done steps and add one: ' || r::text);
  perform pg_temp.ok(pg_temp.step(o1, 1) = s3 and pg_temp.step(o1, 2) = s1 and pg_temp.step(o1, 3) = s2_id, 'positions swapped');
  perform pg_temp.ok(pg_temp.current_pos(o1) = 2, 'le toca follows the new order');
  reset role;

  -- D6: deactivate people. Done steps stay; a pending step needs reassigning.
  perform pg_temp.as_user(a);
  update public.team_members set active = false where id in (m_davinia, m_jesus);
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o1);
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_davinia),
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_jesus),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_raquel)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'D6: unchanged steps of inactive people are kept: ' || r::text);
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s1, true)) = 'member_unassignable', 'D6: pending step of an inactive person cannot be done');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s3, false)) = 'ok', 'D6: undo a step of an inactive executor');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s3, true)) = 'member_unassignable', 'D6: redo needs an eligible person');
  ver := pg_temp.rv(o1);
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_raquel),
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_raquel),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_raquel)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'reassign the pending steps');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s1, true)) = 'ok', 'reassigned step can be done');
  reset role;
  perform pg_temp.as_user(a);
  update public.team_members set active = true where id in (m_davinia, m_jesus);

  -- An inactive stage cannot go on a new step, but kept steps keep theirs.
  perform pg_temp.as_user(mg);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(ta, g_prep, 'Preparación', 'prepare', false)) = 'ok', 'deactivate a stage');
  reset role;
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o1);
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_raquel),
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_raquel),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_raquel),
    jsonb_build_object('stage_id', g_prep, 'team_member_id', m_raquel)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'stage_inactive' and (r->>'index')::integer = 3, 'inactive stage on a new step');
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_raquel),
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_raquel),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_raquel),
    jsonb_build_object('stage_id', g_finish, 'team_member_id', m_jesus)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'kept step with an inactive stage is fine');
  -- Empty the pending tail and keep the rest.
  ver := pg_temp.rv(o1);
  r := public.replace_order_work_steps_v1(o1, ver::text, jsonb_build_array(
    jsonb_build_object('id', s3, 'stage_id', g_print, 'team_member_id', m_raquel),
    jsonb_build_object('id', s1, 'stage_id', g_design, 'team_member_id', m_raquel),
    jsonb_build_object('id', s2_id, 'stage_id', g_prep, 'team_member_id', m_raquel)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (select count(*) = 3 from public.order_work_steps where order_id = o1), 'remove a pending step');
  reset role;

  -- Viewer reads; cannot write. Inactive membership and other tenants see nothing.
  perform pg_temp.as_user(vw);
  set local role authenticated;
  perform pg_temp.ok((select count(*) = 3 from public.order_work_steps where order_id = o1), 'viewer reads the steps');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o1, pg_temp.rv(o1)::text, '[]')) = 'forbidden', 'viewer cannot replace');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s2_id, false)) = 'forbidden', 'viewer cannot mark');
  perform pg_temp.ok(pg_temp.err(public.team_work_load_v1(ta)) = 'ok', 'viewer reads the load');
  reset role;
  perform pg_temp.as_user(gone);
  set local role authenticated;
  perform pg_temp.ok((select count(*) = 0 from public.order_work_steps), 'T7: inactive membership reads nothing');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s2_id, false)) = 'not_found', 'T7: inactive membership cannot mark');
  reset role;
  perform pg_temp.as_user(b);
  set local role authenticated;
  perform pg_temp.ok((select count(*) = 0 from public.order_work_steps where tenant_id = ta), 'T1: other tenant reads no steps');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o1, pg_temp.rv(o1)::text, '[]')) = 'not_found', 'T2: replace across tenants');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s2_id, false)) = 'not_found', 'T2: mark across tenants');
  perform pg_temp.ok(pg_temp.err(public.team_work_load_v1(ta)) = 'not_found', 'T2: load across tenants');
  reset role;
  perform pg_temp.as_user(c);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_c, pg_temp.rv(o_c)::text, '[]')) = 'not_found', 'tenant without the feature');
  reset role;

  -- Direct writes are refused, also for postgres without the marker.
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform pg_temp.boom(format('update public.order_work_steps set is_current = false where order_id = %L', o1), '42501');
  perform pg_temp.boom(format('delete from public.order_work_steps where order_id = %L', o1), '42501');
  reset role;
  perform pg_temp.boom(format('update public.order_work_steps set is_current = false where order_id = %L', o1), '42501', 'order_work_steps_rpc_only');
  perform pg_temp.boom(format('delete from public.order_work_steps where id = %L', s3), '42501', 'order_work_steps_rpc_only');
  perform pg_temp.boom(
    format('insert into public.order_work_steps (tenant_id, order_id, position, stage_id, created_by) values (%L, %L, 9, %L, %L)', ta, o1, g_design, a),
    '42501', 'order_work_steps_rpc_only'
  );
  -- TRUNCATE of the steps is checked in the .sh suite: the deferred position
  -- constraint leaves pending trigger events inside this transaction.
  -- Even with the marker, the row guard keeps done steps and R6.
  perform set_config('gestcopy.order_work_steps_write', '1', true);
  perform pg_temp.ok((select completed_at is not null from public.order_work_steps where id = s1) and (select completed_at is null from public.order_work_steps where id = s3), 'fixture: s1 done, s3 pending');
  perform pg_temp.boom(format('delete from public.order_work_steps where id = %L', s1), '55000', 'step_done');
  perform pg_temp.boom(format('update public.order_work_steps set team_member_id = %L where id = %L', m_jesus, s1), '55000', 'step_done');
  perform pg_temp.boom(format('update public.order_work_steps set team_member_id = %L where id = %L', m_gone, s3), '23514', 'member_unassignable');
  perform pg_temp.boom(format('update public.order_work_steps set order_id = %L where id = %L', o_x, s3), '55000', 'immutable_identity');
  perform pg_temp.boom(format('update public.order_work_steps set completed_at = now() where id = %L', s3), '23514');
  perform set_config('gestcopy.order_work_steps_write', '', true);
  perform pg_temp.ok((select count(*) <= 1 from public.order_work_steps where order_id = o1 and is_current), 'one current step at most');

  -- Archived: read-only.
  perform pg_temp.as_user(a);
  set local role authenticated;
  r := public.replace_order_work_steps_v1(o_arch, pg_temp.rv(o_arch)::text, jsonb_build_array(
    jsonb_build_object('stage_id', g_design, 'team_member_id', m_raquel)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'steps on a delivered order');
  perform public.archive_order(o_arch, ta);
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_arch, pg_temp.rv(o_arch)::text, '[]')) = 'order_archived', 'archived: no replace');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(pg_temp.step(o_arch, 1), true)) = 'order_archived', 'archived: no mark');
  reset role;

  -- Load (R9): count(distinct order), separate columns, no amounts.
  perform pg_temp.as_user(a);
  set local role authenticated;
  -- X: Raquel (le toca) → Davinia → Raquel. Y: Raquel (hecho) → Davinia (le toca).
  -- Z: Raquel responsible, no steps. Closed: Raquel responsible and le toca (not counted).
  r := public.replace_order_work_steps_v1(o_x, pg_temp.rv(o_x)::text, jsonb_build_array(
    jsonb_build_object('stage_id', g_design, 'team_member_id', m_raquel),
    jsonb_build_object('stage_id', g_print, 'team_member_id', m_davinia),
    jsonb_build_object('stage_id', g_finish, 'team_member_id', m_raquel)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'load fixture X');
  r := public.replace_order_work_steps_v1(o_y, pg_temp.rv(o_y)::text, jsonb_build_array(
    jsonb_build_object('stage_id', g_design, 'team_member_id', m_raquel),
    jsonb_build_object('stage_id', g_print, 'team_member_id', m_davinia),
    jsonb_build_object('stage_id', g_finish)
  ));
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(pg_temp.step(o_y, 1), true)) = 'ok', 'load fixture Y');
  r := public.replace_order_work_steps_v1(o_closed, pg_temp.rv(o_closed)::text, jsonb_build_array(
    jsonb_build_object('stage_id', g_design, 'team_member_id', m_raquel)
  ));
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'load fixture closed');
  r := public.team_work_load_v1(ta);
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'load: ' || r::text);
  -- o1 (all Raquel, le toca s2 → Raquel) adds one current for Raquel.
  perform pg_temp.ok(pg_temp.load(r, m_raquel, 'responsible') = 1, 'responsible counts operational orders only (Z)');
  perform pg_temp.ok(pg_temp.load(r, m_raquel, 'current') = 2, 'Raquel le toca: X and SUR4-0106, once each');
  perform pg_temp.ok(pg_temp.load(r, m_raquel, 'upcoming') = 0, 'a later step of an order already current is not counted again');
  perform pg_temp.ok(pg_temp.load(r, m_davinia, 'current') = 1 and pg_temp.load(r, m_davinia, 'upcoming') = 1, 'Davinia: Y now, X later');
  perform pg_temp.ok(pg_temp.load(r, m_jesus, 'responsible') = 1 and pg_temp.load(r, m_jesus, 'current') = 0, 'Jesús: responsible of the plain order only');
  perform pg_temp.ok(pg_temp.load(r, m_gone, 'current') is null, 'inactive people are not listed');
  perform pg_temp.ok((r->>'current_unassigned')::integer = 0, 'no current step unassigned');
  perform pg_temp.ok((r->>'operational_total')::integer = 6, 'team total counted apart: ' || (r->>'operational_total'));
  perform pg_temp.ok(r::text !~ 'amount|total_amount|paid', 'the load carries no amounts');
  reset role;

  -- Feature withdrawn with data inside: hidden, kept, back when granted again.
  perform public.set_tenant_feature('phase61a', 'order_work_sequence', false, null);
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform pg_temp.ok((select count(*) = 0 from public.order_work_steps), 'withdrawn: steps hidden');
  perform pg_temp.ok((select count(*) = 0 from public.work_stages), 'withdrawn: stages hidden');
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(s2_id, false)) = 'not_found', 'withdrawn: no writes');
  reset role;
  perform pg_temp.ok((select count(*) > 0 from public.order_work_steps where tenant_id = ta), 'withdrawn: data kept');
  perform public.set_tenant_feature('phase61a', 'order_work_sequence', true, null);
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform pg_temp.ok((select count(*) = 3 from public.order_work_steps where order_id = o1), 'granted again: steps back');
  reset role;

  -- Orders without a sequence are untouched.
  perform pg_temp.ok(pg_temp.rv(o_plain) = plain_ver, 'orders without steps keep their version');

  -- Purge: deleting an order removes its steps (postgres, like the tenant removal).
  perform pg_temp.as_user(a);
  set local role authenticated;
  r := public.replace_order_work_steps_v1(o_purge, pg_temp.rv(o_purge)::text, jsonb_build_array(
    jsonb_build_object('stage_id', g_design, 'team_member_id', m_raquel)
  ));
  perform public.set_order_work_step_done_v1(pg_temp.step(o_purge, 1), true);
  reset role;
  delete from public.orders where id = o_purge;
  perform pg_temp.ok(not exists (select 1 from public.order_work_steps where order_id = o_purge), 'purge removes done and pending steps');

  raise notice 'phase61 order work sequence PASS';
end $$;

rollback;
