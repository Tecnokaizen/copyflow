-- Local only. SUR4 E5: order post-its (20261028120000_order_notes_v1.sql).
-- Roles, tenants, feature gate, printable authorization, N4/N5, «Pasar a post-it»,
-- append-only history, purge and redaction (N22, T11, T12). Rollback-only.
begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase60 notes: %', label;
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
    raise exception 'phase60 notes expected % %, got %: % (statement: %)', expected, coalesce(msg, ''), sqlstate, sqlerrm, statement;
  end;
  raise exception 'phase60 notes unexpectedly succeeded: %', statement;
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

create function pg_temp.events(n uuid) returns integer language sql as $$
  select count(*)::integer from public.order_note_events where note_id = n
$$;

-- Every place where post-it text could leak, as one text blob (postgres view).
create function pg_temp.everything(t uuid) returns text language sql as $$
  select coalesce((select string_agg(x::text, ' ') from public.order_notes x where x.tenant_id = t), '')
    || coalesce((select string_agg(x::text, ' ') from public.order_note_versions x where x.tenant_id = t), '')
    || coalesce((select string_agg(x::text, ' ') from public.order_note_events x where x.tenant_id = t), '')
    || coalesce((select string_agg(x::text, ' ') from public.activity_log x where x.tenant_id = t and x.action like 'order.note%'), '')
$$;

do $$
declare
  a uuid := 'e6000000-0000-4000-8000-000000000001';    -- owner, tenant A
  ad uuid := 'e6000000-0000-4000-8000-000000000002';   -- admin, tenant A
  mg uuid := 'e6000000-0000-4000-8000-000000000003';   -- manager, tenant A
  s uuid := 'e6000000-0000-4000-8000-000000000004';    -- staff, tenant A
  s2 uuid := 'e6000000-0000-4000-8000-000000000005';   -- staff, tenant A
  vw uuid := 'e6000000-0000-4000-8000-000000000006';   -- viewer, tenant A
  b uuid := 'e6000000-0000-4000-8000-000000000007';    -- owner, tenant B
  c uuid := 'e6000000-0000-4000-8000-000000000008';    -- owner, tenant C (feature off)
  gone uuid := 'e6000000-0000-4000-8000-000000000009'; -- inactive membership, tenant A
  ta uuid := 'e6000000-0000-4000-8000-000000000011';
  tb uuid := 'e6000000-0000-4000-8000-000000000012';
  tc uuid := 'e6000000-0000-4000-8000-000000000013';
  st_a uuid := 'e6000000-0000-4000-8000-000000000021';
  st_a_closed uuid := 'e6000000-0000-4000-8000-000000000022';
  st_b uuid := 'e6000000-0000-4000-8000-000000000023';
  st_c uuid := 'e6000000-0000-4000-8000-000000000024';
  m_ok uuid := 'e6000000-0000-4000-8000-000000000031';
  m_gone uuid := 'e6000000-0000-4000-8000-000000000032';
  m_b uuid := 'e6000000-0000-4000-8000-000000000033';
  o1 uuid := 'e6000000-0000-4000-8000-000000000041';
  o_arch uuid := 'e6000000-0000-4000-8000-000000000042';
  o_legacy uuid := 'e6000000-0000-4000-8000-000000000043';
  o_long uuid := 'e6000000-0000-4000-8000-000000000044';
  o_full uuid := 'e6000000-0000-4000-8000-000000000045';
  o_b uuid := 'e6000000-0000-4000-8000-000000000046';
  o_c uuid := 'e6000000-0000-4000-8000-000000000047';
  o_purge uuid := 'e6000000-0000-4000-8000-000000000048';
  r jsonb;
  n_int uuid;
  n_print uuid;
  n_staff uuid;
  n_arch uuid;
  n_red uuid;
  n_c uuid;
  n_b uuid;
  n_conv uuid;
  e1 uuid;
  e2 uuid;
  e3 uuid;
  e_other uuid;
  ver bigint;
  cnt integer;
  i integer;
  long_body text := '<p>' || repeat('x', 4001) || '</p>';
