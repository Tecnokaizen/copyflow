-- Operational Quotes access through real authenticated RLS and scoped RPCs.
-- All fixtures and mutations are rolled back; no tenant-specific business rules.
begin;

do $phase34$
declare
  tenant_a uuid := 'e3400000-0000-4000-8000-000000000011';
  tenant_b uuid := 'e3400000-0000-4000-8000-000000000012';
  actor uuid := 'e3400000-0000-4000-8000-000000000001';
  outsider uuid := 'e3400000-0000-4000-8000-000000000002';
  draft_a uuid;
  draft_b uuid;
  accepted_a uuid;
  quote_a uuid;
  quote_b uuid;
  other_quote uuid;
  client_b uuid;
  service_b uuid;
  member_b uuid;
  role_name text;
  enabled boolean;
  row_count integer;
  result jsonb;
  replay jsonb;
  err text;
  relation_name text;
  relation_id uuid;
begin
  insert into auth.users (id, email, raw_user_meta_data) values
    (actor, 'actor@phase34.test', '{}'::jsonb),
    (outsider, 'outsider@phase34.test', '{}'::jsonb);
  insert into public.profiles(id, full_name) values
    (actor, 'Operational actor'), (outsider, 'Other tenant');
  insert into public.tenants(id, name, slug, active) values
    (tenant_a, 'Phase34 A', 'phase34a', true),
    (tenant_b, 'Phase34 B', 'phase34b', true);
  insert into public.memberships(tenant_id, user_id, role, active) values
    (tenant_a, actor, 'owner', true), (tenant_b, outsider, 'owner', true);
  perform public.seed_quote_statuses(tenant_a);
  perform public.seed_quote_statuses(tenant_b);
  perform public.set_tenant_feature('phase34a', 'quotes', true, null);
  perform public.set_tenant_feature('phase34b', 'quotes', true, null);
  insert into public.order_statuses(tenant_id, name, code, is_initial, active) values
    (tenant_a, 'Received', 'received', true, true),
    (tenant_b, 'Received', 'received', true, true);
  select id into draft_a from public.quote_statuses where tenant_id = tenant_a and code = 'draft';
  select id into draft_b from public.quote_statuses where tenant_id = tenant_b and code = 'draft';
  select id into accepted_a from public.quote_statuses where tenant_id = tenant_a and code = 'accepted';
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into public.clients(tenant_id, name) values (tenant_b, 'Other client') returning id into client_b;
  insert into public.services(tenant_id, name) values (tenant_b, 'Other service') returning id into service_b;
  insert into public.team_members(tenant_id, name) values (tenant_b, 'Other member') returning id into member_b;

  perform set_config('request.jwt.claim.sub', outsider::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into public.quotes(tenant_id, description, status_id)
    values (tenant_b, 'Other tenant quote', draft_b) returning id into quote_b;
  perform set_config('request.jwt.claim.sub', actor::text, true);
  insert into public.quotes(tenant_id, description, status_id)
    values (tenant_a, 'Same tenant other quote', draft_a) returning id into other_quote;

  -- Each role exercises actual table/RPC permissions, both ON and OFF.
  foreach role_name in array array['owner', 'admin', 'manager', 'staff', 'viewer'] loop
    update public.memberships set role = role_name where tenant_id = tenant_a and user_id = actor;
    foreach enabled in array array[true, false] loop
      perform public.set_tenant_feature('phase34a', 'quotes', enabled, null);
      execute 'set local role authenticated';
      if enabled and role_name <> 'viewer' then
        insert into public.quotes(tenant_id, title, description, notes, valid_until, status_id)
          values (tenant_a, 'Quote title', 'Operational quote', 'Initial notes', '2026-12-31', draft_a)
          returning id into quote_a;
        if not exists(select 1 from public.quotes where id = quote_a and row_version = 0) then
          raise exception 'phase34: % cannot read its created quote', role_name;
        end if;
        update public.quotes set description = 'Updated', notes = 'Updated notes'
          where id = quote_a and row_version = 0;
        get diagnostics row_count = row_count;
        if row_count <> 1 then raise exception 'phase34: % cannot update', role_name; end if;
        update public.quotes set notes = 'Stale write' where id = quote_a and row_version = 0;
        get diagnostics row_count = row_count;
        if row_count <> 0 then raise exception 'phase34: stale write succeeded'; end if;
        update public.quotes set status_id = accepted_a where id = quote_a and row_version = 1;
        get diagnostics row_count = row_count;
        if row_count <> 1 then raise exception 'phase34: % cannot change status', role_name; end if;
        if not exists(select 1 from public.quotes where id = quote_a and row_version = 2 and status_id = accepted_a) then
          raise exception 'phase34: status/version not persisted';
        end if;
        result := public.convert_quote_to_order(quote_a);
        replay := public.convert_quote_to_order(quote_a);
        if result->>'ok' is distinct from 'true' or result->>'created' is distinct from 'true'
          or replay->>'created' is distinct from 'false'
          or result->>'order_id' is distinct from replay->>'order_id' then
          raise exception 'phase34: % conversion/idempotence failed: % / %', role_name, result, replay;
        end if;
        if not exists(select 1 from public.orders where id = (result->>'order_id')::uuid
          and tenant_id = tenant_a and title = 'Quote title' and description = 'Updated'
          and notes = 'Updated notes' and created_by = actor and priority = 'normal'
          and due_at is null and metadata->>'quote_id' = quote_a::text) then
          raise exception 'phase34: % conversion changed order payload', role_name;
        end if;
        select count(*) into row_count from public.list_quote_activity(quote_a);
        if row_count <> 4 then
          raise exception 'phase34: % expected exactly create/update/status/convert events, got %', role_name, row_count;
        end if;
        if (select count(distinct action) from public.list_quote_activity(quote_a)
            where action in ('quote.created', 'quote.updated', 'quote.status_changed', 'quote.converted')
              and entity_id = quote_a and entity_type = 'quote' and user_id = actor) <> 4 then
          raise exception 'phase34: % lifecycle history incomplete or unscoped', role_name;
        end if;
      else
        if exists(select 1 from public.quotes where tenant_id = tenant_a) then
          raise exception 'phase34: % feature % can read', role_name, enabled;
        end if;
        err := null;
        begin
          insert into public.quotes(tenant_id, description, status_id) values (tenant_a, 'Denied', draft_a);
        exception when insufficient_privilege then err := sqlstate;
        end;
        if err is distinct from '42501' then raise exception 'phase34: denied insert succeeded'; end if;
        update public.quotes set notes = 'Denied' where id = other_quote;
        get diagnostics row_count = row_count;
        if row_count <> 0 then raise exception 'phase34: denied update succeeded'; end if;
        update public.quotes set status_id = accepted_a where id = other_quote;
        get diagnostics row_count = row_count;
        if row_count <> 0 then raise exception 'phase34: denied status succeeded'; end if;
        -- Check authorization before idempotent replay as well as fresh conversion.
        foreach relation_id in array array[other_quote, quote_a] loop
          if public.convert_quote_to_order(relation_id)->>'error' is distinct from 'not_found' then
            raise exception 'phase34: denied conversion leaked';
          end if;
          if exists(select 1 from public.list_quote_activity(relation_id)) then
            raise exception 'phase34: denied activity leaked';
          end if;
        end loop;
      end if;
      execute 'reset role';
    end loop;
  end loop;

  update public.memberships set role = 'staff' where tenant_id = tenant_a and user_id = actor;
  perform public.set_tenant_feature('phase34a', 'quotes', true, null);
  -- Include decoys with the same entity UUID but wrong type/tenant; RPC must filter all three.
  insert into public.activity_log(tenant_id, action, entity_type, entity_id) values
    (tenant_b, 'decoy', 'quote', quote_a), (tenant_a, 'decoy', 'order', quote_a);
  execute 'set local role authenticated';
  if exists(select 1 from public.list_quote_activity(quote_a) where action = 'decoy') then
    raise exception 'phase34: scoped activity leaked wrong entity type or tenant';
  end if;
  if exists(select 1 from public.quotes where id = quote_b) then
    raise exception 'phase34: staff cross-tenant SELECT';
  end if;
  update public.quotes set notes = 'Foreign write' where id = quote_b;
  get diagnostics row_count = row_count;
  if row_count <> 0 then raise exception 'phase34: staff cross-tenant UPDATE'; end if;
  update public.quotes set status_id = draft_b where id = quote_b;
  get diagnostics row_count = row_count;
  if row_count <> 0 then raise exception 'phase34: staff cross-tenant status'; end if;
  err := null;
  begin
    insert into public.quotes(tenant_id, description, status_id) values (tenant_b, 'Foreign insert', draft_b);
  exception when insufficient_privilege then err := sqlstate;
  end;
  if err is distinct from '42501' then raise exception 'phase34: staff cross-tenant INSERT'; end if;
  if public.convert_quote_to_order(quote_b)->>'error' is distinct from 'not_found'
     or exists(select 1 from public.list_quote_activity(quote_b)) then
    raise exception 'phase34: staff cross-tenant RPC';
  end if;
  if exists(select 1 from public.list_quote_activity(null))
     or exists(select 1 from public.list_quote_activity('e3400000-0000-4000-8000-000000000099')) then
    raise exception 'phase34: missing/null quote leaked history';
  end if;

  -- Foreign references and protected columns stay closed for staff.
  for relation_name, relation_id in
    select * from (values ('client_id', client_b), ('service_id', service_b),
      ('assigned_team_member_id', member_b), ('status_id', draft_b)) as refs(name, id)
  loop
    err := null;
    begin
      execute format('update public.quotes set %I = $1 where id = $2', relation_name)
        using relation_id, other_quote;
    exception when foreign_key_violation then err := sqlstate;
    end;
    if err is distinct from '23503' then raise exception 'phase34: foreign reference % allowed', relation_name; end if;
  end loop;
  foreach relation_name in array array['tenant_id', 'converted_order_id'] loop
    err := null;
    begin
      execute format('update public.quotes set %I = $1 where id = $2', relation_name) using tenant_b, other_quote;
    exception when insufficient_privilege then err := sqlstate;
    end;
    if err is distinct from '42501' then raise exception 'phase34: protected column % allowed', relation_name; end if;
  end loop;
  -- Quotes has no DELETE contract: do not add deletion privileges with operational access.
  err := null;
  begin delete from public.quotes where id = other_quote;
  exception when insufficient_privilege then err := sqlstate;
  end;
  if err is distinct from '42501' then raise exception 'phase34: DELETE unexpectedly granted'; end if;

  if exists(select 1 from public.activity_log where tenant_id = tenant_a) then
    raise exception 'phase34: staff obtained global activity_log SELECT';
  end if;
  err := null;
  begin perform public.list_activity_log(tenant_a);
  exception when insufficient_privilege then err := sqlstate;
  end;
  if err is distinct from '42501' then raise exception 'phase34: staff obtained global Activity RPC'; end if;

  -- The RPC always enforces the bound even when called directly.
  for row_count in 1..55 loop
    update public.quotes set notes = 'History event ' || row_count where id = other_quote;
  end loop;
  if (select count(*) from public.list_quote_activity(other_quote)) <> 50 then
    raise exception 'phase34: activity is not bounded to 50';
  end if;
  if exists(select 1 from public.list_quote_activity(other_quote) where entity_id <> other_quote) then
    raise exception 'phase34: another same-tenant quote leaked';
  end if;
  if (select array_agg(id) from public.list_quote_activity(other_quote)) is distinct from
     (select array_agg(id order by created_at desc, id desc) from public.list_quote_activity(other_quote)) then
    raise exception 'phase34: unstable activity ordering';
  end if;
  execute 'reset role';

  -- An inactive membership, inactive tenant and missing auth must fail closed.
  update public.memberships set active = false where tenant_id = tenant_a and user_id = actor;
  execute 'set local role authenticated';
  if exists(select 1 from public.list_quote_activity(other_quote))
     or exists(select 1 from public.quotes where tenant_id = tenant_a)
     or public.convert_quote_to_order(other_quote)->>'error' is distinct from 'not_found' then
    raise exception 'phase34: inactive membership permitted';
  end if;
  execute 'reset role';
  update public.memberships set active = true where tenant_id = tenant_a and user_id = actor;
  perform set_config('request.jwt.claim.sub', '', true);
  update public.tenants set active = false where id = tenant_a;
  perform set_config('request.jwt.claim.sub', actor::text, true);
  execute 'set local role authenticated';
  if exists(select 1 from public.list_quote_activity(other_quote)) then
    raise exception 'phase34: inactive tenant permitted';
  end if;
  perform set_config('request.jwt.claim.sub', '', true);
  if exists(select 1 from public.list_quote_activity(other_quote)) then
    raise exception 'phase34: missing auth permitted';
  end if;
  execute 'reset role';
  if has_function_privilege('anon', 'public.list_quote_activity(uuid)', 'EXECUTE') then
    raise exception 'phase34: anonymous execute granted';
  end if;
end;
$phase34$;
rollback;
