-- Settings V1 · tenant file limits + storage quota.
-- Run after 20260921181000_tenant_file_limits_and_storage_quota_v1.sql.

begin;

do $vault$
declare
  v_id uuid;
  v_secret text := 'phase22-files-signing-secret-at-least-32-chars';
begin
  select id into v_id from vault.secrets where name = 'files_signing_secret';
  if v_id is null then
    perform vault.create_secret(
      v_secret,
      'files_signing_secret',
      'Files phase22 test secret'
    );
  else
    perform vault.update_secret(v_id, v_secret);
  end if;
end;
$vault$;

create or replace function pg_temp.files_signature(
  p_secret text,
  p_purpose text,
  p_user_id uuid,
  p_tenant_id uuid,
  p_order_id uuid,
  p_file_id uuid,
  p_issued_at bigint
)
returns text
language sql
immutable
as $$
  select encode(
    extensions.hmac(
      convert_to(
        'files-v1|' || p_purpose || '|' || p_user_id::text || '|' ||
        p_tenant_id::text || '|' || p_order_id::text || '|' ||
        p_file_id::text || '|' || p_issued_at::text,
        'UTF8'
      ),
      convert_to(p_secret, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

do $phase22$
declare
  v_secret text := 'phase22-files-signing-secret-at-least-32-chars';
  v_owner_a uuid := 'e2200000-0000-4000-8000-000000000001';
  v_admin_a uuid := 'e2200000-0000-4000-8000-000000000002';
  v_manager_a uuid := 'e2200000-0000-4000-8000-000000000003';
  v_staff_a uuid := 'e2200000-0000-4000-8000-000000000004';
  v_viewer_a uuid := 'e2200000-0000-4000-8000-000000000005';
  v_owner_b uuid := 'e2200000-0000-4000-8000-000000000006';
  v_tenant_a uuid := 'e2200000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e2200000-0000-4000-8000-000000000012';
  v_status_a uuid := 'e2200000-0000-4000-8000-000000000021';
  v_status_b uuid := 'e2200000-0000-4000-8000-000000000022';
  v_service_a uuid := 'e2200000-0000-4000-8000-000000000031';
  v_service_b uuid := 'e2200000-0000-4000-8000-000000000032';
  v_order_a uuid := 'e2200000-0000-4000-8000-000000000061';
  v_order_b uuid := 'e2200000-0000-4000-8000-000000000062';
  v_plan_id uuid;
  v_feature_id uuid;
  v_sub_id uuid;
  v_file_ready uuid := 'e2200000-0000-4000-8000-000000000071';
  v_file_pending uuid := 'e2200000-0000-4000-8000-000000000072';
  v_file_deleted uuid := 'e2200000-0000-4000-8000-000000000073';
  v_file_expired uuid := 'e2200000-0000-4000-8000-000000000074';
  v_file_other uuid := 'e2200000-0000-4000-8000-000000000075';
  v_file_upload uuid := 'e2200000-0000-4000-8000-000000000076';
  v_file_exact uuid := 'e2200000-0000-4000-8000-000000000077';
  v_file_over uuid := 'e2200000-0000-4000-8000-000000000078';
  v_issued_at bigint;
  v_sig text;
  v_usage jsonb;
  v_settings jsonb;
  v_limit bigint;
  v_sqlstate text;
  v_message text;
  v_prefs jsonb;
  v_result jsonb;
  v_mib constant bigint := 1048576;
  v_platform_max constant bigint := 104857600;
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  ) values
    (v_owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-a@phase22.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_admin_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'admin-a@phase22.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_manager_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'manager-a@phase22.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_staff_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'staff-a@phase22.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_viewer_a, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'viewer-a@phase22.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', ''),
    (v_owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     'owner-b@phase22.test', crypt('pw', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
     now(), now(), '', '', '', '');

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'), (v_admin_a, 'Admin A'), (v_manager_a, 'Manager A'),
    (v_staff_a, 'Staff A'), (v_viewer_a, 'Viewer A'), (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Tenant A Phase22', 'tenant-a-phase22', true),
    (v_tenant_b, 'Tenant B Phase22', 'tenant-b-phase22', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_admin_a, 'admin', true),
    (v_tenant_a, v_manager_a, 'manager', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  insert into public.tenant_settings (tenant_id, preferences) values
    (v_tenant_a, jsonb_build_object(
      'neighbor_keep', 'yes',
      'quick_order_layout_v1', jsonb_build_object('version', 1)
    )),
    (v_tenant_b, '{}'::jsonb);

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values
    (v_status_a, v_tenant_a, 'Recibido', 'received', true, false, false, false, true, 1);

  insert into public.services (id, tenant_id, name, active) values
    (v_service_a, v_tenant_a, 'Impresión A', true);

  insert into public.orders (
    id, tenant_id, reference, title, status_id, service_id, created_by
  ) values
    (v_order_a, v_tenant_a, 'P22-A', 'Order A', v_status_a, v_service_a, v_owner_a);

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values
    (v_status_b, v_tenant_b, 'Recibido', 'received', true, false, false, false, true, 1);

  insert into public.services (id, tenant_id, name, active) values
    (v_service_b, v_tenant_b, 'Impresión B', true);

  insert into public.orders (
    id, tenant_id, reference, title, status_id, service_id, created_by
  ) values
    (v_order_b, v_tenant_b, 'P22-B', 'Order B', v_status_b, v_service_b, v_owner_b);

  reset role;

  -- Clear JWT so postgres seed inserts are exempt from mutation guard.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);

  -- Seed files as postgres (auth.uid null) for usage accounting.
  insert into public.order_files (
    id, tenant_id, order_id, original_name, content_type, size_bytes,
    storage_provider, storage_key, status, etag, uploaded_by, upload_expires_at,
    completed_at, deleted_at
  ) values
    (v_file_ready, v_tenant_a, v_order_a, 'ready.pdf', 'application/pdf', 1000,
     'r2', 'orders/' || v_tenant_a || '/' || v_order_a || '/' || v_file_ready,
     'ready', 'etag-ready', v_owner_a, now() + interval '1 hour', now(), null),
    (v_file_pending, v_tenant_a, v_order_a, 'pending.pdf', 'application/pdf', 2000,
     'r2', 'orders/' || v_tenant_a || '/' || v_order_a || '/' || v_file_pending,
     'pending', null, v_owner_a, now() + interval '1 hour', null, null),
    (v_file_deleted, v_tenant_a, v_order_a, 'deleted.pdf', 'application/pdf', 5000,
     'r2', 'orders/' || v_tenant_a || '/' || v_order_a || '/' || v_file_deleted,
     'ready', 'etag-deleted', v_owner_a, now() + interval '1 hour', now(), now()),
    (v_file_expired, v_tenant_a, v_order_a, 'expired.pdf', 'application/pdf', 4000,
     'r2', 'orders/' || v_tenant_a || '/' || v_order_a || '/' || v_file_expired,
     'pending', null, v_owner_a, now() - interval '1 hour', null, null),
    (v_file_other, v_tenant_b, v_order_b, 'other.pdf', 'application/pdf', 99999,
     'r2', 'orders/' || v_tenant_b || '/' || v_order_b || '/' || v_file_other,
     'ready', 'etag-other', v_owner_b, now() + interval '1 hour', now(), null);

  -- 1-5: usage counts tenant isolation + ready/pending/deleted
  v_usage := public.tenant_storage_usage(v_tenant_a);
  if (v_usage->>'file_count')::bigint <> 3 then
    raise exception 'FAIL usage file_count expected 3 got %', v_usage->>'file_count';
  end if;
  if (v_usage->>'reserved_bytes')::bigint <> 7000 then
    raise exception 'FAIL reserved expected 7000 got %', v_usage->>'reserved_bytes';
  end if;
  if (v_usage->>'ready_bytes')::bigint <> 1000 then
    raise exception 'FAIL ready expected 1000';
  end if;
  if (v_usage->>'pending_bytes')::bigint <> 6000 then
    raise exception 'FAIL pending expected 6000 (pending+expired still reserved)';
  end if;

  v_usage := public.tenant_storage_usage(v_tenant_b);
  if (v_usage->>'reserved_bytes')::bigint <> 99999 then
    raise exception 'FAIL tenant B usage leaked or wrong';
  end if;

  -- 7: NULL quota does not block
  v_limit := public.resolve_tenant_storage_limit_bytes(v_tenant_a);
  if v_limit is not null then
    raise exception 'FAIL expected NULL quota without storage_bytes plan feature';
  end if;

  -- 15: fallback max file = 100 MiB
  if public.resolve_tenant_max_file_bytes(v_tenant_a) <> v_platform_max then
    raise exception 'FAIL default max file';
  end if;

  -- Owner can read settings
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  v_settings := public.get_tenant_files_settings(v_tenant_a);
  if (v_settings->>'quota_configured')::boolean is distinct from false then
    raise exception 'FAIL quota_configured should be false';
  end if;
  if (v_settings->>'reserved_bytes')::bigint <> 7000 then
    raise exception 'FAIL settings reserved';
  end if;

  -- Cross-tenant settings blocked
  begin
    perform public.get_tenant_files_settings(v_tenant_b);
    raise exception 'FAIL cross-tenant settings allowed';
  exception
    when others then
      get stacked diagnostics v_sqlstate = returned_sqlstate, v_message = message_text;
      if v_message not like '%tenant access denied%' and v_sqlstate <> '42501' then
        raise;
      end if;
  end;

  -- 17: owner/admin/manager can update max file; 16: neighbors preserved
  v_settings := public.update_tenant_files_max_file_bytes(v_tenant_a, 50 * v_mib);
  if (v_settings->>'max_file_bytes')::bigint <> 50 * v_mib then
    raise exception 'FAIL owner max file update';
  end if;

  reset role;
  select preferences into v_prefs from public.tenant_settings where tenant_id = v_tenant_a;
  if v_prefs->>'neighbor_keep' is distinct from 'yes' then
    raise exception 'FAIL neighboring preference wiped';
  end if;
  if v_prefs->'quick_order_layout_v1' is null then
    raise exception 'FAIL quick_order preference wiped';
  end if;

  perform set_config('request.jwt.claim.sub', v_admin_a::text, true);
  set local role authenticated;
  perform public.update_tenant_files_max_file_bytes(v_tenant_a, 25 * v_mib);

  reset role;
  perform set_config('request.jwt.claim.sub', v_manager_a::text, true);
  set local role authenticated;
  perform public.update_tenant_files_max_file_bytes(v_tenant_a, 10 * v_mib);

  -- 12-14: invalid max rejected
  begin
    perform public.update_tenant_files_max_file_bytes(v_tenant_a, v_platform_max + 1);
    raise exception 'FAIL >100MiB accepted';
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like '%invalid_max_file_bytes%' then
        raise;
      end if;
  end;

  begin
    perform public.update_tenant_files_max_file_bytes(v_tenant_a, 0);
    raise exception 'FAIL <=0 accepted';
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like '%invalid_max_file_bytes%' then
        raise;
      end if;
  end;

  -- 18: staff/viewer cannot change settings
  reset role;
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  set local role authenticated;
  begin
    perform public.update_tenant_files_max_file_bytes(v_tenant_a, 50 * v_mib);
    raise exception 'FAIL staff updated settings';
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like '%tenant access denied%' then
        raise;
      end if;
  end;

  reset role;
  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  set local role authenticated;
  begin
    perform public.get_tenant_files_settings(v_tenant_a);
    raise exception 'FAIL viewer read settings';
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like '%tenant access denied%' then
        raise;
      end if;
  end;

  -- Restore a workable max for upload tests
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  set local role authenticated;
  perform public.update_tenant_files_max_file_bytes(v_tenant_a, 50 * v_mib);

  -- 19: staff can still create upload when quota NULL
  reset role;
  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  set local role authenticated;
  v_issued_at := floor(extract(epoch from now()))::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_staff_a, v_tenant_a, v_order_a, v_file_upload, v_issued_at
  );
  v_result := public.create_order_file_upload(
    v_order_a, v_file_upload, 'staff.pdf', 'application/pdf', 100,
    now() + interval '15 minutes', v_issued_at, v_sig
  );
  if v_result->'file'->>'id' is distinct from v_file_upload::text then
    raise exception 'FAIL staff upload';
  end if;

  -- 20: viewer cannot mutate files
  reset role;
  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  set local role authenticated;
  v_issued_at := floor(extract(epoch from now()))::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_viewer_a, v_tenant_a, v_order_a,
    'e2200000-0000-4000-8000-000000000079'::uuid, v_issued_at
  );
  begin
    perform public.create_order_file_upload(
      v_order_a, 'e2200000-0000-4000-8000-000000000079'::uuid,
      'viewer.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
    raise exception 'FAIL viewer upload allowed';
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like '%tenant access denied%' then
        raise;
      end if;
  end;

  -- Configure commercial quota for remaining tests (isolated plan feature)
  reset role;
  select id into v_feature_id from public.features where code = 'storage_bytes';
  if v_feature_id is null then
    raise exception 'FAIL storage_bytes feature missing';
  end if;

  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (
    'e2200000-0000-4000-8000-000000000091',
    'phase22_quota',
    'Phase22 Quota',
    true,
    99,
    0,
    0
  )
  on conflict (code) do update set name = excluded.name
  returning id into v_plan_id;

  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
  values (v_plan_id, v_feature_id, true, 10000)
  on conflict (plan_id, feature_id) do update
    set enabled = true, limit_value = 10000;

  insert into public.subscriptions (
    id, tenant_id, plan_id, status, current_period_start, current_period_end
  ) values (
    'e2200000-0000-4000-8000-000000000092',
    v_tenant_a,
    v_plan_id,
    'active',
    now() - interval '1 day',
    now() + interval '30 days'
  );

  v_limit := public.resolve_tenant_storage_limit_bytes(v_tenant_a);
  if v_limit <> 10000 then
    raise exception 'FAIL configured quota expected 10000 got %', v_limit;
  end if;

  -- Current reserved after staff upload: 7000 + 100 = 7100
  -- 8: upload within quota
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  set local role authenticated;
  v_issued_at := floor(extract(epoch from now()))::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_owner_a, v_tenant_a, v_order_a, v_file_exact, v_issued_at
  );
  -- room left = 10000 - 7100 = 2900; upload 2900 exact
  v_result := public.create_order_file_upload(
    v_order_a, v_file_exact, 'exact.pdf', 'application/pdf', 2900,
    now() + interval '15 minutes', v_issued_at, v_sig
  );
  if v_result->'file'->>'id' is distinct from v_file_exact::text then
    raise exception 'FAIL exact quota upload';
  end if;

  -- 9: over quota fails
  v_issued_at := floor(extract(epoch from now()))::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_owner_a, v_tenant_a, v_order_a, v_file_over, v_issued_at
  );
  begin
    perform public.create_order_file_upload(
      v_order_a, v_file_over, 'over.pdf', 'application/pdf', 1,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
    raise exception 'FAIL over-quota upload allowed';
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like '%storage_quota_exceeded%' then
        raise;
      end if;
  end;

  -- Soft-delete frees quota (22)
  reset role;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  v_issued_at := floor(extract(epoch from now()))::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'delete', v_owner_a, v_tenant_a, v_order_a, v_file_exact, v_issued_at
  );
  perform public.soft_delete_order_file(
    v_order_a, v_file_exact, v_issued_at, v_sig
  );

  v_issued_at := floor(extract(epoch from now()))::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_owner_a, v_tenant_a, v_order_a, v_file_over, v_issued_at
  );
  v_result := public.create_order_file_upload(
    v_order_a, v_file_over, 'after-delete.pdf', 'application/pdf', 100,
    now() + interval '15 minutes', v_issued_at, v_sig
  );
  if v_result->'file'->>'id' is distinct from v_file_over::text then
    raise exception 'FAIL soft-delete did not free quota';
  end if;

  -- 6: cleanup of expired pending frees reservation
  reset role;
  -- re-check expired still counted before purge
  v_usage := public.tenant_storage_usage(v_tenant_a);
  if (v_usage->>'pending_bytes')::bigint < 4000 then
    raise exception 'FAIL expired pending should still reserve before purge';
  end if;

  if public.purge_expired_order_file(v_file_expired) is not true then
    raise exception 'FAIL purge_expired_order_file';
  end if;

  v_usage := public.tenant_storage_usage(v_tenant_a);
  if exists (
    select 1 from public.order_files where id = v_file_expired
  ) then
    raise exception 'FAIL expired file still present';
  end if;

  -- 13: file_too_large when over tenant max (50 MiB configured)
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  set local role authenticated;
  v_issued_at := floor(extract(epoch from now()))::bigint;
  v_sig := pg_temp.files_signature(
    v_secret, 'create', v_owner_a, v_tenant_a, v_order_a,
    'e2200000-0000-4000-8000-00000000007a'::uuid, v_issued_at
  );
  begin
    perform public.create_order_file_upload(
      v_order_a, 'e2200000-0000-4000-8000-00000000007a'::uuid,
      'big.pdf', 'application/pdf', (50 * v_mib) + 1,
      now() + interval '15 minutes', v_issued_at, v_sig
    );
    raise exception 'FAIL over tenant max accepted';
  exception
    when others then
      get stacked diagnostics v_message = message_text;
      if v_message not like '%file_too_large%' then
        raise;
      end if;
  end;

  raise notice 'phase22_tenant_file_limits: ok';
end;
$phase22$;

rollback;
