-- Local only. R6: one eligibility rule for the person in charge of orders and
-- quotes (20261022130000_assignee_eligibility_v1.sql). Rollback-only.
-- Direct UPDATEs of orders are checked as postgres so this suite does not
-- depend on the order write guard (20261022120000): the trigger has no
-- postgres exemption.
begin;
\i supabase/tests/helpers/accepted_quote_fixture.sql

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase59: %', label;
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
    raise exception 'phase59 expected % %, got %: % (statement: %)', expected, coalesce(msg, ''), sqlstate, sqlerrm, statement;
  end;
  raise exception 'phase59 unexpectedly succeeded: %', statement;
end $$;

create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
end $$;

create function pg_temp.rv(o uuid) returns bigint language sql as $$
  select row_version from public.orders where id = o
$$;

do $$
declare
  a uuid := 'e5900000-0000-4000-8000-000000000001';   -- owner, tenant A
  s uuid := 'e5900000-0000-4000-8000-000000000002';   -- staff, tenant A
  b uuid := 'e5900000-0000-4000-8000-000000000003';   -- owner, tenant B
  ta uuid := 'e5900000-0000-4000-8000-000000000011';
  tb uuid := 'e5900000-0000-4000-8000-000000000012';
  st_init uuid := 'e5900000-0000-4000-8000-000000000021';
  st_closed uuid := 'e5900000-0000-4000-8000-000000000022';
  st_b uuid := 'e5900000-0000-4000-8000-000000000023';
  m_ok uuid := 'e5900000-0000-4000-8000-000000000031';      -- active, can receive orders
  m_off uuid := 'e5900000-0000-4000-8000-000000000032';     -- active, cannot receive orders
  m_gone uuid := 'e5900000-0000-4000-8000-000000000033';    -- inactive
  m_none uuid := 'e5900000-0000-4000-8000-000000000034';    -- inactive, cannot receive orders
  m_b uuid := 'e5900000-0000-4000-8000-000000000035';       -- tenant B
  m_leaving uuid := 'e5900000-0000-4000-8000-000000000036'; -- loses can_receive_orders later
  m_quit uuid := 'e5900000-0000-4000-8000-000000000037';    -- becomes inactive later
  o1 uuid := 'e5900000-0000-4000-8000-000000000041';
  o_null uuid := 'e5900000-0000-4000-8000-000000000042';
  o_legacy uuid := 'e5900000-0000-4000-8000-000000000043';
  o_legacy2 uuid := 'e5900000-0000-4000-8000-000000000044';
  qid uuid := 'e5900000-0000-4000-8000-000000000051';
  rejected constant text := 'team member cannot receive orders';
  draft_status uuid;
  q_conv uuid;
  q_direct uuid;
  q_legacy uuid;
  q public.quotes%rowtype;
  v public.quote_versions%rowtype;
  h jsonb := '{"description":"Copias","title":"Trabajo","issue_date":"2026-10-22","currency":"EUR","prices_include_tax":false,"contact_name":"Ana","billing_address":"Manual"}';
  items jsonb := '[{"concept":"Copias A4","quantity":"2","unit_price":"10","discount_percent":"0","tax_rate":"21"}]';
  r jsonb;
  ver bigint;
  n integer;
