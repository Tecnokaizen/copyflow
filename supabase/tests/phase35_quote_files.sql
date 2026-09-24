-- Quote Files V1. Roles, capability, shared quota, activity, conversion.

begin;

do $phase35$
declare
  v_owner_a uuid := 'e3500000-0000-4000-8000-000000000001';
  v_admin_a uuid := 'e3500000-0000-4000-8000-000000000002';
  v_manager_a uuid := 'e3500000-0000-4000-8000-000000000003';
  v_staff_a uuid := 'e3500000-0000-4000-8000-000000000004';
  v_viewer_a uuid := 'e3500000-0000-4000-8000-000000000005';
  v_owner_b uuid := 'e3500000-0000-4000-8000-000000000006';
  v_tenant_a uuid := 'e3500000-0000-4000-8000-000000000011';
  v_tenant_b uuid := 'e3500000-0000-4000-8000-000000000012';
  v_status_a uuid := 'e3500000-0000-4000-8000-000000000021';
  v_service_a uuid := 'e3500000-0000-4000-8000-000000000031';
  v_order_a uuid := 'e3500000-0000-4000-8000-000000000061';
  v_quote_a uuid := 'e3500000-0000-4000-8000-000000000071';
  v_quote_b uuid := 'e3500000-0000-4000-8000-000000000072';
  v_file uuid := 'e3500000-0000-4000-8000-000000000081';
  v_file_other uuid := 'e3500000-0000-4000-8000-000000000082';
  v_file_order uuid := 'e3500000-0000-4000-8000-000000000083';
  v_draft uuid;
  v_secret text := 'phase35-quote-files-signing-secret-32';
  v_issued bigint;
  v_sig text;
  v_bad text;
  v_result jsonb;
  v_usage jsonb;
  v_message text;
  v_count int;
  v_role text;
  v_user uuid;
  v_feature uuid;
  v_plan uuid := 'e3500000-0000-4000-8000-000000000091';
  v_order_id uuid;
