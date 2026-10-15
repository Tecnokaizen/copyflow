-- Quotes → orders: the order's internal notes inherit the quote notes (#102).
-- Synthetic fixtures through authenticated RLS; everything is rolled back.
begin;
\i supabase/tests/helpers/accepted_quote_fixture.sql

do $phase49$
declare
  tenant_a uuid := 'e4900000-0000-4000-8000-000000000011';
  actor uuid := 'e4900000-0000-4000-8000-000000000001';
  draft_a uuid;
  q_both uuid;
  q_empty uuid;
  q_internal uuid;
  r jsonb;
  replay jsonb;
  ref text;
  expected text;
  order_notes text;
begin
  insert into auth.users (id, email, raw_user_meta_data) values (actor, 'actor@phase49.test', '{}'::jsonb);
  insert into public.profiles (id, full_name) values (actor, 'Actor');
  insert into public.tenants (id, name, slug, active) values (tenant_a, 'Phase49 A', 'phase49a', true);
  insert into public.memberships (tenant_id, user_id, role, active) values (tenant_a, actor, 'staff', true);
  perform public.seed_quote_statuses(tenant_a);
  perform public.set_tenant_feature('phase49a', 'quotes', true, null);
  insert into public.order_statuses (tenant_id, name, code, is_initial, active)
    values (tenant_a, 'Received', 'received', true, true);
  select id into draft_a from public.quote_statuses where tenant_id = tenant_a and code = 'draft';

  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  execute 'set local role authenticated';

  insert into public.quotes (tenant_id, title, description, notes, status_id)
    values (tenant_a, 'Con notas', '<p>Producción: 50 copias</p>', '<p>Entrega en <strong>sobre</strong></p>', draft_a)
    returning id, reference into q_both, ref;
  r := public.update_quote_internal_notes(q_both, E'Cliente <VIP> & urgente\nLlamar antes',
    (select row_version::text from public.quotes where id = q_both));
  if r ->> 'ok' is distinct from 'true' then raise exception 'phase49: internal notes not saved: %', r; end if;
  insert into public.quotes (tenant_id, title, description, notes, status_id)
    values (tenant_a, 'Sin notas', '<p>Sin notas</p>', '<p></p>', draft_a) returning id into q_empty;
  insert into public.quotes (tenant_id, title, description, status_id)
    values (tenant_a, 'Solo internas', '<p>Solo internas</p>', draft_a) returning id into q_internal;
  r := public.update_quote_internal_notes(q_internal, 'Solo para el equipo',
    (select row_version::text from public.quotes where id = q_internal));

  perform pg_temp.accepted_quote_fixture(q_both);
  perform pg_temp.accepted_quote_fixture(q_empty);
  perform pg_temp.accepted_quote_fixture(q_internal);

  -- Both blocks, labelled, rich text kept, plain text escaped with line breaks.
  r := public.convert_quote_to_order(q_both, null, null, null, 'normal', null,
    (select row_version from public.quotes where id = q_both));
  if r ->> 'ok' is distinct from 'true' then raise exception 'phase49: conversion failed: %', r; end if;
  expected := '<p><strong>Notas del presupuesto ' || ref || '</strong></p><p>Entrega en <strong>sobre</strong></p>'
    || '<p><strong>Notas internas del presupuesto ' || ref || '</strong></p>'
    || '<p>Cliente &lt;VIP&gt; &amp; urgente<br>Llamar antes</p>';
  select notes into order_notes from public.orders where id = (r ->> 'order_id')::uuid;
  if order_notes is distinct from expected then
    raise exception 'phase49: unexpected order notes: %', order_notes;
  end if;
  -- Notes never reach customer-facing order fields.
  if exists (select 1 from public.orders where id = (r ->> 'order_id')::uuid
             and (description like '%urgente%' or description like '%sobre%' or title like '%urgente%')) then
    raise exception 'phase49: quote notes leaked into a customer-facing order field';
  end if;

  -- Idempotent replay: same order, notes untouched, quote unchanged.
  replay := public.convert_quote_to_order(q_both, null, null, null, 'normal', null,
    (select row_version from public.quotes where id = q_both));
  if replay ->> 'replayed' is distinct from 'true' or replay ->> 'order_id' is distinct from r ->> 'order_id'
     or (select notes from public.orders where id = (r ->> 'order_id')::uuid) is distinct from expected
     or (select count(*) from public.orders where tenant_id = tenant_a and metadata ->> 'quote_id' = q_both::text) <> 1 then
    raise exception 'phase49: replay duplicated or rewrote the order';
  end if;
  if (select notes from public.quotes where id = q_both) is distinct from '<p>Entrega en <strong>sobre</strong></p>'
     or (select internal_notes from public.quotes where id = q_both) is distinct from E'Cliente <VIP> & urgente\nLlamar antes' then
    raise exception 'phase49: the quote was modified';
  end if;

  -- Empty rich text and no internal notes → NULL, as before.
  r := public.convert_quote_to_order(q_empty, null, null, null, 'normal', null,
    (select row_version from public.quotes where id = q_empty));
  if (select notes from public.orders where id = (r ->> 'order_id')::uuid) is not null then
    raise exception 'phase49: empty notes must stay NULL';
  end if;

  -- Only internal notes → only that block.
  r := public.convert_quote_to_order(q_internal, null, null, null, 'normal', null,
    (select row_version from public.quotes where id = q_internal));
  select reference into ref from public.quotes where id = q_internal;
  if (select notes from public.orders where id = (r ->> 'order_id')::uuid)
     is distinct from '<p><strong>Notas internas del presupuesto ' || ref || '</strong></p><p>Solo para el equipo</p>' then
    raise exception 'phase49: internal-only notes not inherited as expected';
  end if;
  execute 'reset role';
end;
$phase49$;
rollback;
