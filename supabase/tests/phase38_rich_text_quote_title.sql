-- Rich Text V1: quote conversion keeps HTML on the order and a plain title.

begin;
\i supabase/tests/helpers/accepted_quote_fixture.sql

do $phase38$
declare
  v_owner uuid := 'e3800000-0000-4000-8000-000000000001';
  v_tenant uuid := 'e3800000-0000-4000-8000-000000000011';
  v_draft uuid;
  v_rich uuid;
  v_titled uuid;
  v_empty uuid;
  v_convert jsonb;
  v_order_title text;
  v_order_description text;
  v_order_notes text;
  v_constraint text;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values (
    v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'owner@phase38.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  );

  insert into public.profiles (id, full_name) values (v_owner, 'Owner 38');
  insert into public.tenants (id, name, slug, active) values
    (v_tenant, 'Phase38', 'phase38', true);
  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant, v_owner, 'owner', true);
  select pg_get_constraintdef(oid)
  into v_constraint
  from pg_constraint
  where conname = 'quotes_description_not_blank';
  if v_constraint is null
     or position('btrim' in v_constraint) = 0
     or position('~' in v_constraint) > 0
     or position('regexp' in lower(v_constraint)) > 0 then
    raise exception 'phase38: description check must stay a plain length check: %', v_constraint;
  end if;

  perform public.seed_quote_statuses(v_tenant);
  perform public.set_tenant_feature('phase38', 'quotes', true, null);
  insert into public.order_statuses (
    tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values
    (v_tenant, 'Recibido', 'received', true, false, false, false, true, 1);

  select id into v_draft
  from public.quote_statuses
  where tenant_id = v_tenant and code = 'draft';

  execute 'set local role authenticated';
  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  insert into public.quotes (tenant_id, description, notes, status_id)
  values (
    v_tenant,
    '<p>Tarjetas <strong>mate</strong></p><p>Segunda línea</p>',
    '<p>Nota <em>interna</em></p>',
    v_draft
  )
  returning id into v_rich;

  perform pg_temp.accepted_quote_fixture(v_rich);
  v_convert := public.convert_quote_to_order(v_rich,null,null,null,'normal',null,(select row_version from public.quotes where id=v_rich));
  if (v_convert ->> 'ok')::boolean is not true then
    raise exception 'phase38: rich conversion failed %', v_convert;
  end if;

  select title, description, notes
  into v_order_title, v_order_description, v_order_notes
  from public.orders
  where id = (v_convert ->> 'order_id')::uuid;

  if v_order_title is distinct from 'Tarjetas mate Segunda línea' then
    raise exception 'phase38: title kept markup %', v_order_title;
  end if;
  if v_order_description is distinct from '<p>Tarjetas <strong>mate</strong></p><p>Segunda línea</p>' then
    raise exception 'phase38: description was not preserved %', v_order_description;
  end if;
  if v_order_notes is not null then
    raise exception 'phase38: internal notes must not be copied %', v_order_notes;
  end if;
  if position('<' in v_order_title) > 0 then
    raise exception 'phase38: title contains HTML %', v_order_title;
  end if;

  insert into public.quotes (tenant_id, title, description, status_id)
  values (v_tenant, 'Nombre fijo', '<p>Ignorar <strong>esto</strong></p>', v_draft)
  returning id into v_titled;

  perform pg_temp.accepted_quote_fixture(v_titled);
  v_convert := public.convert_quote_to_order(v_titled,null,null,null,'normal',null,(select row_version from public.quotes where id=v_titled));
  select title into v_order_title
  from public.orders
  where id = (v_convert ->> 'order_id')::uuid;
  if v_order_title is distinct from 'Nombre fijo' then
    raise exception 'phase38: explicit title was replaced %', v_order_title;
  end if;

  insert into public.quotes (tenant_id, description, status_id)
  values (v_tenant, '<p><br></p>', v_draft)
  returning id into v_empty;

  perform pg_temp.accepted_quote_fixture(v_empty);
  v_convert := public.convert_quote_to_order(v_empty,null,null,null,'normal',null,(select row_version from public.quotes where id=v_empty));
  if v_convert ->> 'error' is distinct from 'invalid' then
    raise exception 'phase38: empty rich description should be invalid %', v_convert;
  end if;
end;
$phase38$;

rollback;