begin
  if exists (select 1 from vault.secrets where name = 'files_signing_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'files_signing_secret' order by created_at desc limit 1),
      v_secret
    );
  else
    perform vault.create_secret(v_secret, 'files_signing_secret', 'phase35');
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, recovery_token,
    email_change_token_new, email_change
  )
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    u.email, crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    now(), now(), '', '', '', ''
  from (values
    (v_owner_a, 'owner-a@phase35.test'),
    (v_admin_a, 'admin-a@phase35.test'),
    (v_manager_a, 'manager-a@phase35.test'),
    (v_staff_a, 'staff-a@phase35.test'),
    (v_viewer_a, 'viewer-a@phase35.test'),
    (v_owner_b, 'owner-b@phase35.test')
  ) as u(id, email);

  insert into public.profiles (id, full_name) values
    (v_owner_a, 'Owner A'), (v_admin_a, 'Admin A'), (v_manager_a, 'Manager A'),
    (v_staff_a, 'Staff A'), (v_viewer_a, 'Viewer A'), (v_owner_b, 'Owner B');

  insert into public.tenants (id, name, slug, active) values
    (v_tenant_a, 'Phase35 A', 'phase35-a', true),
    (v_tenant_b, 'Phase35 B', 'phase35-b', true);

  insert into public.memberships (tenant_id, user_id, role, active) values
    (v_tenant_a, v_owner_a, 'owner', true),
    (v_tenant_a, v_admin_a, 'admin', true),
    (v_tenant_a, v_manager_a, 'manager', true),
    (v_tenant_a, v_staff_a, 'staff', true),
    (v_tenant_a, v_viewer_a, 'viewer', true),
    (v_tenant_b, v_owner_b, 'owner', true);

  insert into public.tenant_settings (tenant_id, preferences) values
    (v_tenant_a, '{}'::jsonb),
    (v_tenant_b, '{}'::jsonb);

  perform public.set_tenant_feature('phase35-a', 'quotes', true, null);
  perform public.set_tenant_feature('phase35-b', 'quotes', true, null);
  perform public.seed_quote_statuses(v_tenant_a);
  perform public.seed_quote_statuses(v_tenant_b);

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  insert into public.order_statuses (
    id, tenant_id, name, code, is_initial, is_ready, is_closed, is_cancelled, active, sort_order
  ) values (
    v_status_a, v_tenant_a, 'Recibido', 'received', true, false, false, false, true, 1
  );
  insert into public.services (id, tenant_id, name, active)
    values (v_service_a, v_tenant_a, 'Servicio', true);
  insert into public.orders (
    id, tenant_id, reference, title, status_id, service_id, created_by
  ) values (
    v_order_a, v_tenant_a, 'P35-O', 'Pedido', v_status_a, v_service_a, v_owner_a
  );

  select id into v_draft
  from public.quote_statuses
  where tenant_id = v_tenant_a and code = 'draft';

  insert into public.quotes (tenant_id, description, status_id)
  values (v_tenant_a, 'Presupuesto A', v_draft)
  returning id into v_quote_a;

  reset role;
  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  set local role authenticated;
  select id into v_draft from public.quote_statuses
  where tenant_id = v_tenant_b and code = 'draft';
  insert into public.quotes (tenant_id, description, status_id)
  values (v_tenant_b, 'Presupuesto B', v_draft)
  returning id into v_quote_b;
  reset role;

  v_issued := floor(extract(epoch from now()))::bigint;

  foreach v_role in array array['owner', 'admin', 'manager', 'staff'] loop
    v_user := case v_role
      when 'owner' then v_owner_a
      when 'admin' then v_admin_a
      when 'manager' then v_manager_a
      else v_staff_a
    end;
    v_file := gen_random_uuid();
    perform set_config('request.jwt.claim.sub', v_user::text, true);
    perform set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    v_sig := encode(extensions.hmac(
      convert_to(
        'files-v1-quote|create|' || v_user::text || '|' || v_tenant_a::text
        || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text,
        'UTF8'
      ),
      convert_to(v_secret, 'UTF8'),
      'sha256'
    ), 'hex');
    v_result := public.create_quote_file_upload(
      v_quote_a, v_file, v_role || '.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued, v_sig
    );
    if v_result->'file'->>'status' is distinct from 'pending' then
      raise exception 'FAIL % could not init quote file', v_role;
    end if;
    if v_result->>'storage_key' is distinct from
       'quotes/' || v_tenant_a::text || '/' || v_quote_a::text || '/' || v_file::text
    then
      raise exception 'FAIL storage key for %', v_role;
    end if;
    reset role;
  end loop;

  perform set_config('request.jwt.claim.sub', v_viewer_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  v_file := gen_random_uuid();
  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_viewer_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'viewer.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued, v_sig
    );
    raise exception 'FAIL viewer init allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%tenant access denied%' then raise; end if;
  end;

  reset role;
  perform public.set_tenant_feature('phase35-a', 'quotes', false, null);
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_file := gen_random_uuid();
  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'off.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued, v_sig
    );
    raise exception 'FAIL quotes off init allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%tenant access denied%' then raise; end if;
  end;
  reset role;
  perform public.set_tenant_feature('phase35-a', 'quotes', true, null);
  set local role authenticated;

  perform set_config('request.jwt.claim.sub', v_owner_b::text, true);
  v_file := gen_random_uuid();
  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_owner_b::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'cross.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued, v_sig
    );
    raise exception 'FAIL cross-tenant quote init allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%tenant access denied%' then raise; end if;
  end;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_file := gen_random_uuid();
  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_b::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'tamper-quote.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued, v_sig
    );
    raise exception 'FAIL altered quote_id allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%invalid capability%' then raise; end if;
  end;

  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file_other::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'tamper-file.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued, v_sig
    );
    raise exception 'FAIL altered file_id allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%invalid capability%' then raise; end if;
  end;

  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || (v_issued - 121)::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'expired.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued - 121, v_sig
    );
    raise exception 'FAIL expired capability allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%invalid capability%' then raise; end if;
  end;

  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  v_bad := overlay(v_sig placing case substring(v_sig from 1 for 1) when 'a' then 'b' else 'a' end from 1 for 1);
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'badsig.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued, v_bad
    );
    raise exception 'FAIL altered signature allowed';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%invalid capability%' then raise; end if;
  end;

  v_sig := encode(extensions.hmac(convert_to(
    'files-v1|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'order-cap.pdf', 'application/pdf', 100,
      now() + interval '15 minutes', v_issued, v_sig
    );
    raise exception 'FAIL order capability authorized a quote file';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%invalid capability%' then raise; end if;
  end;

  reset role;
  select id into v_feature from public.features where code = 'storage_bytes';
  insert into public.plans (id, code, name, active, sort_order, price_monthly, price_yearly)
  values (v_plan, 'phase35_quota', 'Phase35', true, 99, 0, 0);
  insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
  values (v_plan, v_feature, true, 10000);
  insert into public.subscriptions (
    id, tenant_id, plan_id, status, current_period_start, current_period_end
  ) values (
    'e3500000-0000-4000-8000-000000000092', v_tenant_a, v_plan, 'active',
    now() - interval '1 day', now() + interval '30 days'
  );

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  v_sig := encode(extensions.hmac(convert_to(
    'files-v1|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_order_a::text || '|' || v_file_order::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  perform public.create_order_file_upload(
    v_order_a, v_file_order, 'order.pdf', 'application/pdf', 8000,
    now() + interval '15 minutes', v_issued, v_sig
  );

  v_file := gen_random_uuid();
  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  begin
    perform public.create_quote_file_upload(
      v_quote_a, v_file, 'over.pdf', 'application/pdf', 8000,
      now() + interval '15 minutes', v_issued, v_sig
    );
    raise exception 'FAIL quote init ignored order reservation';
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message not like '%storage_quota_exceeded%' then raise; end if;
  end;

  v_sig := encode(extensions.hmac(convert_to(
    'files-v1|delete|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_order_a::text || '|' || v_file_order::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  perform public.soft_delete_order_file(v_order_a, v_file_order, v_issued, v_sig);

  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|create|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  v_result := public.create_quote_file_upload(
    v_quote_a, v_file, 'after-delete.pdf', 'application/pdf', 8000,
    now() + interval '15 minutes', v_issued, v_sig
  );
  if v_result->'file'->>'status' is distinct from 'pending' then
    raise exception 'FAIL quote init after order delete';
  end if;

  reset role;
  v_usage := public.tenant_storage_usage(v_tenant_a);
  set local role authenticated;
  if (v_usage->>'pending_bytes')::bigint < 8000 then
    raise exception 'FAIL pending bytes not reserved %', v_usage;
  end if;

  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|complete|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  v_result := public.complete_quote_file_upload(
    v_quote_a, v_file, 'etag-ok', v_issued, v_sig
  );
  if v_result->'file'->>'status' is distinct from 'ready' then
    raise exception 'FAIL complete did not become ready';
  end if;

  reset role;
  v_usage := public.tenant_storage_usage(v_tenant_a);
  set local role authenticated;
  if (v_usage->>'ready_bytes')::bigint < 8000 then
    raise exception 'FAIL ready bytes missing %', v_usage;
  end if;

  select count(*) into v_count
  from public.list_quote_activity(v_quote_a)
  where action = 'quote.file_uploaded';
  if v_count < 1 then
    raise exception 'FAIL upload missing from list_quote_activity';
  end if;

  perform set_config('request.jwt.claim.sub', v_staff_a::text, true);
  set local role authenticated;
  select count(*) into v_count from public.activity_log where tenant_id = v_tenant_a;
  if v_count <> 0 then
    raise exception 'FAIL staff can read global activity_log';
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  v_sig := encode(extensions.hmac(convert_to(
    'files-v1-quote|delete|' || v_owner_a::text || '|' || v_tenant_a::text
    || '|' || v_quote_a::text || '|' || v_file::text || '|' || v_issued::text, 'UTF8'
  ), convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  perform public.soft_delete_quote_file(v_quote_a, v_file, v_issued, v_sig);
  reset role;
  v_usage := public.tenant_storage_usage(v_tenant_a);
  set local role authenticated;
  if (v_usage->>'reserved_bytes')::bigint >= 8000
     and exists (
       select 1 from public.quote_files
       where id = v_file and deleted_at is null
     )
  then
    raise exception 'FAIL deleted file still reserved';
  end if;

  select count(*) into v_count
  from public.list_quote_activity(v_quote_a)
  where action = 'quote.file_deleted';
  if v_count < 1 then
    raise exception 'FAIL delete missing from list_quote_activity';
  end if;

  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claim.role', '', true);
  v_file := gen_random_uuid();
  insert into public.quote_files (
    id, tenant_id, quote_id, original_name, content_type, size_bytes,
    storage_provider, storage_key, status, etag, uploaded_by,
    upload_expires_at, completed_at
  ) values (
    v_file, v_tenant_a, v_quote_a, 'keep.pdf', 'application/pdf', 50,
    'r2', 'quotes/' || v_tenant_a || '/' || v_quote_a || '/' || v_file,
    'ready', 'etag', v_owner_a, now() + interval '1 hour', now()
  );

  perform set_config('request.jwt.claim.sub', v_owner_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  v_result := public.convert_quote_to_order(v_quote_a);
  if (v_result->>'ok')::boolean is distinct from true then
    raise exception 'FAIL convert %', v_result;
  end if;
  v_order_id := (v_result->>'order_id')::uuid;
  if (select metadata->>'source' from public.orders where id = v_order_id) is distinct from 'quote' then
    raise exception 'FAIL order metadata source';
  end if;
  select count(*) into v_count from public.order_files where order_id = v_order_id;
  if v_count <> 0 then
    raise exception 'FAIL conversion copied quote files onto the order';
  end if;
  if not exists (
    select 1 from public.quote_files
    where id = v_file and quote_id = v_quote_a and deleted_at is null
  ) then
    raise exception 'FAIL quote file detached on conversion';
  end if;
end;
$phase35$;

rollback;
