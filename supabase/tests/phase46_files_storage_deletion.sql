-- Files V1.1 · recoverable R2 deletion outbox (20261014120000_files_storage_deletions_v1.sql)
-- Local only. Fixtures, secret and mutations roll back.
-- Concurrency interleavings live in phase46_files_storage_deletion_concurrency.sh.

begin;

create function pg_temp.ok(p boolean, label text) returns void
language plpgsql as $$
begin
  if p is distinct from true then
    raise exception 'phase46 FAIL: %', label;
  end if;
end $$;

create function pg_temp.fails(statement text, expected_state text, expected_message text default null)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if sqlstate = expected_state
       and (expected_message is null or position(expected_message in sqlerrm) > 0) then
      return;
    end if;
    raise exception 'phase46 FAIL: expected % (%), got % (%): %',
      expected_state, coalesce(expected_message, '*'), sqlstate, sqlerrm, statement;
  end;
  raise exception 'phase46 FAIL: unexpectedly succeeded: %', statement;
end $$;

create function pg_temp.osig(purpose text, actor uuid, tenant uuid, parent uuid, file uuid, issued bigint)
returns text language sql as $$
  select encode(extensions.hmac(convert_to(
    'files-v1|' || purpose || '|' || actor || '|' || tenant || '|' || parent || '|' || file || '|' || issued,
    'UTF8'), convert_to('phase46-files-signing-secret-32-chars!!', 'UTF8'), 'sha256'), 'hex')
$$;

create function pg_temp.qsig(purpose text, actor uuid, tenant uuid, parent uuid, file uuid, issued bigint)
returns text language sql as $$
  select encode(extensions.hmac(convert_to(
    'files-v1-quote|' || purpose || '|' || actor || '|' || tenant || '|' || parent || '|' || file || '|' || issued,
    'UTF8'), convert_to('phase46-files-signing-secret-32-chars!!', 'UTF8'), 'sha256'), 'hex')
$$;

create function pg_temp.as_user(p_user uuid) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', p_user::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $$;

create function pg_temp.as_service() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
end $$;

create function pg_temp.as_postgres() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $$;

-- Order file through the real create/complete RPCs (ready unless p_complete=false).
create function pg_temp.order_file(actor uuid, tenant uuid, ord uuid, file uuid, p_complete boolean default true)
returns void language plpgsql as $$
declare issued bigint := extract(epoch from now())::bigint;
begin
  perform pg_temp.as_user(actor);
  perform public.create_order_file_upload(ord, file, 'doc.pdf', 'application/pdf', 100,
    now() + interval '15 minutes', issued, pg_temp.osig('create', actor, tenant, ord, file, issued));
  if p_complete then
    perform public.complete_order_file_upload(ord, file, '"etag"', issued,
      pg_temp.osig('complete', actor, tenant, ord, file, issued));
  end if;
  perform pg_temp.as_postgres();
end $$;

-- Test-only inspector (runs as postgres so it can be used under any role).
create function pg_temp.task(file uuid) returns files_private.storage_deletions
language sql security definer set search_path = '' as $$
  select * from files_private.storage_deletions where file_id = file order by requested_at desc, id limit 1
$$;

do $phase46$
declare
  owner_a uuid := 'e4600000-0000-4000-8000-000000000001';
  staff_a uuid := 'e4600000-0000-4000-8000-000000000002';
  viewer_a uuid := 'e4600000-0000-4000-8000-000000000003';
  owner_b uuid := 'e4600000-0000-4000-8000-000000000004';
  ta uuid := 'e4600000-0000-4000-8000-000000000011';
  tb uuid := 'e4600000-0000-4000-8000-000000000012';
  st_a uuid := 'e4600000-0000-4000-8000-000000000021';
  st_closed uuid := 'e4600000-0000-4000-8000-000000000022';
  sv_a uuid := 'e4600000-0000-4000-8000-000000000031';
  ord uuid := 'e4600000-0000-4000-8000-000000000061';
  ord_arch uuid := 'e4600000-0000-4000-8000-000000000062';
  f_ready uuid := 'e4600000-0000-4000-8000-000000000071';
  f_pending uuid := 'e4600000-0000-4000-8000-000000000072';
  f_arch uuid := 'e4600000-0000-4000-8000-000000000073';
  f_expired uuid := 'e4600000-0000-4000-8000-000000000074';
  f_fresh uuid := 'e4600000-0000-4000-8000-000000000075';
  f_badkey uuid := 'e4600000-0000-4000-8000-000000000076';
  f_legacy uuid := 'e4600000-0000-4000-8000-000000000077';
  f_live uuid := 'e4600000-0000-4000-8000-000000000078';
  f_retry uuid := 'e4600000-0000-4000-8000-000000000079';
  f_max uuid := 'e4600000-0000-4000-8000-00000000007a';
  f_abandon uuid := 'e4600000-0000-4000-8000-00000000007b';
  q uuid; v uuid;
  q_ordinary uuid := 'e4600000-0000-4000-8000-000000000081';
  q_pdf uuid := 'e4600000-0000-4000-8000-000000000082';
  q_pdf_expired uuid := 'e4600000-0000-4000-8000-000000000083';
  issued bigint := extract(epoch from now())::bigint;
  r jsonb; r2 jsonb; claims jsonb; token uuid; old_token uuid; outcome text;
  t files_private.storage_deletions;
  n integer;