begin
  -- Fixtures (postgres).
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase60.test', '{}'), (ad, 'ad@phase60.test', '{}'), (mg, 'mg@phase60.test', '{}'),
    (s, 's@phase60.test', '{}'), (s2, 's2@phase60.test', '{}'), (vw, 'vw@phase60.test', '{}'),
    (b, 'b@phase60.test', '{}'), (c, 'c@phase60.test', '{}'), (gone, 'gone@phase60.test', '{}');
  insert into public.profiles (id, full_name) values
    (a, 'Ana'), (ad, 'Adela'), (mg, 'Marta'), (s, 'Sara'), (s2, 'Sergio'), (vw, 'Vera'),
    (b, 'Bruno'), (c, 'Carla'), (gone, 'Gonzalo');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase60 A', 'phase60a', true), (tb, 'Phase60 B', 'phase60b', true), (tc, 'Phase60 C', 'phase60c', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, ad, 'admin', true), (ta, mg, 'manager', true), (ta, s, 'staff', true),
    (ta, s2, 'staff', true), (ta, vw, 'viewer', true), (ta, gone, 'staff', false),
    (tb, b, 'owner', true), (tc, c, 'owner', true);
  perform public.set_tenant_feature('phase60a', 'order_sticky_notes', true, null);
  perform public.set_tenant_feature('phase60b', 'order_sticky_notes', true, null);
  insert into public.order_statuses (id, tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled) values
    (st_a, ta, 'Recibido', 'received', true, 1, true, false, false, false),
    (st_a_closed, ta, 'Entregado', 'delivered', true, 2, false, false, true, false),
    (st_b, tb, 'Recibido', 'received', true, 1, true, false, false, false),
    (st_c, tc, 'Recibido', 'received', true, 1, true, false, false, false);
  perform pg_temp.as_user(a);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders, user_id) values
    (m_ok, ta, 'Raquel', true, true, s),
    (m_gone, ta, 'De baja', false, true, null);
  insert into public.orders (id, tenant_id, title, status_id, created_by, notes) values
    (o1, ta, 'Pedido con post-its', st_a, a, null),
    (o_arch, ta, 'Pedido archivado', st_a_closed, a, null),
    (o_legacy, ta, 'Con notas heredadas', st_a, a, '<p>TESTIGO-NOTAS-PEDIDO llamar a ana@example.com</p>'),
    (o_long, ta, 'Notas demasiado largas', st_a, a, '<p>' || repeat('y', 4001) || '</p>'),
    (o_full, ta, 'Doscientas notas', st_a, a, '<p>Notas heredadas</p>'),
    (o_purge, ta, 'Se borra', st_a, a, null);
  perform pg_temp.as_user(b);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values (m_b, tb, 'Otro tenant', true, true);
  insert into public.orders (id, tenant_id, title, status_id, created_by) values (o_b, tb, 'Pedido B', st_b, b);
  perform pg_temp.as_user(c);
  insert into public.orders (id, tenant_id, title, status_id, created_by) values (o_c, tc, 'Pedido C', st_c, c);

  -- Archive one order of A (lifecycle RPC, as the owner).
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform public.archive_order(o_arch, ta);
  reset role;
  perform pg_temp.ok((select archived_at is not null from public.orders where id = o_arch), 'fixture: archived order');

  -- Catalog: three features, born off (no plan, no override for other tenants).
  perform pg_temp.ok((select count(*) = 3 from public.features where code in ('order_sticky_notes', 'order_custom_labels', 'order_work_sheet_ficha')), 'three features registered');
  perform pg_temp.ok((select id = '31000000-0000-4000-8000-000000000011' from public.features where code = 'order_sticky_notes'), 'fixed id 011');
  perform pg_temp.ok((select id = '31000000-0000-4000-8000-000000000012' from public.features where code = 'order_custom_labels'), 'fixed id 012');
  perform pg_temp.ok((select id = '31000000-0000-4000-8000-000000000013' from public.features where code = 'order_work_sheet_ficha'), 'fixed id 013');
  perform pg_temp.ok(not exists (
    select 1 from public.plan_features pf join public.features f on f.id = pf.feature_id
    where f.code in ('order_sticky_notes', 'order_custom_labels', 'order_work_sheet_ficha')
  ), 'no plan includes the new features');

  -- Privileges: authenticated reads only, anon nothing, the kiosk role cannot call (T6, T8).
  perform pg_temp.ok(not has_table_privilege('anon', 'public.order_notes', 'select'), 'anon cannot read notes');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.order_notes', 'insert'), 'authenticated cannot insert notes');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.order_note_versions', 'update'), 'authenticated cannot update versions');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'public.order_note_events', 'delete'), 'authenticated cannot delete events');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.create_order_note_v1(uuid,text,text,boolean,uuid,boolean)', 'execute'), 'anon cannot create notes');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.redact_order_note_v1(uuid,text,uuid[],boolean)', 'execute'), 'anon cannot redact');
  perform pg_temp.ok(not has_function_privilege('service_role', 'public.create_order_note_v1(uuid,text,text,boolean,uuid,boolean)', 'execute'), 'service_role does not write notes');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.redact_order_note_v1(uuid,text,uuid[],boolean)', 'execute'), 'service_role may redact');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.order_note_log_v1(public.order_notes,text,text,uuid,text,jsonb,jsonb,uuid,uuid,text,jsonb)', 'execute'), 'helpers stay internal');

  -- 1. Create.
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o1);
  r := public.create_order_note_v1(o1, '<p>TESTIGO-POSTIT-INTERNO revisar sangrado</p>');
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'staff creates an internal note: ' || r::text);
  n_staff := (r->'note'->>'id')::uuid;
  perform pg_temp.ok(r->'note'->>'visibility' = 'internal' and r->'note'->>'state' = 'open', 'born internal and open');
  perform pg_temp.ok(r->'note'->>'author_name' = 'Raquel', 'author name is the linked team member');
  perform pg_temp.ok(pg_temp.rv(o1) = ver, 'N5: creating a note does not bump orders.row_version');
  perform pg_temp.ok(pg_temp.events(n_staff) = 1, 'one created event');

  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '<p>Para imprimir</p>', 'printable')) = 'printable_confirmation_required', 'printable needs confirmation');
  r := public.create_order_note_v1(o1, '<p>TESTIGO-IMPRIMIBLE plastificar</p>', 'printable', false, null, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'confirmed printable note');
  n_print := (r->'note'->>'id')::uuid;
  perform pg_temp.ok((select printable_authorized_by = s and printable_authorized_at is not null from public.order_notes where id = n_print), 'N18: authorization stored');
  perform pg_temp.ok((select array_agg(action order by created_at) = array['created', 'printable_authorized'] from public.order_note_events where note_id = n_print), 'created + printable_authorized events');

  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '')) = 'invalid_body', 'empty body');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '<p> &nbsp; </p>')) = 'invalid_body', 'blank rich text');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, null)) = 'invalid_body', 'null body');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, long_body)) = 'invalid_body', 'more than 4000 characters');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '<p>' || repeat('z', 4000) || '</p>')) = 'ok', '4000 visible characters are fine');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '<p>x</p>', 'public')) = 'invalid_visibility', 'unknown visibility');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '<p>x</p>', 'internal', false, m_gone)) = 'addressee_unavailable', 'inactive addressee');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '<p>x</p>', 'internal', false, m_b)) = 'addressee_unavailable', 'T3: addressee of another tenant');
  r := public.create_order_note_v1(o1, '<p>Para Raquel</p>', 'internal', true, m_ok);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->'note'->>'pinned')::boolean and r->'note'->>'addressee_team_member_id' = m_ok::text, 'pinned note with addressee');
  perform pg_temp.ok(r->'note'->>'visibility' = 'internal', 'pin and addressee never make a note printable');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o_arch, '<p>x</p>')) = 'order_archived', 'archived order is read-only');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o_b, '<p>x</p>')) = 'not_found', 'T2: order of another tenant');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(gen_random_uuid(), '<p>x</p>')) = 'not_found', 'unknown order');
  reset role;

  perform pg_temp.as_user(vw);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '<p>x</p>')) = 'forbidden', 'viewer cannot create');
  perform pg_temp.ok((select count(*) >= 3 from public.order_notes where order_id = o1), 'viewer reads the notes');
  perform pg_temp.ok((select count(*) >= 3 from public.order_note_versions v join public.order_notes n on n.id = v.note_id where n.order_id = o1), 'viewer reads the history');
  reset role;

  perform pg_temp.as_user(gone);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o1, '<p>x</p>')) = 'not_found', 'T7: inactive membership');
  perform pg_temp.ok((select count(*) = 0 from public.order_notes), 'T7: inactive membership reads nothing');
  reset role;

  perform pg_temp.as_user(b);
  set local role authenticated;
  perform pg_temp.ok((select count(*) = 0 from public.order_notes where tenant_id = ta), 'T1: other tenant reads no notes');
  perform pg_temp.ok((select count(*) = 0 from public.order_note_events where tenant_id = ta), 'T1: other tenant reads no events');
  perform pg_temp.ok(pg_temp.err(public.update_order_note_v1(n_staff, '1', '<p>x</p>')) = 'not_found', 'T2: update across tenants');
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_staff, 'void', 'x')) = 'not_found', 'T2: state across tenants');
  perform pg_temp.ok(pg_temp.err(public.convert_order_legacy_notes_v1(o_legacy, pg_temp.rv(o_legacy)::text)) = 'not_found', 'T2: convert across tenants');
  r := public.create_order_note_v1(o_b, '<p>Nota de B</p>');
  n_b := (r->'note'->>'id')::uuid;
  reset role;

  -- Feature off: not_found and no rows (tenant C).
  perform pg_temp.as_user(c);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o_c, '<p>x</p>')) = 'not_found', 'feature off: not_found');
  reset role;
  perform public.set_tenant_feature('phase60c', 'order_sticky_notes', true, null);
  set local role authenticated;
  r := public.create_order_note_v1(o_c, '<p>Nota de C</p>');
  n_c := (r->'note'->>'id')::uuid;
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'granted: C creates a note');
  reset role;
  perform public.set_tenant_feature('phase60c', 'order_sticky_notes', false, null);
  set local role authenticated;
  perform pg_temp.ok((select count(*) = 0 from public.order_notes where tenant_id = tc), 'withdrawn: RLS hides the rows');
  perform pg_temp.ok((select count(*) = 0 from public.order_note_versions where tenant_id = tc), 'withdrawn: RLS hides the versions');
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_c, 'pin')) = 'not_found', 'withdrawn: state is not_found');
  perform pg_temp.ok(pg_temp.err(public.redact_order_note_v1(n_c, 'personal_data_request', null, true)) = 'not_found', 'withdrawn: owner redaction is not_found');
  reset role;
  perform pg_temp.ok((select count(*) = 1 from public.order_notes where tenant_id = tc), 'withdrawn: data kept');

  -- 2. Direct writes are refused, even as postgres without the marker.
  perform pg_temp.as_user(s);
  set local role authenticated;
  perform pg_temp.boom(format('update public.order_notes set pinned = true where id = %L', n_staff), '42501');
  perform pg_temp.boom(format('delete from public.order_notes where id = %L', n_staff), '42501');
  perform pg_temp.boom(format('insert into public.order_note_events (tenant_id, order_id, note_id, action, actor_user_id, actor_name) values (%L, %L, %L, %L, %L, %L)', ta, o1, n_staff, 'created', s, 'x'), '42501');
  reset role;
  perform pg_temp.boom(format('update public.order_notes set pinned = true where id = %L', n_staff), '42501', 'order_notes_rpc_only');
  perform pg_temp.boom(format('delete from public.order_notes where id = %L', n_staff), '42501', 'order_notes_rpc_only');
  perform pg_temp.boom(format('update public.order_note_versions set body = null where note_id = %L', n_staff), '42501', 'order_notes_redact_only');
  perform pg_temp.boom(format('delete from public.order_note_versions where note_id = %L', n_staff), '42501', 'order_note_versions_rpc_only');
  perform pg_temp.boom(format('update public.order_note_events set reason = %L where note_id = %L', 'x', n_staff), '42501', 'order_note_events_append_only');
  perform pg_temp.boom(format('delete from public.order_note_events where note_id = %L', n_staff), '42501', 'order_note_events_append_only');
  perform pg_temp.boom('truncate public.order_note_events', '42501', 'order_notes_append_only');
  perform set_config('gestcopy.order_notes_write', '1', true);
  perform pg_temp.boom(format('update public.order_notes set body = null where id = %L', n_staff), '42501', 'order_notes_redact_only');
  perform pg_temp.boom(format('update public.order_notes set author_user_id = %L where id = %L', a, n_staff), '55000', 'immutable_identity');
  perform set_config('gestcopy.order_notes_write', '', true);
  perform pg_temp.ok(current_setting('gestcopy.order_notes_write', true) = '', 'marker closed');
  set constraints all immediate;
  set constraints all deferred;

  -- 3. Update (N4: only the author, only open notes; own row_version).
  perform pg_temp.as_user(mg);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.update_order_note_v1(n_staff, '1', '<p>Otro texto</p>')) = 'forbidden', 'N4: a manager cannot edit someone else''s note');
  reset role;
  perform pg_temp.as_user(vw);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.update_order_note_v1(n_staff, '1', '<p>Otro texto</p>')) = 'forbidden', 'viewer cannot edit');
  reset role;
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o1);
  perform pg_temp.ok(public.update_order_note_v1(n_staff, '7', '<p>x</p>')->>'error' = 'conflict', 'stale note version');
  perform pg_temp.ok(public.update_order_note_v1(n_staff, '7', '<p>x</p>')->>'row_version' = '1', 'conflict returns the current version');
  r := public.update_order_note_v1(n_staff, '1', '<p>TESTIGO-POSTIT-INTERNO revisar sangrado</p>');
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean is false and pg_temp.events(n_staff) = 1, 'same text is a no-op');
  r := public.update_order_note_v1(n_staff, '1', '<p>TESTIGO-POSTIT-INTERNO revisar sangrado y corte</p>');
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and r->'note'->>'row_version' = '2', 'edit bumps the note version');
  perform pg_temp.ok((select count(*) = 2 from public.order_note_versions where note_id = n_staff), 'edit keeps the previous version');
  perform pg_temp.ok((select version_before_id is not null and version_after_id is not null and before is not null and after is not null from public.order_note_events where note_id = n_staff and action = 'edited'), 'edited event points at both versions');
  perform pg_temp.ok(pg_temp.err(public.update_order_note_v1(n_staff, '2', null, 'printable')) = 'printable_confirmation_required', 'making it printable needs confirmation');
  r := public.update_order_note_v1(n_staff, '2', null, 'printable', true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and r->'note'->>'visibility' = 'printable', 'made printable');
  perform pg_temp.ok(pg_temp.err(public.update_order_note_v1(n_staff, '3', '<p>Texto nuevo</p>')) = 'printable_confirmation_required', 'editing a printable note needs confirmation again');
  r := public.update_order_note_v1(n_staff, '3', '<p>Texto nuevo</p>', null, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'confirmed edit of a printable note');
  perform pg_temp.ok((select count(*) = 2 from public.order_note_events where note_id = n_staff and action = 'printable_authorized'), 'every authorization is an event');
  r := public.update_order_note_v1(n_staff, '4', null, 'internal');
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and r->'note'->>'printable_authorized_by' is null, 'back to internal clears the authorization');
  perform pg_temp.ok((select count(*) = 1 from public.order_note_events where note_id = n_staff and action = 'made_internal'), 'made_internal event');
  perform pg_temp.ok(pg_temp.rv(o1) = ver, 'N5: editing never bumps orders.row_version');
  reset role;

  -- 4. State actions (idempotent; N4 for voiding).
  perform pg_temp.as_user(s2);
  set local role authenticated;
  r := public.create_order_note_v1(o1, '<p>Nota de Sergio</p>');
  n_int := (r->'note'->>'id')::uuid;
  reset role;
  perform pg_temp.as_user(s);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_int, 'archive')) = 'invalid_action', 'unknown action');
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_int, 'pin')) = 'ok', 'staff pins someone else''s note');
  cnt := pg_temp.events(n_int);
  r := public.set_order_note_state_v1(n_int, 'pin');
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'changed')::boolean is false and pg_temp.events(n_int) = cnt, 'pin is idempotent');
  r := public.set_order_note_state_v1(n_int, 'resolve');
  perform pg_temp.ok(r->'note'->>'state' = 'resolved' and not (r->'note'->>'pinned')::boolean, 'resolving unpins');
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_int, 'pin')) = 'conflict', 'a resolved note cannot be pinned');
  r := public.set_order_note_state_v1(n_int, 'reopen');
  perform pg_temp.ok(r->'note'->>'state' = 'open' and r->'note'->>'resolved_at' is null, 'reopen');
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_int, 'void', 'no vale')) = 'forbidden', 'N4: staff cannot void someone else''s note');
  reset role;
  perform pg_temp.as_user(s2);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_int, 'void')) = 'reason_required', 'void needs a reason');
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_int, 'void', '   ')) = 'reason_required', 'blank reason');
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_int, 'void', repeat('r', 501))) = 'invalid_reason', 'reason too long');
  r := public.set_order_note_state_v1(n_int, 'void', 'Duplicada');
  perform pg_temp.ok(r->'note'->>'state' = 'voided' and r->'note'->>'void_reason' = 'Duplicada', 'author voids own note');
  cnt := pg_temp.events(n_int);
  perform pg_temp.ok((public.set_order_note_state_v1(n_int, 'void', 'Otra vez')->>'changed')::boolean is false and pg_temp.events(n_int) = cnt, 'void is idempotent');
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_int, 'reopen')) = 'conflict', 'voided is final');
  perform pg_temp.ok(pg_temp.err(public.update_order_note_v1(n_int, (r->'note'->>'row_version'), '<p>x</p>')) = 'forbidden', 'a voided note cannot be edited');
  reset role;
  perform pg_temp.as_user(mg);
  set local role authenticated;
  r := public.set_order_note_state_v1(n_print, 'void', 'Ya no aplica');
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'N4: a manager voids someone else''s note');
  reset role;
  perform pg_temp.ok((select count(*) = 0 from public.order_notes where pinned and state <> 'open'), 'only open notes stay pinned');

  -- 5. «Pasar a post-it».
  perform pg_temp.as_user(vw);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.convert_order_legacy_notes_v1(o_legacy, pg_temp.rv(o_legacy)::text)) = 'forbidden', 'viewer cannot convert');
  reset role;
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o_legacy);
  r := public.convert_order_legacy_notes_v1(o_legacy, (ver - 1)::text);
  perform pg_temp.ok(r->>'error' = 'conflict' and r->>'row_version' = ver::text, 'convert with another order version');
  perform pg_temp.ok(pg_temp.err(public.convert_order_legacy_notes_v1(o1, pg_temp.rv(o1)::text)) = 'no_legacy_notes', 'nothing to convert');
  perform pg_temp.ok(pg_temp.err(public.convert_order_legacy_notes_v1(o_arch, pg_temp.rv(o_arch)::text)) = 'order_archived', 'archived order');
  ver := pg_temp.rv(o_long);
  perform pg_temp.ok(pg_temp.err(public.convert_order_legacy_notes_v1(o_long, ver::text)) = 'invalid_body', 'legacy text too long');
  perform pg_temp.ok((select notes is not null from public.orders where id = o_long) and pg_temp.rv(o_long) = ver, 'failed conversion keeps orders.notes and row_version');
  reset role;
  -- 200 notes in o_full, then the conversion must leave it untouched.
  perform set_config('gestcopy.order_notes_write', '1', true);
  for i in 1..200 loop
    insert into public.order_notes (id, tenant_id, order_id, body, author_user_id, author_name, current_version_id)
    values (gen_random_uuid(), ta, o_full, '<p>n</p>', a, 'Ana', gen_random_uuid())
    returning id into n_conv;
    insert into public.order_note_versions (id, tenant_id, note_id, version, body, created_by)
    select current_version_id, ta, id, 1, body, a from public.order_notes where id = n_conv;
  end loop;
  perform set_config('gestcopy.order_notes_write', '', true);
  perform pg_temp.as_user(s);
  set local role authenticated;
  ver := pg_temp.rv(o_full);
  perform pg_temp.ok(pg_temp.err(public.convert_order_legacy_notes_v1(o_full, ver::text)) = 'too_many_notes', 'conversion with 200 notes');
  perform pg_temp.ok((select notes = '<p>Notas heredadas</p>' from public.orders where id = o_full) and pg_temp.rv(o_full) = ver, 'too_many_notes keeps orders.notes and row_version');
  perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(o_full, '<p>201</p>')) = 'too_many_notes', 'no note 201');
  ver := pg_temp.rv(o_legacy);
  reset role;
  select count(*) into cnt from public.activity_log
  where entity_id = o_legacy and (previous_values::text like '%TESTIGO%' or new_values::text like '%TESTIGO%' or metadata::text like '%TESTIGO%');
  set local role authenticated;
  r := public.convert_order_legacy_notes_v1(o_legacy, ver::text);
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'convert: ' || r::text);
  n_conv := (r->'note'->>'id')::uuid;
  perform pg_temp.ok(r->>'version' = (ver + 1)::text and pg_temp.rv(o_legacy) = ver + 1, 'conversion bumps the order version once');
  perform pg_temp.ok((select notes is null from public.orders where id = o_legacy), 'orders.notes emptied');
  perform pg_temp.ok((select visibility = 'internal' and body like '%TESTIGO-NOTAS-PEDIDO%' from public.order_notes where id = n_conv), 'the note keeps the text and is internal');
  reset role;
  perform pg_temp.ok((select count(*) = 1 from public.activity_log where entity_id = o_legacy and action = 'order.legacy_notes_converted' and metadata->>'note_id' = n_conv::text), 'activity: order.legacy_notes_converted with the note id');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where entity_id = o_legacy and action = 'order.content_changed' and metadata->>'field' = 'notes'), 'no content_changed copy of the text');
  perform pg_temp.ok((select count(*) from public.activity_log where entity_id = o_legacy and (previous_values::text like '%TESTIGO%' or new_values::text like '%TESTIGO%' or metadata::text like '%TESTIGO%')) = cnt, 'T9: the conversion adds no activity with text');
  perform pg_temp.ok(current_setting('gestcopy.order_notes_write', true) = '', 'marker closed after conversion');

  -- 6. Redaction (N22, T11, T12).
  perform pg_temp.as_user(s);
  set local role authenticated;
  r := public.create_order_note_v1(o1, '<p>TESTIGO-POSTIT-SUPRIMIDO teléfono 600123123</p>');
  n_red := (r->'note'->>'id')::uuid;
  r := public.update_order_note_v1(n_red, '1', '<p>TESTIGO-POSTIT-SUPRIMIDO v2 maria@example.com</p>');
  perform public.set_order_note_state_v1(n_red, 'resolve', 'TESTIGO-MOTIVO-UNO avisada maria@example.com');
  perform public.set_order_note_state_v1(n_red, 'reopen', 'TESTIGO-MOTIVO-DOS llamó 600123123');
  r := public.set_order_note_state_v1(n_red, 'void', 'Motivo sin datos');
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'fixture: three reasons');
  select id into e1 from public.order_note_events where note_id = n_red and action = 'resolved';
  select id into e2 from public.order_note_events where note_id = n_red and action = 'reopened';
  select id into e3 from public.order_note_events where note_id = n_red and action = 'voided';
  select id into e_other from public.order_note_events where note_id = n_int and action = 'voided';
  perform pg_temp.ok(pg_temp.err(public.redact_order_note_v1(n_red, 'personal_data_request', array[e1], true)) = 'forbidden', 'T11: staff cannot redact');
  reset role;
  perform pg_temp.as_user(mg);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.redact_order_note_v1(n_red, 'personal_data_request', array[e1], true)) = 'forbidden', 'T11: manager cannot redact');
  reset role;
  perform pg_temp.as_user(b);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.redact_order_note_v1(n_red, 'personal_data_request', array[e1], true)) = 'not_found', 'T11: owner of another tenant');
  reset role;
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.redact_order_note_v1(n_red, 'personal_data_request', array[e1], false)) = 'confirmation_required', 'confirmation required');
  perform pg_temp.ok(pg_temp.err(public.redact_order_note_v1(n_red, 'because', array[e1], true)) = 'invalid_reason_code', 'closed list of reason codes');
  perform pg_temp.ok(pg_temp.err(public.redact_order_note_v1(n_red, 'personal_data_request', array[e_other], true)) = 'invalid_reason_target', 'event of another note');
  perform pg_temp.ok(pg_temp.err(public.redact_order_note_v1(n_red, 'personal_data_request', array[(select id from public.order_note_events where note_id = n_red and action = 'created')], true)) = 'invalid_reason_target', 'event without a reason');
  perform pg_temp.ok((select count(*) = 0 from public.order_note_versions where note_id = n_red and body is null), 'refusals wrote nothing');
  ver := pg_temp.rv(o1);
  r := public.redact_order_note_v1(n_red, 'personal_data_found', array[e1], true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'versions_redacted')::int = 2 and (r->>'reasons_redacted')::int = 1, 'first redaction: ' || r::text);
  perform pg_temp.ok(r->'note'->>'body' is null and r->'note'->>'visibility' = 'internal' and r->'note'->>'state' = 'voided', 'note emptied, internal and voided');
  perform pg_temp.ok(r->'note'->>'void_reason' = 'Motivo sin datos', 'unflagged void reason kept');
  perform pg_temp.ok((select reason = '[motivo suprimido]' from public.order_note_events where id = e1), 'flagged reason replaced');
  perform pg_temp.ok((select reason like 'TESTIGO-MOTIVO-DOS%' from public.order_note_events where id = e2), 'unflagged reason kept');
  perform pg_temp.ok((select count(*) = 0 from public.order_note_versions where note_id = n_red and body is not null), 'every version emptied');
  perform pg_temp.ok((select count(*) = 2 from public.order_note_versions where note_id = n_red and created_by = s and redacted_by = a), 'authorship kept, redaction recorded');
  perform pg_temp.ok(pg_temp.rv(o1) = ver, 'redaction does not bump the order');
  cnt := pg_temp.events(n_red);
  r := public.redact_order_note_v1(n_red, 'personal_data_found', array[e1], true);
  perform pg_temp.ok((r->>'changed')::boolean is false and pg_temp.events(n_red) = cnt, 'repeating with nothing new writes nothing');
  r := public.redact_order_note_v1(n_red, 'personal_data_request', array[e2], true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and (r->>'reasons_redacted')::int = 1 and (r->>'versions_redacted')::int = 0, 'second redaction flags another reason');
  perform pg_temp.ok((select reason = 'Motivo sin datos' from public.order_note_events where id = e3), 'T12: the third reason stays intact');
  perform pg_temp.ok((select count(*) = 2 from public.order_note_events where note_id = n_red and action = 'redacted' and actor_user_id = a and created_at is not null), 'T12: one redacted event per pass');
  perform pg_temp.ok((select array_agg(action order by created_at) from public.order_note_events where note_id = n_red)
    = array['created', 'edited', 'resolved', 'reopened', 'voided', 'redacted', 'redacted'], 'T12: actions kept in order');
  r := public.redact_order_note_v1(n_red, 'personal_data_request', array[e3], true);
  perform pg_temp.ok(r->'note'->>'void_reason' = '[motivo suprimido]', 'flagging the void event also replaces void_reason');
  reset role;
  perform pg_temp.ok(pg_temp.everything(ta) not like '%TESTIGO-POSTIT-SUPRIMIDO%', 'T12: no redacted text anywhere');
  perform pg_temp.ok(pg_temp.everything(ta) not like '%TESTIGO-MOTIVO-UNO%' and pg_temp.everything(ta) not like '%TESTIGO-MOTIVO-DOS%', 'T12: no flagged reason anywhere');
  perform pg_temp.ok((select count(*) = 0 from public.activity_log where tenant_id = ta and action like 'order.note%' and (previous_values::text like '%TESTIGO%' or new_values::text like '%TESTIGO%' or metadata::text like '%TESTIGO%')), 'T9: note activity never carries text or reasons');
  perform pg_temp.ok(current_setting('gestcopy.order_notes_redact', true) = '', 'redact marker closed');

  -- Operator path: service_role redacts in a tenant without the feature (C).
  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('request.jwt.claim.sub', '', true);
  set local role service_role;
  r := public.redact_order_note_v1(n_c, 'personal_data_request', null, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok' and r->'note'->>'body' is null, 'operator redacts with the feature withdrawn');
  perform pg_temp.boom('select count(*) from public.order_notes', '42501');
  reset role;
  perform pg_temp.ok((select actor_user_id is null and actor_name = 'Operador' from public.order_note_events where note_id = n_c and action = 'redacted'), 'operator event without account');
  perform pg_temp.ok((select void_reason = 'Texto suprimido' and voided_by is null from public.order_notes where id = n_c), 'operator voids with «Texto suprimido»');

  -- Redaction also works on an archived order (personal data requests).
  perform pg_temp.as_user(a);
  set local role authenticated;
  reset role;
  perform set_config('gestcopy.order_notes_write', '1', true);
  perform set_config('gestcopy.order_notes_redact', '1', true); -- bypass the archived check for the fixture only
  insert into public.order_notes (id, tenant_id, order_id, body, author_user_id, author_name, current_version_id)
  values (gen_random_uuid(), ta, o_arch, '<p>TESTIGO-POSTIT-SUPRIMIDO en archivado</p>', a, 'Ana', gen_random_uuid())
  returning id into n_arch;
  perform set_config('gestcopy.order_notes_redact', '', true);
  insert into public.order_note_versions (id, tenant_id, note_id, version, body, created_by)
  select current_version_id, ta, id, 1, body, a from public.order_notes where id = n_arch;
  perform set_config('gestcopy.order_notes_write', '', true);
  perform pg_temp.as_user(a);
  set local role authenticated;
  perform pg_temp.ok(pg_temp.err(public.set_order_note_state_v1(n_arch, 'pin')) = 'order_archived', 'archived: no state change');
  r := public.redact_order_note_v1(n_arch, 'personal_data_request', null, true);
  perform pg_temp.ok(pg_temp.err(r) = 'ok', 'archived: redaction still works');
  reset role;

  -- 7. Purge with the order; nothing else deletes.
  perform pg_temp.as_user(s);
  set local role authenticated;
  r := public.create_order_note_v1(o_purge, '<p>Se va con el pedido</p>');
  perform public.set_order_note_state_v1((r->'note'->>'id')::uuid, 'resolve', 'listo');
  reset role;
  delete from public.orders where id = o_purge;
  perform pg_temp.ok(not exists (select 1 from public.order_notes where order_id = o_purge), 'purged notes');
  perform pg_temp.ok(not exists (select 1 from public.order_note_events where order_id = o_purge), 'purged events');
  perform pg_temp.ok(current_setting('gestcopy.order_notes_purge', true) = '', 'purge marker closed');

  -- Deferred FK to the current version holds at commit time.
  set constraints all immediate;
  perform pg_temp.ok((select count(*) = 0 from public.order_notes n where not exists (
    select 1 from public.order_note_versions v where v.tenant_id = n.tenant_id and v.id = n.current_version_id)), 'every note points at a version');

  raise notice 'phase60 order notes PASS';
end $$;

rollback;
