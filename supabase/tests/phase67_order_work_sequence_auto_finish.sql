-- Local only. Addendum 02: automatic finish of orders with a work sequence
-- (20261104130000_order_work_sequence_auto_finish_v1.sql). Rollback-only.
--
-- Covers: no sequence; pending steps; last step -> the tenant's is_ready status
-- by flag (another name and code per tenant, inactive ready ignored); already
-- ready (no duplicate); delivered, cancelled and archived untouched; 0 and 2
-- active ready statuses; D-B undo keeps the status and warns; D-C replace never
-- finishes; one version bump; only status_id/ready_at change; one audited
-- status_changed row marked automatic; tenants and roles; views after it.
begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase67 auto finish: %', label;
  end if;
end $$;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
end $$;

create function pg_temp.err(r jsonb) returns text language sql as $$
  select case when (r->>'ok')::boolean then 'ok' else r->>'error' end
$$;

create function pg_temp.rv(o uuid) returns bigint language sql as $$
  select row_version from public.orders where id = o
$$;

create function pg_temp.status_code(p_order uuid) returns text language sql as $$
  select st.code from public.orders o join public.order_statuses st on st.tenant_id = o.tenant_id and st.id = o.status_id where o.id = p_order
$$;

create function pg_temp.step(o uuid, p integer) returns uuid language sql as $$
  select id from public.order_work_steps where order_id = o and position = p
$$;

create function pg_temp.status_events(o uuid) returns bigint language sql as $$
  select count(*) from public.activity_log where entity_id = o and action = 'order.status_changed'
$$;

-- Some order.work_step_completed row of the order has metadata.auto_finish.<field> = <val>
-- (any auto_finish when field is null). Rows of one transaction share created_at.
create function pg_temp.finish(o uuid, field text, val text) returns boolean language sql as $$
  select exists (
    select 1 from public.activity_log
    where entity_id = o and action = 'order.work_step_completed' and metadata ? 'auto_finish'
      and (field is null or metadata->'auto_finish'->>field = val)
  )
$$;

-- The order row without the columns the automatic finish may change.
create function pg_temp.frozen(o uuid) returns jsonb language sql as $$
  select to_jsonb(x) - array['status_id', 'ready_at', 'updated_at', 'row_version']
  from public.orders x where x.id = o
$$;

do $$
declare
  a uuid := 'e6700000-0000-4000-8000-000000000001';   -- owner, tenant A
  s uuid := 'e6700000-0000-4000-8000-000000000002';   -- staff, tenant A
  vw uuid := 'e6700000-0000-4000-8000-000000000003';  -- viewer, tenant A
  b uuid := 'e6700000-0000-4000-8000-000000000004';   -- owner, tenant B
  c uuid := 'e6700000-0000-4000-8000-000000000005';   -- owner, tenant C (two ready)
  d uuid := 'e6700000-0000-4000-8000-000000000006';   -- owner, tenant D (no ready)
  ta uuid := 'e6700000-0000-4000-8000-000000000011';
  tb uuid := 'e6700000-0000-4000-8000-000000000012';
  tc uuid := 'e6700000-0000-4000-8000-000000000013';
  td uuid := 'e6700000-0000-4000-8000-000000000014';
  m_a uuid := 'e6700000-0000-4000-8000-000000000031';
  m_b uuid := 'e6700000-0000-4000-8000-000000000032';
  m_c uuid := 'e6700000-0000-4000-8000-000000000033';
  m_d uuid := 'e6700000-0000-4000-8000-000000000034';
  o1 uuid := 'e6700000-0000-4000-8000-000000000041';       -- two steps, received
  o_plain uuid := 'e6700000-0000-4000-8000-000000000042';  -- no sequence
  o_ready uuid := 'e6700000-0000-4000-8000-000000000043';  -- already ready
  o_closed uuid := 'e6700000-0000-4000-8000-000000000044'; -- delivered
  o_cancel uuid := 'e6700000-0000-4000-8000-000000000045'; -- cancelled
  o_arch uuid := 'e6700000-0000-4000-8000-000000000046';   -- archived
  o_repl uuid := 'e6700000-0000-4000-8000-000000000047';   -- D-C
  o_prog uuid := 'e6700000-0000-4000-8000-000000000048';   -- in progress, staff finishes
  o_b uuid := 'e6700000-0000-4000-8000-000000000049';
  o_c uuid := 'e6700000-0000-4000-8000-000000000050';
  o_d uuid := 'e6700000-0000-4000-8000-000000000051';
  st_a_ready uuid;
  st_b_final uuid;
  g_a uuid; g_b uuid; g_c uuid; g_d uuid;
  r jsonb;
  ver bigint;
  before jsonb;
  ready_at_1 timestamptz;
  s1 uuid; s2 uuid;
