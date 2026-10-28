-- Local only. SUR4 E5 + E7: the four A1 features are independent per tenant
-- (contract §11 matrix, T1, T2, T4, T9, T10). Four tenants: base (nothing),
-- post-its only, sequence only and «SUR4» (everything). Rollback-only.
begin;

create function pg_temp.ok(p boolean, label text) returns void language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase62 isolation: %', label;
  end if;
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

do $$
declare
  -- owners
  u_base uuid := 'e6200000-0000-4000-8000-000000000001';
  u_notes uuid := 'e6200000-0000-4000-8000-000000000002';
  u_seq uuid := 'e6200000-0000-4000-8000-000000000003';
  u_sur4 uuid := 'e6200000-0000-4000-8000-000000000004';
  -- tenants
  t_base uuid := 'e6200000-0000-4000-8000-000000000011';
  t_notes uuid := 'e6200000-0000-4000-8000-000000000012';
  t_seq uuid := 'e6200000-0000-4000-8000-000000000013';
  t_sur4 uuid := 'e6200000-0000-4000-8000-000000000014';
  tids uuid[];
  owners uuid[];
  slugs text[] := array['phase62base', 'phase62notes', 'phase62seq', 'phase62sur4'];
  has_notes boolean[] := array[false, true, false, true];
  has_seq boolean[] := array[false, false, true, true];
  has_ficha boolean[] := array[false, false, false, true];
  ords uuid[] := array[
    'e6200000-0000-4000-8000-000000000041'::uuid, 'e6200000-0000-4000-8000-000000000042'::uuid,
    'e6200000-0000-4000-8000-000000000043'::uuid, 'e6200000-0000-4000-8000-000000000044'::uuid
  ];
  mids uuid[] := array[
    'e6200000-0000-4000-8000-000000000031'::uuid, 'e6200000-0000-4000-8000-000000000032'::uuid,
    'e6200000-0000-4000-8000-000000000033'::uuid, 'e6200000-0000-4000-8000-000000000034'::uuid
  ];
  st uuid;
  r jsonb;
  stage uuid;
  i integer;
  j integer;
  log_before integer;