begin
  if exists (select 1 from vault.secrets where name = 'files_signing_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'files_signing_secret' limit 1),
      'phase46-files-signing-secret-32-chars!!');
  else
    perform vault.create_secret('phase46-files-signing-secret-32-chars!!', 'files_signing_secret');
  end if;

  insert into auth.users (id, email, raw_user_meta_data) values
    (owner_a, 'owner-a@phase46.test', '{}'), (staff_a, 'staff-a@phase46.test', '{}'),
    (viewer_a, 'viewer-a@phase46.test', '{}'), (owner_b, 'owner-b@phase46.test', '{}');
  insert into public.profiles (id, full_name) values
    (owner_a, 'Owner A'), (staff_a, 'Staff A'), (viewer_a, 'Viewer A'), (owner_b, 'Owner B');
  insert into public.tenants (id, name, slug, active) values
    (ta, 'Phase46 A', 'phase46a', true), (tb, 'Phase46 B', 'phase46b', true);
  -- S2: explicit storage capacity (a tenant without subscription has 0 bytes).
  insert into public.subscriptions (tenant_id, plan_id, provider, status)
  select fx.tid, pl.id, 'internal', 'active'
  from (values (ta), (tb)) as fx(tid) cross join public.plans pl where pl.code = 'basic';
  insert into public.memberships (tenant_id, user_id, role, active) values
    (ta, owner_a, 'owner', true), (ta, staff_a, 'staff', true),
    (ta, viewer_a, 'viewer', true), (tb, owner_b, 'owner', true);
  insert into public.tenant_settings (tenant_id, business_name, preferences)
    values (ta, 'Seller A', '{}'), (tb, 'Seller B', '{}');

  perform pg_temp.as_user(owner_a);
  insert into public.order_statuses (id, tenant_id, name, code, active, sort_order, is_initial, is_ready, is_closed, is_cancelled)
    values (st_a, ta, 'Recibido', 'received', true, 1, true, false, false, false),
           (st_closed, ta, 'Entregado', 'delivered', true, 2, false, false, true, false);
  insert into public.services (id, tenant_id, name, active, sort_order) values (sv_a, ta, 'Servicio', true, 1);
  insert into public.orders (id, tenant_id, title, service_id, status_id, created_by) values
    (ord, ta, 'Pedido', sv_a, st_a, owner_a),
    (ord_arch, ta, 'Archivado', sv_a, st_closed, owner_a);
  perform pg_temp.as_postgres();

  perform pg_temp.order_file(staff_a, ta, ord, f_ready);
  perform pg_temp.order_file(staff_a, ta, ord, f_pending, false);
  perform pg_temp.order_file(staff_a, ta, ord_arch, f_arch);
  perform pg_temp.as_user(owner_a);
  perform public.archive_order(ord_arch, ta);
  perform pg_temp.as_postgres();

  -- ----------------------------------------------------------------- grants
  perform pg_temp.ok(not has_schema_privilege('service_role', 'files_private', 'USAGE'), 'service_role has no files_private usage');
  perform pg_temp.ok(not has_table_privilege('authenticated', 'files_private.storage_deletions', 'SELECT'), 'authenticated cannot read outbox');
  perform pg_temp.ok(not has_table_privilege('service_role', 'files_private.storage_deletions', 'SELECT'), 'service_role cannot read outbox directly');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.claim_storage_deletion(uuid,integer)', 'EXECUTE'), 'authenticated cannot claim');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.finish_storage_deletion(uuid,uuid,text,text)', 'EXECUTE'), 'anon cannot finish');
  perform pg_temp.ok(not has_function_privilege('authenticated', 'public.claim_expired_file_uploads(integer)', 'EXECUTE'), 'authenticated cannot purge');
  perform pg_temp.ok(not has_function_privilege('service_role', 'public.requeue_storage_deletion(uuid,text)', 'EXECUTE'), 'service_role cannot requeue');
  perform pg_temp.ok(has_function_privilege('service_role', 'public.finish_storage_deletion(uuid,uuid,text,text)', 'EXECUTE'), 'service_role can finish');
  perform pg_temp.ok(not has_function_privilege('anon', 'public.soft_delete_order_file(uuid,uuid,bigint,text)', 'EXECUTE'), 'anon cannot delete');
  perform pg_temp.ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.finish_storage_deletion(uuid,uuid,text,text)'::regprocedure), 'definer + empty search_path');

  perform pg_temp.as_user(staff_a);
  perform pg_temp.fails(format('select public.claim_storage_deletions(10, 60)'), '42501');
  perform pg_temp.fails('select count(*) from files_private.storage_deletions', '42501');
  perform pg_temp.as_postgres();

  -- ------------------------------------------- 13/14/15/16 authorization: nothing enqueued
  perform pg_temp.as_user(viewer_a);
  perform pg_temp.fails(format('select public.soft_delete_order_file(%L,%L,%s,%L)', ord, f_ready, issued,
    pg_temp.osig('delete', viewer_a, ta, ord, f_ready, issued)), '42501', 'tenant access denied');
  perform pg_temp.as_user(owner_b);
  perform pg_temp.fails(format('select public.soft_delete_order_file(%L,%L,%s,%L)', ord, f_ready, issued,
    pg_temp.osig('delete', owner_b, ta, ord, f_ready, issued)), '42501', 'tenant access denied');
  perform pg_temp.as_user(staff_a);
  perform pg_temp.fails(format('select public.soft_delete_order_file(%L,%L,%s,%L)', ord_arch, f_arch, issued,
    pg_temp.osig('delete', staff_a, ta, ord_arch, f_arch, issued)), '42501', 'order is archived');
  perform pg_temp.fails(format('select public.soft_delete_order_file(%L,%L,%s,%L)', ord, f_ready, issued,
    repeat('0', 64)), '42501', 'invalid capability');
  perform pg_temp.fails(format('select public.soft_delete_order_file(%L,%L,%s,%L)', ord, f_ready, issued,
    pg_temp.osig('complete', staff_a, ta, ord, f_ready, issued)), '42501', 'invalid capability');
  perform pg_temp.as_postgres();
  perform pg_temp.ok((select deleted_at is null from public.order_files where id = f_ready), 'denied deletes leave metadata active');
  perform pg_temp.ok((select deleted_at is null from public.order_files where id = f_arch), 'archived file untouched');
  perform pg_temp.ok(not exists (select 1 from files_private.storage_deletions), 'denied deletes enqueue nothing');

  -- ------------------------------------------- 1. normal delete: reserve atomically
  perform pg_temp.as_user(staff_a);
  r := public.soft_delete_order_file(ord, f_ready, issued, pg_temp.osig('delete', staff_a, ta, ord, f_ready, issued));
  perform pg_temp.as_postgres();
  t := pg_temp.task(f_ready);
  perform pg_temp.ok(r->>'replay' = 'false' and (r->>'storage_deletion_id')::uuid = t.id, 'delete returns task id');
  perform pg_temp.ok((select deleted_at is not null and deleted_by = staff_a from public.order_files where id = f_ready), 'metadata hidden');
  perform pg_temp.ok(t.status = 'pending' and t.reason = 'user_delete' and t.file_kind = 'order'
    and t.requested_by = staff_a and t.attempts = 0 and t.next_attempt_at <= now(), 'ready file task due now');
  perform pg_temp.ok(t.storage_key = 'orders/' || ta || '/' || ord || '/' || f_ready, 'task key derived from ids');
  perform pg_temp.ok((select count(*) = 1 from public.activity_log where entity_id = ord and action = 'order.file_deleted'
    and metadata->>'file_id' = f_ready::text), 'activity logged once');
  perform pg_temp.ok((select count(*) = 1 from files_private.storage_deletion_events where deletion_id = t.id and event = 'enqueued'), 'enqueue traced');

  -- 17/18. download / preview / list during deletion: route reads deleted_at
  perform pg_temp.as_user(staff_a);
  perform pg_temp.ok(not exists (select 1 from public.order_files where id = f_ready and deleted_at is null), 'listing hides deleted file');
  perform pg_temp.ok((select deleted_at is not null from public.order_files where id = f_ready), 'download/preview see deleted_at -> 404');
  -- 9. late COMPLETE on a reserved file cannot reactivate it
  perform pg_temp.fails(format('select public.complete_order_file_upload(%L,%L,%L,%s,%L)', ord, f_ready, '"e2"', issued,
    pg_temp.osig('complete', staff_a, ta, ord, f_ready, issued)), 'P0002', 'file not found');

  -- 2. repeated DELETE: same task, no duplicate
  r2 := public.soft_delete_order_file(ord, f_ready, issued, pg_temp.osig('delete', staff_a, ta, ord, f_ready, issued));
  perform pg_temp.as_postgres();
  perform pg_temp.ok(r2->>'replay' = 'true' and r2->>'storage_deletion_id' = r->>'storage_deletion_id', 'replay returns same task');
  perform pg_temp.ok((select count(*) = 1 from files_private.storage_deletions where file_id = f_ready), 'single task per file');
  perform pg_temp.ok((select count(*) = 1 from public.activity_log where entity_id = ord and action = 'order.file_deleted'), 'replay logs nothing');

  -- pending upload: deletion waits for the PUT presign window
  perform pg_temp.as_user(staff_a);
  r := public.soft_delete_order_file(ord, f_pending, issued, pg_temp.osig('delete', staff_a, ta, ord, f_pending, issued));
  perform pg_temp.as_postgres();
  t := pg_temp.task(f_pending);
  perform pg_temp.ok(t.next_attempt_at = (select upload_expires_at from public.order_files where id = f_pending) + interval '5 minutes',
    'pending delete deferred past presign expiry');
  perform pg_temp.as_service();
  perform pg_temp.ok(public.claim_storage_deletion(t.id, 60) = '[]'::jsonb, 'deferred task not claimable inline');
  perform pg_temp.as_postgres();

  -- legacy soft-deleted row (before migration) is backfilled on replay
  insert into public.order_files (id, tenant_id, order_id, original_name, size_bytes, storage_key, status, etag,
    uploaded_by, upload_expires_at, completed_at, deleted_at, deleted_by)
  values (f_legacy, ta, ord, 'legacy.pdf', 10, 'orders/' || ta || '/' || ord || '/' || f_legacy, 'ready', '"x"',
    staff_a, now() - interval '1 day', now() - interval '1 day', now() - interval '1 hour', staff_a);
  perform pg_temp.as_user(staff_a);
  r := public.soft_delete_order_file(ord, f_legacy, issued, pg_temp.osig('delete', staff_a, ta, ord, f_legacy, issued));
  perform pg_temp.as_postgres();
  perform pg_temp.ok(r->>'replay' = 'true' and (pg_temp.task(f_legacy)).status = 'pending', 'legacy replay enqueues');

  -- ------------------------------------------- worker protocol (service_role)
  t := pg_temp.task(f_ready);
  perform pg_temp.as_service();
  perform pg_temp.fails(format('select public.claim_storage_deletions(0, 60)'), '22023');
  perform pg_temp.fails(format('select public.claim_storage_deletions(10, 5)'), '22023');
  claims := public.claim_storage_deletion(t.id, 60);
  perform pg_temp.ok(jsonb_array_length(claims) = 1 and claims->0->>'id' = t.id::text
    and (claims->0->>'attempts')::int = 1 and claims->0->>'storage_key' = t.storage_key, 'inline claim leases task');
  token := (claims->0->>'lease_token')::uuid;
  -- 7 / worker vs inline: a held lease is never handed out twice
  perform pg_temp.ok(public.claim_storage_deletion(t.id, 60) = '[]'::jsonb, 'held lease not re-claimed by id');
  perform pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.claim_storage_deletions(100, 300)) e
    where e->>'id' = t.id::text), 'held lease not re-claimed by batch');
  -- stale/forged token ignored
  perform pg_temp.ok(public.finish_storage_deletion(t.id, gen_random_uuid(), 'deleted', null) = 'stale', 'foreign token is stale');
  perform pg_temp.as_postgres();
  perform pg_temp.ok((pg_temp.task(f_ready)).status = 'processing', 'stale finish changes nothing');
  perform pg_temp.ok(exists (select 1 from files_private.storage_deletion_events where deletion_id = t.id and event = 'stale_finish_ignored'), 'stale finish traced');

  -- 5/6. lease expires (process died): next claim gets a new token; old one is stale
  update files_private.storage_deletions set lease_until = now() - interval '1 second' where id = t.id;
  perform pg_temp.as_service();
  claims := public.claim_storage_deletion(t.id, 60);
  old_token := token;
  token := (claims->0->>'lease_token')::uuid;
  perform pg_temp.ok(token is not null and token <> old_token and (claims->0->>'attempts')::int = 2, 'expired lease re-claimed');
  perform pg_temp.ok(public.finish_storage_deletion(t.id, old_token, 'deleted', null) = 'stale', 'delayed worker ignored');
  -- 11. object already gone: R2 reports success -> completed
  perform pg_temp.ok(public.finish_storage_deletion(t.id, token, 'deleted', null) = 'completed', 'completed');
  perform pg_temp.ok(public.finish_storage_deletion(t.id, token, 'deleted', null) = 'already_completed', 'finish idempotent');
  perform pg_temp.fails(format('select public.finish_storage_deletion(%L,%L,%L,null)', t.id, token, 'purge'), '22023');
  perform pg_temp.fails(format('select public.finish_storage_deletion(%L,%L,%L,null)', gen_random_uuid(), token, 'deleted'), 'P0002');
  perform pg_temp.as_postgres();
  t := pg_temp.task(f_ready);
  perform pg_temp.ok(t.status = 'completed' and t.completed_at is not null and t.lease_token is null, 'completed shape');
  perform pg_temp.ok((select deleted_at is not null from public.order_files where id = f_ready), 'completion never reactivates metadata');

  -- 3. R2 failure: retry with backoff, error recorded and sanitised
  perform pg_temp.order_file(staff_a, ta, ord, f_retry);
  perform pg_temp.as_user(staff_a);
  perform public.soft_delete_order_file(ord, f_retry, issued, pg_temp.osig('delete', staff_a, ta, ord, f_retry, issued));
  perform pg_temp.as_service();
  t := null;
  claims := public.claim_storage_deletion((pg_temp.task(f_retry)).id, 60);
  token := (claims->0->>'lease_token')::uuid;
  outcome := public.finish_storage_deletion((claims->0->>'id')::uuid, token, 'retry', E'R2 503\nService Unavailable');
  perform pg_temp.as_postgres();
  t := pg_temp.task(f_retry);
  perform pg_temp.ok(outcome = 'retry_scheduled' and t.status = 'pending' and t.next_attempt_at > now()
    and t.last_error = 'R2 503 Service Unavailable' and t.attempts = 1, 'retry scheduled with sanitised error');
  perform pg_temp.as_service();
  perform pg_temp.ok(public.claim_storage_deletion(t.id, 60) = '[]'::jsonb, 'backoff respected');

  -- max attempts: terminal failed, kept, not retried
  perform pg_temp.as_postgres();
  update files_private.storage_deletions set attempts = max_attempts - 1, next_attempt_at = now() where id = t.id;
  perform pg_temp.as_service();
  claims := public.claim_storage_deletion(t.id, 60);
  outcome := public.finish_storage_deletion(t.id, (claims->0->>'lease_token')::uuid, 'retry', 'R2 timeout');
  perform pg_temp.ok(outcome = 'failed', 'max attempts -> failed');
  perform pg_temp.ok(public.claim_storage_deletion(t.id, 60) = '[]'::jsonb, 'failed never auto-retried');
  r := public.storage_deletion_backlog();
  perform pg_temp.ok((r->>'failed')::int = 1, 'backlog reports failed');
  perform pg_temp.as_postgres();
  t := pg_temp.task(f_retry);
  perform pg_temp.ok(t.failed_at is not null and t.last_error = 'R2 timeout' and t.attempts = t.max_attempts, 'failed task keeps trace');
  perform pg_temp.ok((select deleted_at is not null from public.order_files where id = f_retry), 'failed task never reactivates file');

  -- administrative recovery (postgres session only, note mandatory)
  perform pg_temp.fails(format('select public.requeue_storage_deletion(%L, null)', t.id), '22023');
  r := public.requeue_storage_deletion(t.id, 'R2 incident resolved');
  t := pg_temp.task(f_retry);
  perform pg_temp.ok(t.status = 'pending' and t.attempts = 0 and t.manual_requeues = 1 and t.failed_at is null
    and t.last_error = 'R2 timeout', 'requeue resets attempts and keeps history');
  perform pg_temp.ok(exists (select 1 from files_private.storage_deletion_events where deletion_id = t.id and event = 'requeued'
    and detail = 'R2 incident resolved'), 'requeue traced');
  perform pg_temp.fails(format('select public.requeue_storage_deletion(%L, %L)', t.id, 'again'), '55000');
  perform pg_temp.as_service();
  perform pg_temp.fails(format('select public.requeue_storage_deletion(%L, %L)', t.id, 'x'), '42501');
  perform pg_temp.as_postgres();

  -- abandoned lease that already used every attempt becomes failed
  perform pg_temp.order_file(staff_a, ta, ord, f_abandon);
  perform pg_temp.as_user(staff_a);
  perform public.soft_delete_order_file(ord, f_abandon, issued, pg_temp.osig('delete', staff_a, ta, ord, f_abandon, issued));
  perform pg_temp.as_service();
  perform public.claim_storage_deletion((pg_temp.task(f_abandon)).id, 60);
  perform pg_temp.as_postgres();
  update files_private.storage_deletions set attempts = max_attempts, lease_until = now() - interval '1 second'
    where file_id = f_abandon;
  perform pg_temp.as_service();
  perform pg_temp.ok(public.claim_storage_deletion((pg_temp.task(f_abandon)).id, 60) = '[]'::jsonb, 'exhausted lease not re-claimed');
  perform pg_temp.as_postgres();
  perform pg_temp.ok((pg_temp.task(f_abandon)).status = 'failed'
    and (pg_temp.task(f_abandon)).last_error = 'lease expired at max attempts', 'exhausted lease -> failed');

  -- live metadata guard: a visible row's object is never deleted
  perform pg_temp.order_file(staff_a, ta, ord, f_live);
  insert into files_private.storage_deletions (file_kind, tenant_id, parent_id, file_id, storage_key, reason)
    values ('order', ta, ord, f_live, 'orders/' || ta || '/' || ord || '/' || f_live, 'expired_upload');
  perform pg_temp.as_service();
  perform pg_temp.ok(public.claim_storage_deletion((pg_temp.task(f_live)).id, 60) = '[]'::jsonb, 'live key not claimed');
  perform pg_temp.as_postgres();
  perform pg_temp.ok((pg_temp.task(f_live)).status = 'failed'
    and (pg_temp.task(f_live)).last_error = 'live metadata references storage key', 'live key task failed safely');
  perform pg_temp.ok((select status = 'ready' and deleted_at is null from public.order_files where id = f_live), 'live file intact');

  -- 12. manipulated keys are rejected by the outbox
  perform pg_temp.fails(format(
    'insert into files_private.storage_deletions (file_kind, tenant_id, parent_id, file_id, storage_key, reason) values (%L,%L,%L,%L,%L,%L)',
    'order', ta, ord, f_live, 'orders/' || tb || '/' || ord || '/' || f_live, 'user_delete'), '23514');
  perform pg_temp.fails(format(
    'insert into files_private.storage_deletions (file_kind, tenant_id, parent_id, file_id, storage_key, reason) values (%L,%L,%L,%L,%L,%L)',
    'quote', ta, ord, f_live, 'orders/' || ta || '/' || ord || '/' || f_live, 'user_delete'), '23514');

  -- ------------------------------------------- C. expired upload cleanup
  insert into public.order_files (id, tenant_id, order_id, original_name, size_bytes, storage_key, status, uploaded_by, upload_expires_at)
  values
    (f_expired, ta, ord, 'expired.pdf', 10, 'orders/' || ta || '/' || ord || '/' || f_expired, 'pending', staff_a, now() - interval '1 hour'),
    (f_fresh, ta, ord, 'fresh.pdf', 10, 'orders/' || ta || '/' || ord || '/' || f_fresh, 'pending', staff_a, now() + interval '10 minutes'),
    (f_badkey, ta, ord, 'bad.pdf', 10, 'orders/' || tb || '/' || ord || '/' || f_badkey, 'pending', staff_a, now() - interval '1 hour');

  perform pg_temp.as_user(staff_a);
  perform pg_temp.fails('select public.claim_expired_file_uploads(10)', '42501');
  perform pg_temp.as_service();
  perform pg_temp.fails('select public.claim_expired_file_uploads(0)', '22023');
  r := public.claim_expired_file_uploads(100);
  perform pg_temp.as_postgres();
  perform pg_temp.ok((r->>'orders')::int = 1 and (r->>'skipped')::int = 1 and (r->>'errors')::int = 0, 'cleanup counters: ' || r::text);
  perform pg_temp.ok(not exists (select 1 from public.order_files where id = f_expired), 'expired metadata removed');
  t := pg_temp.task(f_expired);
  -- expired 1h ago: presign window (+5 min) already over -> due now
  perform pg_temp.ok(t.reason = 'expired_upload' and t.status = 'pending' and t.requested_by is null
    and t.next_attempt_at = now(), 'expired task enqueued and due');
  perform pg_temp.ok(exists (select 1 from public.order_files where id = f_fresh and status = 'pending'), 'unexpired pending untouched');
  perform pg_temp.ok(exists (select 1 from public.order_files where id = f_badkey), 'mismatched key row untouched');
  perform pg_temp.ok(not exists (select 1 from files_private.storage_deletions where file_id = f_badkey), 'mismatched key never enqueued');
  perform pg_temp.ok((select count(*) from public.order_files where id in (f_ready, f_live) and status = 'ready') = 2, 'ready rows untouched');
  -- 9. late COMPLETE after cleanup
  perform pg_temp.as_user(staff_a);
  perform pg_temp.fails(format('select public.complete_order_file_upload(%L,%L,%L,%s,%L)', ord, f_expired, '"e"', issued,
    pg_temp.osig('complete', staff_a, ta, ord, f_expired, issued)), 'P0002', 'file not found');
  -- 10. cleanup retry is idempotent
  perform pg_temp.as_service();
  r := public.claim_expired_file_uploads(100);
  perform pg_temp.as_postgres();
  perform pg_temp.ok((r->>'orders')::int = 0 and (select count(*) from files_private.storage_deletions where file_id = f_expired) = 1,
    'cleanup re-run enqueues nothing new');

  -- ------------------------------------------- 19. quote files
  perform public.set_tenant_feature('phase46a', 'quotes', true, null);
  perform public.seed_quote_statuses(ta);
  perform pg_temp.as_user(owner_a);
  insert into public.quotes (tenant_id, status_id, description)
    select ta, id, 'Q' from public.quote_statuses where tenant_id = ta and code = 'draft' returning id into q;
  r := public.ensure_quote_draft_v1(q); v := (r->'version'->>'id')::uuid;
  r := public.save_quote_draft_v1(q, v, 0, '{"title":"Commercial"}',
    '[{"concept":"Item","quantity":1,"unit_price":100,"tax_rate":21}]');
  r := public.prepare_quote_version_v1(q, v, (r->'version'->>'row_version')::bigint);
  perform pg_temp.ok(r->>'ok' = 'true', 'quote prepared');
  -- official PDF (reserve + finish)
  perform public.reserve_quote_pdf_v1(q, v, q_pdf, 100, issued, pg_temp.qsig('create', owner_a, ta, q, q_pdf, issued));
  perform public.finish_quote_pdf_v1(q, v, q_pdf, '"pdf"', issued, pg_temp.qsig('complete', owner_a, ta, q, q_pdf, issued));
  -- ordinary attachment
  perform public.create_quote_file_upload(q, q_ordinary, 'brief.pdf', 'application/pdf', 50,
    now() + interval '15 minutes', issued, pg_temp.qsig('create', owner_a, ta, q, q_ordinary, issued));
  perform public.complete_quote_file_upload(q, q_ordinary, '"q"', issued, pg_temp.qsig('complete', owner_a, ta, q, q_ordinary, issued));

  -- official PDF protected BEFORE anything else happens
  perform pg_temp.fails(format('select public.soft_delete_quote_file(%L,%L,%s,%L)', q, q_pdf, issued,
    pg_temp.qsig('delete', owner_a, ta, q, q_pdf, issued)), '55000', 'official_pdf_protected');
  perform pg_temp.as_postgres();
  perform pg_temp.ok((select deleted_at is null and status = 'ready' from public.quote_files where id = q_pdf), 'official PDF metadata intact');
  perform pg_temp.ok(not exists (select 1 from files_private.storage_deletions where file_id = q_pdf), 'official PDF never enqueued');
  perform pg_temp.ok((select pdf_file_id = q_pdf from public.quote_versions where id = v), 'official PDF still linked');
  perform pg_temp.ok(not exists (select 1 from public.activity_log where entity_id = q and action = 'quote.file_deleted'), 'no delete activity for PDF');

  perform pg_temp.as_user(owner_b);
  perform pg_temp.fails(format('select public.soft_delete_quote_file(%L,%L,%s,%L)', q, q_ordinary, issued,
    pg_temp.qsig('delete', owner_b, ta, q, q_ordinary, issued)), '42501');
  perform pg_temp.as_user(owner_a);
  perform pg_temp.fails(format('select public.soft_delete_quote_file(%L,%L,%s,%L)', q, q_ordinary, issued,
    pg_temp.osig('delete', owner_a, ta, q, q_ordinary, issued)), '42501', 'invalid capability');
  r := public.soft_delete_quote_file(q, q_ordinary, issued, pg_temp.qsig('delete', owner_a, ta, q, q_ordinary, issued));
  perform pg_temp.as_postgres();
  t := pg_temp.task(q_ordinary);
  perform pg_temp.ok((r->>'storage_deletion_id')::uuid = t.id and t.file_kind = 'quote' and t.reason = 'user_delete'
    and t.storage_key = 'quotes/' || ta || '/' || q || '/' || q_ordinary, 'quote attachment enqueued');
  perform pg_temp.ok((select deleted_at is not null from public.quote_files where id = q_ordinary), 'quote attachment hidden');

  -- expired official PDF reservation is still purgeable (guard allows pending+expired)
  insert into public.quote_files (id, tenant_id, quote_id, original_name, content_type, size_bytes, storage_key, status, uploaded_by, upload_expires_at)
    values (q_pdf_expired, ta, q, 'x.pdf', 'application/pdf', 10, 'quotes/' || ta || '/' || q || '/' || q_pdf_expired,
      'pending', owner_a, now() - interval '1 hour');
  perform pg_temp.as_service();
  r := public.claim_expired_file_uploads(100);
  perform pg_temp.as_postgres();
  perform pg_temp.ok((r->>'quotes')::int = 1 and not exists (select 1 from public.quote_files where id = q_pdf_expired)
    and (pg_temp.task(q_pdf_expired)).reason = 'expired_upload', 'expired quote upload reserved');

  -- 20. regression: storage usage ignores hidden files; ready PDF still counted
  perform pg_temp.ok((public.tenant_storage_usage(ta)->>'ready_bytes')::bigint
    = (select coalesce(sum(size_bytes), 0) from (
        select size_bytes from public.order_files where tenant_id = ta and deleted_at is null and status = 'ready'
        union all
        select size_bytes from public.quote_files where tenant_id = ta and deleted_at is null and status = 'ready') s),
    'storage usage consistent');
  perform pg_temp.ok(exists (select 1 from public.quote_files where id = q_pdf and deleted_at is null), 'official PDF still counted');

  -- backlog shape
  perform pg_temp.as_service();
  r := public.storage_deletion_backlog();
  perform pg_temp.ok(r ? 'pending' and r ? 'processing' and r ? 'failed' and r ? 'stale_leases' and r ? 'oldest_pending_at', 'backlog shape');
  perform pg_temp.as_postgres();

  raise notice 'phase46 PASS: grants, authorization, atomic reservation, replay, deferred pending, lease, stale finish, retry/backoff, max attempts, requeue, live-key guard, key CHECK, expired cleanup, late COMPLETE, quotes, official PDF';
end $phase46$;

rollback;