begin
  -- Fixtures (postgres).
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase67.test', '{}'), (s, 's@phase67.test', '{}'), (vw, 'vw@phase67.test', '{}'),
    (b, 'b@phase67.test', '{}'), (c, 'c@phase67.test', '{}'), (d, 'd@phase67.test', '{}');
  insert into public.profiles (id, full_name) values
    (a, 'Tamara'), (s, 'Raquel'), (vw, 'Vera'), (b, 'Bruno'), (c, 'Carla'), (d, 'Dani');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase67 A', 'phase67a', true), (tb, 'Phase67 B', 'phase67b', true),
    (tc, 'Phase67 C', 'phase67c', true), (td, 'Phase67 D', 'phase67d', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, s, 'staff', true), (ta, vw, 'viewer', true),
    (tb, b, 'owner', true), (tc, c, 'owner', true), (td, d, 'owner', true);
  insert into public.order_statuses (tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled) values
    (ta, 'Recibido', 'received', true, 1, true, false, false, false),
    (ta, 'En proceso', 'in_progress', true, 2, false, false, false, false),
    (ta, 'Listo', 'ready', true, 3, false, true, false, false),
    (ta, 'Entregado', 'closed', true, 4, false, false, true, false),
    (ta, 'Cancelado', 'cancelled', true, 5, false, false, false, true),
    -- B: another name and code for the final status, plus an inactive ready one.
    (tb, 'Entrada', 'entrada', true, 1, true, false, false, false),
    (tb, 'Listo antiguo', 'ready', false, 2, false, true, false, false),
    (tb, 'Terminado', 'terminado_taller', true, 3, false, true, false, false),
    (tb, 'Entregado', 'closed', true, 4, false, false, true, false),
    -- C: two active ready statuses (ambiguous).
    (tc, 'Recibido', 'received', true, 1, true, false, false, false),
    (tc, 'Listo', 'ready', true, 2, false, true, false, false),
    (tc, 'Listo para recoger', 'ready_pickup', true, 3, false, true, false, false),
    -- D: no ready status at all.
    (td, 'Recibido', 'received', true, 1, true, false, false, false),
    (td, 'Entregado', 'closed', true, 2, false, false, true, false);
  select id into st_a_ready from public.order_statuses where tenant_id = ta and code = 'ready';
  select id into st_b_final from public.order_statuses where tenant_id = tb and code = 'terminado_taller';

  perform pg_temp.as_user(a);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders, user_id) values
    (m_a, ta, 'Raquel', true, true, s);
  insert into public.orders (id, tenant_id, title, status_id, created_by)
  select v.id, ta, v.title, st.id, a
  from (values
    (o1, 'Dos pasos', 'received'), (o_plain, 'Sin secuencia', 'received'), (o_ready, 'Ya listo', 'ready'),
    (o_closed, 'Entregado', 'closed'), (o_cancel, 'Cancelado', 'cancelled'), (o_arch, 'Archivado', 'received'),
    (o_repl, 'Se quita el pendiente', 'received'), (o_prog, 'En proceso', 'in_progress')
  ) v(id, title, code)
  join public.order_statuses st on st.tenant_id = ta and st.code = v.code;
  perform pg_temp.as_user(b);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values (m_b, tb, 'Bea', true, true);
  insert into public.orders (id, tenant_id, title, status_id, created_by)
  select o_b, tb, 'Pedido B', id, b from public.order_statuses where tenant_id = tb and code = 'entrada';
  perform pg_temp.as_user(c);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values (m_c, tc, 'Ciro', true, true);
  insert into public.orders (id, tenant_id, title, status_id, created_by)
  select o_c, tc, 'Pedido C', id, c from public.order_statuses where tenant_id = tc and code = 'received';
  perform pg_temp.as_user(d);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values (m_d, td, 'Dora', true, true);
  insert into public.orders (id, tenant_id, title, status_id, created_by)
  select o_d, td, 'Pedido D', id, d from public.order_statuses where tenant_id = td and code = 'received';

  perform set_config('request.jwt.claim.role', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform public.set_tenant_feature('phase67a', 'order_work_sequence', true, null);
  perform public.set_tenant_feature('phase67b', 'order_work_sequence', true, null);
  perform public.set_tenant_feature('phase67c', 'order_work_sequence', true, null);
  perform public.set_tenant_feature('phase67d', 'order_work_sequence', true, null);

  -- Stages and sequences (owners, through the RPCs).
  perform pg_temp.as_user(a);
  set local role authenticated;
  g_a := (public.upsert_work_stage_v1(ta, null, 'Impresión', 'print')->'stage'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o1, pg_temp.rv(o1)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_a, 'team_member_id', m_a), jsonb_build_object('stage_id', g_a, 'team_member_id', m_a)))) = 'ok', 'o1 sequence');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_ready, pg_temp.rv(o_ready)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_a, 'team_member_id', m_a)))) = 'ok', 'o_ready sequence');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_closed, pg_temp.rv(o_closed)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_a, 'team_member_id', m_a)))) = 'ok', 'o_closed sequence');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_cancel, pg_temp.rv(o_cancel)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_a, 'team_member_id', m_a)))) = 'ok', 'o_cancel sequence');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_arch, pg_temp.rv(o_arch)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_a, 'team_member_id', m_a)))) = 'ok', 'o_arch sequence');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_repl, pg_temp.rv(o_repl)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_a, 'team_member_id', m_a), jsonb_build_object('stage_id', g_a, 'team_member_id', m_a)))) = 'ok', 'o_repl sequence');
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_prog, pg_temp.rv(o_prog)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_a, 'team_member_id', m_a)))) = 'ok', 'o_prog sequence');
  reset role;
  perform pg_temp.as_user(b);
  set local role authenticated;
  g_b := (public.upsert_work_stage_v1(tb, null, 'Acabado', 'finish')->'stage'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_b, pg_temp.rv(o_b)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_b, 'team_member_id', m_b)))) = 'ok', 'o_b sequence');
  reset role;
  perform pg_temp.as_user(c);
  set local role authenticated;
  g_c := (public.upsert_work_stage_v1(tc, null, 'Corte', 'cut')->'stage'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_c, pg_temp.rv(o_c)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_c, 'team_member_id', m_c)))) = 'ok', 'o_c sequence');
  reset role;
  perform pg_temp.as_user(d);
  set local role authenticated;
  g_d := (public.upsert_work_stage_v1(td, null, 'Corte', 'cut')->'stage'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(o_d, pg_temp.rv(o_d)::text,
    jsonb_build_array(jsonb_build_object('stage_id', g_d, 'team_member_id', m_d)))) = 'ok', 'o_d sequence');
  reset role;

  -- The archived order is archived now (lifecycle, as postgres with an actor).
  perform pg_temp.as_user(a);
  update public.orders set archived_at = now() where id = o_arch;

  -- 1. Without a sequence nothing changes: the RPCs never see the order.
  perform pg_temp.ok(pg_temp.status_code(o_plain) = 'received' and pg_temp.status_events(o_plain) = 0, 'no sequence: status kept');

  -- 2. A pending step remains: status kept, no transition, no auto_finish.
  perform pg_temp.as_user(a);
  set local role authenticated;
  s1 := pg_temp.step(o1, 1);
  s2 := pg_temp.step(o1, 2);
  ver := pg_temp.rv(o1);
  r := public.set_order_work_step_done_v1(s1, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean and not r ? 'order_status', 'first step: no order_status: ' || r::text);
  perform pg_temp.ok(pg_temp.status_code(o1) = 'received' and pg_temp.status_events(o1) = 0, 'first step: status kept');
  perform pg_temp.ok(not pg_temp.finish(o1, null, null), 'first step: no auto_finish metadata');
  perform pg_temp.ok(pg_temp.rv(o1) = ver + 1, 'first step: one version bump');

  -- Undo while not ready: no warning.
  r := public.set_order_work_step_done_v1(s1, false);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not r ? 'warning', 'undo before finish: no warning');
  r := public.set_order_work_step_done_v1(s1, true);

  -- 3. Last pending step: the order moves to Listo in the same UPDATE.
  before := pg_temp.frozen(o1);
  ver := pg_temp.rv(o1);
  r := public.set_order_work_step_done_v1(s2, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean, 'last step marked');
  perform pg_temp.ok(r->'order_status'->>'id' = st_a_ready::text
    and r->'order_status'->>'code' = 'ready'
    and (r->'order_status'->>'automatic')::boolean, 'answer carries the automatic status: ' || r::text);
  perform pg_temp.ok((r->>'row_version')::bigint = ver + 1 and pg_temp.rv(o1) = ver + 1, 'one version bump for step + status');
  perform pg_temp.ok(pg_temp.status_code(o1) = 'ready', 'order is Listo');
  perform pg_temp.ok((select ready_at is not null and delivered_at is null from public.orders where id = o1), 'ready_at set, delivered_at untouched');
  perform pg_temp.ok(pg_temp.frozen(o1) = before, 'only status_id/ready_at/updated_at/row_version changed');
  perform pg_temp.ok(pg_temp.status_events(o1) = 1, 'one status_changed row');
  perform pg_temp.ok(exists (
    select 1 from public.activity_log l
    where l.entity_id = o1 and l.action = 'order.status_changed'
      and l.tenant_id = ta and l.user_id = a
      and (l.metadata->>'automatic')::boolean
      and l.metadata->>'trigger' = 'work_sequence_completed'
      and l.metadata->>'step_id' = s2::text
      and l.metadata->>'stage_name' = 'Impresión'
      and l.previous_values->>'status_code' = 'received'
      and l.new_values->>'status_code' = 'ready'
  ), 'status_changed is marked automatic with its trigger');
  perform pg_temp.ok(pg_temp.finish(o1, 'result', 'finished')
    and pg_temp.finish(o1, 'status_code', 'ready'), 'work_step_completed records the finish');
  perform pg_temp.ok(coalesce(current_setting('gestcopy.order_status_auto', true), '') = ''
    and coalesce(current_setting('app.order_lifecycle', true), '') = '', 'markers cleared after the RPC');
  select ready_at into ready_at_1 from public.orders where id = o1;

  -- Idempotent mark: nothing written, no second transition.
  r := public.set_order_work_step_done_v1(s2, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not (r->>'changed')::boolean and not r ? 'order_status', 'second mark is a no-op');
  perform pg_temp.ok(pg_temp.rv(o1) = ver + 1 and pg_temp.status_events(o1) = 1, 'second mark: no bump, no transition');

  -- 4. D-B: undoing a step keeps Listo and warns.
  r := public.set_order_work_step_done_v1(s2, false);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and r->>'warning' = 'order_stays_ready'
    and r->'order_status'->>'code' = 'ready' and not (r->'order_status'->>'automatic')::boolean, 'undo warns order_stays_ready: ' || r::text);
  perform pg_temp.ok(pg_temp.status_code(o1) = 'ready' and pg_temp.status_events(o1) = 1, 'undo: status kept, no reversal');
  perform pg_temp.ok(exists (select 1 from public.activity_log
    where entity_id = o1 and action = 'order.work_step_reopened' and new_values->>'step_id' = s2::text and (metadata->>'order_stays_ready')::boolean), 'reopened activity says it stays ready');

  -- Marking it again: already ready, no duplicate transition, ready_at sticky.
  r := public.set_order_work_step_done_v1(s2, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not r ? 'order_status', 're-mark: no transition');
  perform pg_temp.ok(pg_temp.status_events(o1) = 1 and pg_temp.finish(o1, 'reason', 'already_ready'), 're-mark: skipped already_ready');
  perform pg_temp.ok((select ready_at from public.orders where id = o1) = ready_at_1, 'ready_at kept');

  -- 5. Already Listo before the sequence ends: no transition.
  r := public.set_order_work_step_done_v1(pg_temp.step(o_ready, 1), true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not r ? 'order_status', 'ready order: no transition');
  perform pg_temp.ok(pg_temp.status_events(o_ready) = 0 and pg_temp.finish(o_ready, 'reason', 'already_ready'), 'ready order: already_ready');

  -- 6. Delivered and cancelled are never touched.
  before := pg_temp.frozen(o_closed);
  r := public.set_order_work_step_done_v1(pg_temp.step(o_closed, 1), true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not r ? 'order_status', 'delivered: no transition');
  perform pg_temp.ok(pg_temp.status_code(o_closed) = 'closed' and pg_temp.status_events(o_closed) = 0
    and pg_temp.frozen(o_closed) = before
    and (select ready_at is null from public.orders where id = o_closed), 'delivered: untouched');
  perform pg_temp.ok(pg_temp.finish(o_closed, 'reason', 'order_closed'), 'delivered: reason order_closed');
  r := public.set_order_work_step_done_v1(pg_temp.step(o_cancel, 1), true);
  perform pg_temp.ok(pg_temp.status_code(o_cancel) = 'cancelled' and pg_temp.status_events(o_cancel) = 0
    and pg_temp.finish(o_cancel, 'reason', 'order_cancelled'), 'cancelled: untouched');

  -- 7. Archived: the RPC refuses, the status stays.
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(pg_temp.step(o_arch, 1), true)) = 'order_archived', 'archived: refused');
  perform pg_temp.ok(pg_temp.status_code(o_arch) = 'received' and pg_temp.status_events(o_arch) = 0, 'archived: untouched');

  -- 8. D-C: removing the pending step with replace never finishes.
  r := public.set_order_work_step_done_v1(pg_temp.step(o_repl, 1), true);
  r := public.replace_order_work_steps_v1(o_repl, pg_temp.rv(o_repl)::text,
    jsonb_build_array(jsonb_build_object('id', pg_temp.step(o_repl, 1), 'stage_id', g_a, 'team_member_id', m_a)));
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'replace drops the pending step: ' || r::text);
  perform pg_temp.ok(not exists (select 1 from public.order_work_steps where order_id = o_repl and completed_at is null), 'every step left is done');
  perform pg_temp.ok(pg_temp.status_code(o_repl) = 'received' and pg_temp.status_events(o_repl) = 0, 'replace: status kept');
  reset role;

  -- 9. Roles: viewer cannot mark; staff can and finishes the order (in progress -> Listo).
  perform pg_temp.as_user(vw);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(pg_temp.step(o_prog, 1), true)) = 'forbidden', 'viewer cannot mark');
  reset role;
  perform pg_temp.ok(pg_temp.status_code(o_prog) = 'in_progress', 'viewer: status kept');
  perform pg_temp.as_user(s);
  set local role authenticated;
  r := public.set_order_work_step_done_v1(pg_temp.step(o_prog, 1), true);
  perform pg_temp.ok((r->'order_status'->>'automatic')::boolean, 'staff finishes the order');
  reset role;
  perform pg_temp.ok(pg_temp.status_code(o_prog) = 'ready'
    and (select user_id = s from public.activity_log where entity_id = o_prog and action = 'order.status_changed'), 'staff: transition audited with the staff actor');

  -- 10. Tenants: B's owner cannot touch A; A's owner cannot touch B.
  perform pg_temp.as_user(b);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(pg_temp.step(o_repl, 1), false)) = 'not_found', 'B cannot reach A');
  reset role;
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.set_order_work_step_done_v1(pg_temp.step(o_b, 1), true)) = 'not_found', 'A cannot reach B');
  reset role;
  perform pg_temp.ok(pg_temp.status_code(o_b) = 'entrada', 'B untouched by A');

  -- 11. Another name and code: B finishes to «Terminado» (terminado_taller), never the inactive ready.
  perform pg_temp.as_user(b);
  set local role authenticated;
  r := public.set_order_work_step_done_v1(pg_temp.step(o_b, 1), true);
  reset role;
  perform pg_temp.ok(r->'order_status'->>'id' = st_b_final::text and r->'order_status'->>'name' = 'Terminado', 'B: Terminado: ' || r::text);
  perform pg_temp.ok(pg_temp.status_code(o_b) = 'terminado_taller' and pg_temp.status_events(o_b) = 1, 'B: one transition to its own final status');

  -- 12. Two active ready statuses (C) or none (D): status kept, reason recorded.
  perform pg_temp.as_user(c);
  set local role authenticated;
  r := public.set_order_work_step_done_v1(pg_temp.step(o_c, 1), true);
  reset role;
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and not r ? 'order_status', 'C: no transition');
  perform pg_temp.ok(pg_temp.status_code(o_c) = 'received' and pg_temp.finish(o_c, 'reason', 'ready_status_ambiguous'), 'C: ambiguous');
  perform pg_temp.as_user(d);
  set local role authenticated;
  r := public.set_order_work_step_done_v1(pg_temp.step(o_d, 1), true);
  reset role;
  perform pg_temp.ok(pg_temp.status_code(o_d) = 'received' and pg_temp.finish(o_d, 'reason', 'ready_status_missing'), 'D: missing');

  -- 13. Views after the transition: the order stays operational (not closed,
  -- not cancelled, not archived), is read through RLS with its ready flag, and
  -- has no current step (out of «Le toca» and of the team load).
  perform pg_temp.as_user(s);
  set local role authenticated;
  perform pg_temp.ok(exists (
    select 1 from public.orders o
    join public.order_statuses st on st.tenant_id = o.tenant_id and st.id = o.status_id
    where o.id = o1 and o.archived_at is null and st.is_ready and not st.is_closed and not st.is_cancelled
  ), 'views: finished order is operational and ready through RLS');
  perform pg_temp.ok(not exists (select 1 from public.order_work_steps where order_id = o1 and is_current), 'views: no current step');
  perform pg_temp.ok(coalesce((
    select (x->>'current')::integer from jsonb_array_elements(public.team_work_load_v1(ta)->'members') x
    where x->>'team_member_id' = m_a::text), 0) = 0, 'views: team load has no current step for the finished orders');
  reset role;
  perform pg_temp.as_user(b);
  set local role authenticated;
  perform pg_temp.ok(not exists (select 1 from public.orders where id = o1), 'views: B cannot see A orders');
  reset role;

  -- 14. The marker only counts for the order it names.
  perform set_config('request.jwt.claim.role', '', true);
  perform pg_temp.as_user(a);
  perform set_config('gestcopy.order_status_auto', jsonb_build_object('order_id', o_c)::text, true);
  perform set_config('app.order_lifecycle', 'validated', true);
  update public.orders set status_id = st_a_ready where id = o_plain;
  perform set_config('gestcopy.order_status_auto', '', true);
  perform set_config('app.order_lifecycle', '', true);
  perform pg_temp.ok((select metadata ? 'automatic' from public.activity_log where entity_id = o_plain and action = 'order.status_changed') = false,
    'a marker for another order is ignored');

  raise notice 'phase67 auto finish: PASS';
end $$;

rollback;