begin
  -- Fixtures (postgres).
  insert into auth.users (id, email, raw_user_meta_data) values
    (a, 'a@phase59.test', '{}'), (s, 's@phase59.test', '{}'), (b, 'b@phase59.test', '{}');
  insert into public.profiles (id, full_name) values (a, 'Ana'), (s, 'Sara'), (b, 'Bruno');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase59 A', 'phase59a', true), (tb, 'Phase59 B', 'phase59b', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, a, 'owner', true), (ta, s, 'staff', true), (tb, b, 'owner', true);
  perform public.seed_quote_statuses(ta);
  perform public.set_tenant_feature('phase59a', 'quotes', true, null);
  select id into draft_status from public.quote_statuses where tenant_id = ta and code = 'draft';
  insert into public.order_statuses (id, tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled) values
    (st_init, ta, 'Recibido', 'received', true, 1, true, false, false, false),
    (st_closed, ta, 'Entregado', 'delivered', true, 2, false, false, true, false),
    (st_b, tb, 'Recibido', 'received', true, 1, true, false, false, false);
  perform pg_temp.as_user(a); -- team activity triggers need an actor
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values
    (m_ok, ta, 'Elegible', true, true),
    (m_off, ta, 'Sin pedidos', true, false),
    (m_gone, ta, 'De baja', false, true),
    (m_none, ta, 'De baja sin pedidos', false, false),
    (m_leaving, ta, 'Deja de recibir', true, true),
    (m_quit, ta, 'Se va', true, true);
  perform pg_temp.as_user(b);
  insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values (m_b, tb, 'Otro tenant', true, true);

  -- 1. The rule: same tenant, active and can_receive_orders.
  perform pg_temp.ok(public.team_member_is_assignable(ta, m_ok), 'active + can receive is assignable');
  perform pg_temp.ok(not public.team_member_is_assignable(ta, m_off), 'cannot receive orders is not assignable');
  perform pg_temp.ok(not public.team_member_is_assignable(ta, m_gone), 'inactive is not assignable');
  perform pg_temp.ok(not public.team_member_is_assignable(ta, m_none), 'inactive and cannot receive is not assignable');
  perform pg_temp.ok(not public.team_member_is_assignable(ta, m_b), 'another tenant is not assignable');
  perform pg_temp.ok(not public.team_member_is_assignable(tb, m_ok), 'the tenant must match');
  perform pg_temp.ok(not public.team_member_is_assignable(ta, gen_random_uuid()), 'unknown id is not assignable');

  -- 2. Orders created directly by staff (the POST /api/orders path).
  perform pg_temp.as_user(s);
  set local role authenticated;
  insert into public.orders (id, tenant_id, title, status_id, assigned_team_member_id, created_by)
    values (o1, ta, 'Con responsable', st_init, m_ok, s);
  perform pg_temp.boom(format($q$insert into public.orders (tenant_id, title, status_id, assigned_team_member_id, created_by) values (%L, 'x', %L, %L, %L)$q$, ta, st_init, m_off, s),
    '22023', rejected);
  perform pg_temp.boom(format($q$insert into public.orders (tenant_id, title, status_id, assigned_team_member_id, created_by) values (%L, 'x', %L, %L, %L)$q$, ta, st_init, m_gone, s),
    '22023', rejected);
  insert into public.orders (id, tenant_id, title, status_id, assigned_team_member_id, created_by)
    values (o_null, ta, 'Sin responsable', st_init, null, s);
  insert into public.orders (id, tenant_id, title, status_id, assigned_team_member_id, created_by) values
    (o_legacy, ta, 'Histórico 1', st_init, m_leaving, s),
    (o_legacy2, ta, 'Histórico 2', st_init, m_quit, s);

  -- 3. Changing the assignee through change_order_details_v2.
  perform pg_temp.boom(format($q$select public.change_order_details_v2(%L, 'assigned_team_member_id', %L, %L, %s)$q$, o1, m_off, ta, pg_temp.rv(o1)),
    '22023', rejected);
  perform pg_temp.boom(format($q$select public.change_order_details_v2(%L, 'assigned_team_member_id', %L, %L, %s)$q$, o1, m_gone, ta, pg_temp.rv(o1)),
    '22023', 'invalid team member for current tenant');
  perform pg_temp.ok((select assigned_team_member_id = m_ok from public.orders where id = o1), 'refused changes keep the assignee');
  r := public.change_order_details_v2(o1, 'assigned_team_member_id', null, ta, pg_temp.rv(o1));
  perform pg_temp.ok(r->'order'->>'assigned_team_member_id' is null, 'clearing the assignee is always allowed');
  r := public.change_order_details_v2(o1, 'assigned_team_member_id', m_ok::text, ta, pg_temp.rv(o1));
  perform pg_temp.ok(r->'order'->>'assigned_team_member_id' = m_ok::text, 'assigning an eligible person works');
  ver := pg_temp.rv(o1);
  r := public.change_order_details_v2(o1, 'assigned_team_member_id', m_ok::text, ta, ver);
  perform pg_temp.ok(pg_temp.rv(o1) = ver, 'same assignee is still a no-op');

  -- 4. History: people who stop being assignable keep their current orders,
  --    and those orders stay fully editable.
  reset role;
  perform pg_temp.as_user(a);
  update public.team_members set can_receive_orders = false where id = m_leaving;
  update public.team_members set active = false where id = m_quit;
  perform pg_temp.ok((select assigned_team_member_id = m_leaving from public.orders where id = o_legacy), 'losing can_receive_orders keeps the order');
  perform pg_temp.ok((select assigned_team_member_id = m_quit from public.orders where id = o_legacy2), 'deactivation keeps the order');
  perform pg_temp.as_user(s);
  set local role authenticated;
  r := public.change_order_content_v2(o_legacy, 'title', 'Histórico editado', ta, pg_temp.rv(o_legacy));
  perform pg_temp.ok(r->'order'->>'title' = 'Histórico editado', 'content edits work with a legacy assignee');
  r := public.change_order_details_v2(o_legacy, 'priority', 'high', ta, pg_temp.rv(o_legacy));
  perform pg_temp.ok(r->'order'->>'priority' = 'high', 'detail edits work with a legacy assignee');
  r := public.change_order_details_v2(o_legacy2, 'due_at', '2026-11-03T10:00:00Z', ta, pg_temp.rv(o_legacy2));
  perform pg_temp.ok((select due_at is not null from public.orders where id = o_legacy2), 'detail edits work with an inactive assignee');
  r := public.change_order_status_v2(o_legacy, st_closed, ta, pg_temp.rv(o_legacy));
  r := public.archive_order(o_legacy, ta);
  perform pg_temp.ok((select archived_at is not null and assigned_team_member_id = m_leaving from public.orders where id = o_legacy),
    'status change and archive keep the legacy assignee');
  reset role;
  perform pg_temp.as_user(a);
  update public.orders set assigned_team_member_id = assigned_team_member_id, notes = 'x' where id = o_legacy2;
  get diagnostics n = row_count;
  perform pg_temp.ok(n = 1, 'an unchanged assignee is not checked');
  perform pg_temp.boom(format('update public.orders set assigned_team_member_id = %L where id = %L', m_off, o_legacy2), '22023', rejected);
  perform pg_temp.boom(format('update public.orders set assigned_team_member_id = %L where id = %L', m_b, o_legacy2), '22023', rejected);

  -- 5. Quote conversion.
  perform pg_temp.as_user(s);
  set local role authenticated;
  insert into public.quotes (tenant_id, title, description, status_id)
    values (ta, 'Para convertir', '<p>Trabajo</p>', draft_status) returning id into q_conv;
  perform pg_temp.accepted_quote_fixture(q_conv);
  perform pg_temp.boom(format($q$select public.convert_quote_to_order(%L, null, null, %L, 'normal', null, %s)$q$,
    q_conv, m_off, (select row_version from public.quotes where id = q_conv)), '22023', rejected);
  perform pg_temp.ok((select converted_order_id is null from public.quotes where id = q_conv), 'a refused conversion creates nothing');
  r := public.convert_quote_to_order(q_conv, null, null, m_gone, 'normal', null, (select row_version from public.quotes where id = q_conv));
  perform pg_temp.ok(r->>'ok' = 'false' and r->>'error' = 'invalid_relation', 'inactive assignee keeps its existing answer');
  r := public.convert_quote_to_order(q_conv, null, null, m_ok, 'normal', null, (select row_version from public.quotes where id = q_conv));
  perform pg_temp.ok(r->>'ok' = 'true', 'conversion with an eligible assignee works');
  perform pg_temp.ok((select assigned_team_member_id = m_ok from public.orders where id = (r->>'order_id')::uuid), 'converted order keeps the assignee');

  -- 6. Quotes written directly (POST and PATCH /api/quotes).
  insert into public.quotes (tenant_id, title, description, status_id, assigned_team_member_id)
    values (ta, 'Directo', '<p>Trabajo</p>', draft_status, m_ok) returning id into q_direct;
  perform pg_temp.boom(format($q$insert into public.quotes (tenant_id, title, description, status_id, assigned_team_member_id) values (%L, 'x', '<p>x</p>', %L, %L)$q$, ta, draft_status, m_off),
    '22023', rejected);
  perform pg_temp.boom(format('update public.quotes set assigned_team_member_id = %L where id = %L', m_gone, q_direct), '22023', rejected);
  update public.quotes set assigned_team_member_id = null where id = q_direct;
  update public.quotes set assigned_team_member_id = m_ok where id = q_direct;
  perform pg_temp.ok((select assigned_team_member_id = m_ok from public.quotes where id = q_direct), 'quote assignee changes to an eligible person');

  -- Quotes keep their legacy assignee too.
  reset role;
  perform pg_temp.as_user(a);
  update public.team_members set can_receive_orders = true where id = m_leaving;
  perform pg_temp.as_user(s);
  set local role authenticated;
  insert into public.quotes (tenant_id, title, description, status_id, assigned_team_member_id)
    values (ta, 'Histórico', '<p>Trabajo</p>', draft_status, m_leaving) returning id into q_legacy;
  reset role;
  perform pg_temp.as_user(a);
  update public.team_members set can_receive_orders = false where id = m_leaving;
  perform pg_temp.as_user(s);
  set local role authenticated;
  update public.quotes set title = 'Histórico editado' where id = q_legacy;
  perform pg_temp.ok((select assigned_team_member_id = m_leaving and title = 'Histórico editado' from public.quotes where id = q_legacy),
    'quotes keep a legacy assignee while editing other fields');

  -- 7. Quote draft RPCs (SECURITY DEFINER: no postgres exemption).
  perform pg_temp.boom(format('select public.create_quote_draft_v1(%L, %L, null, null, %L, %L::jsonb, %L::jsonb, false)', ta, gen_random_uuid(), m_off, h, items),
    '22023', rejected);
  r := public.create_quote_draft_v1(ta, qid, null, null, m_ok, h, items, false);
  perform pg_temp.ok(r->>'ok' = 'true', 'draft with an eligible assignee works');
  select * into q from public.quotes where id = qid;
  select * into v from public.quote_versions where id = q.current_version_id;
  perform pg_temp.boom(format('select public.change_quote_draft_client_v1(%L, %s, null, null, %L, %L, %s, %L::jsonb, %L::jsonb)',
    qid, q.row_version, m_off, v.id, v.row_version, h, items), '22023', rejected);
  perform pg_temp.ok((select assigned_team_member_id = m_ok from public.quotes where id = qid), 'refused draft change keeps the assignee');

  -- 8. Catalog.
  reset role;
  perform pg_temp.ok((
    select count(*) = 2 from pg_trigger t
    where t.tgname in ('trg_orders_assignee_eligibility', 'trg_quotes_assignee_eligibility')
      and t.tgenabled = 'O' and not t.tgisinternal
      and t.tgfoid = 'public.tg_assignee_eligibility_guard()'::regprocedure
  ), 'both eligibility triggers are enabled');
  perform pg_temp.ok(not exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) as api(role)
    cross join (values ('public.team_member_is_assignable(uuid,uuid)'::regprocedure),
                       ('public.tg_assignee_eligibility_guard()'::regprocedure)) as f(oid)
    where has_function_privilege(api.role, f.oid, 'EXECUTE')
  ), 'no API role can execute the helper or the trigger function');
  perform pg_temp.ok((
    select p.prosecdef and p.proconfig @> array['search_path=""']
    from pg_proc p where p.oid = 'public.tg_assignee_eligibility_guard()'::regprocedure
  ), 'the trigger function is SECURITY DEFINER with an empty search_path');

  raise notice 'phase59 assignee eligibility: all assertions passed';
end $$;
rollback;