begin
  tids := array[t_base, t_notes, t_seq, t_sur4];
  owners := array[u_base, u_notes, u_seq, u_sur4];

  for i in 1..4 loop
    insert into auth.users (id, email, raw_user_meta_data) values (owners[i], slugs[i] || '@phase62.test', '{}');
    insert into public.profiles (id, full_name) values (owners[i], 'Owner ' || slugs[i]);
    insert into public.tenants (id, name, slug, active) values (tids[i], slugs[i], slugs[i], true);
    insert into public.memberships (tenant_id, user_id, role, active) values (tids[i], owners[i], 'owner', true);
    st := gen_random_uuid();
    insert into public.order_statuses (id, tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled)
      values (st, tids[i], 'Recibido', 'received', true, 1, true, false, false, false);
    perform pg_temp.as_user(owners[i]);
    insert into public.team_members (id, tenant_id, name, active, can_receive_orders) values (mids[i], tids[i], 'Persona ' || i, true, true);
    insert into public.orders (id, tenant_id, title, status_id, created_by, notes)
      values (ords[i], tids[i], 'Pedido ' || slugs[i], st, owners[i], '<p>TESTIGO-NOTAS-PEDIDO</p>');
    if has_notes[i] then
      perform public.set_tenant_feature(slugs[i], 'order_sticky_notes', true, null);
    end if;
    if has_seq[i] then
      perform public.set_tenant_feature(slugs[i], 'order_work_sequence', true, null);
    end if;
    if has_ficha[i] then
      perform public.set_tenant_feature(slugs[i], 'order_custom_labels', true, null);
      perform public.set_tenant_feature(slugs[i], 'order_work_sheet_ficha', true, null);
    end if;
  end loop;

  -- T4/T10: each tenant has exactly its grants, nothing leaks to the others.
  perform pg_temp.as_postgres();
  for i in 1..4 loop
    perform pg_temp.ok(public.tenant_has_feature(tids[i], 'order_sticky_notes') = has_notes[i], slugs[i] || ': order_sticky_notes');
    perform pg_temp.ok(public.tenant_has_feature(tids[i], 'order_work_sequence') = has_seq[i], slugs[i] || ': order_work_sequence');
    perform pg_temp.ok(public.tenant_has_feature(tids[i], 'order_custom_labels') = has_ficha[i], slugs[i] || ': order_custom_labels');
    perform pg_temp.ok(public.tenant_has_feature(tids[i], 'order_work_sheet_ficha') = has_ficha[i], slugs[i] || ': order_work_sheet_ficha');
  end loop;

  -- Each owner uses what their tenant has, and only that.
  for i in 1..4 loop
    perform pg_temp.as_user(owners[i]);
    set local role authenticated;

    r := public.create_order_note_v1(ords[i], '<p>TESTIGO-POSTIT-INTERNO ' || slugs[i] || '</p>');
    perform pg_temp.ok(pg_temp.err(r) = case when has_notes[i] then 'ok' else 'not_found' end, slugs[i] || ': post-its ' || r::text);

    r := public.upsert_work_stage_v1(tids[i], null, 'Diseño', 'design');
    perform pg_temp.ok(pg_temp.err(r) = case when has_seq[i] then 'ok' else 'not_found' end, slugs[i] || ': stages ' || r::text);
    stage := (r->'stage'->>'id')::uuid;
    if has_seq[i] then
      r := public.replace_order_work_steps_v1(ords[i], pg_temp.rv(ords[i])::text,
        jsonb_build_array(jsonb_build_object('stage_id', stage, 'team_member_id', mids[i])));
      perform pg_temp.ok(pg_temp.err(r) = 'ok', slugs[i] || ': steps ' || r::text);
    end if;
    perform pg_temp.ok(pg_temp.err(public.team_work_load_v1(tids[i])) = case when has_seq[i] then 'ok' else 'not_found' end, slugs[i] || ': load');

    reset role;
  end loop;

  -- T1/T2: every owner reads only their own rows and cannot reach the others.
  for i in 1..4 loop
    perform pg_temp.as_user(owners[i]);
    set local role authenticated;
    perform pg_temp.ok((select count(*) from public.order_notes) = case when has_notes[i] then 1 else 0 end, slugs[i] || ': reads own notes only');
    perform pg_temp.ok((select count(*) from public.order_note_events where tenant_id <> tids[i]) = 0, slugs[i] || ': no foreign events');
    perform pg_temp.ok((select count(*) from public.order_work_steps) = case when has_seq[i] then 1 else 0 end, slugs[i] || ': reads own steps only');
    perform pg_temp.ok((select count(*) from public.work_stages where tenant_id <> tids[i]) = 0, slugs[i] || ': no foreign stages');
    for j in 1..4 loop
      if j <> i then
        perform pg_temp.ok(pg_temp.err(public.create_order_note_v1(ords[j], '<p>x</p>')) = 'not_found', slugs[i] || ' → ' || slugs[j] || ': note');
        perform pg_temp.ok(pg_temp.err(public.replace_order_work_steps_v1(ords[j], pg_temp.rv(ords[j])::text, '[]')) = 'not_found', slugs[i] || ' → ' || slugs[j] || ': steps');
        perform pg_temp.ok(pg_temp.err(public.team_work_load_v1(tids[j])) = 'not_found', slugs[i] || ' → ' || slugs[j] || ': load');
        perform pg_temp.ok(pg_temp.err(public.upsert_work_stage_v1(tids[j], null, 'Intrusa', 'design')) = 'not_found', slugs[i] || ' → ' || slugs[j] || ': stage');
      end if;
    end loop;
    -- T9: activity of the new features only in the own tenant, never with text.
    perform pg_temp.ok((
      select count(*) from public.activity_log
      where (action like 'order.note%' or action like 'order.work_step%')
        and tenant_id <> tids[i]
    ) = 0, slugs[i] || ': no foreign activity');
    reset role;
  end loop;

  perform pg_temp.ok(not exists (
    select 1 from public.activity_log
    where tenant_id = any (tids)
      and (action like 'order.note%' or action like 'order.work_step%')
      and (previous_values::text like '%TESTIGO%' or new_values::text like '%TESTIGO%' or metadata::text like '%TESTIGO%')
  ), 'T9: no note text in the activity');

  -- Base tenant: nothing new anywhere, legacy notes untouched.
  perform pg_temp.ok((select notes = '<p>TESTIGO-NOTAS-PEDIDO</p>' from public.orders where id = ords[1]), 'base: legacy notes untouched');
  perform pg_temp.ok(not exists (select 1 from public.order_notes where tenant_id = t_base), 'base: no post-its');
  perform pg_temp.ok(not exists (select 1 from public.order_work_steps where tenant_id = t_base), 'base: no steps');
  perform pg_temp.ok(not exists (select 1 from public.work_stages where tenant_id = t_base), 'base: no stages');

  -- Granting one feature to «SUR4» again changes nothing for the others.
  perform pg_temp.as_postgres();
  log_before := (select count(*) from public.tenant_feature_overrides where tenant_id <> t_sur4 and tenant_id = any (tids));
  perform public.set_tenant_feature('phase62sur4', 'order_work_sequence', false, null);
  perform public.set_tenant_feature('phase62sur4', 'order_work_sequence', true, null);
  perform pg_temp.ok((select count(*) from public.tenant_feature_overrides where tenant_id <> t_sur4 and tenant_id = any (tids)) = log_before, 'regranting SUR4 leaves the others alone');
  perform pg_temp.ok(not public.tenant_has_feature(t_notes, 'order_work_sequence') and not public.tenant_has_feature(t_seq, 'order_sticky_notes'), 'post-its and sequence stay independent');

  raise notice 'phase62 order features isolation PASS';
end $$;

rollback;
