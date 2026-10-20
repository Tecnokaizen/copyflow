-- B1.3 recovery drill fixture: rows in public and in every Gestcopy private
-- schema, including the cross-schema trigger and FK (public.clients →
-- imports_private) that a public-only archive could not restore.
-- Local disposable source only. billing_private rows are created only when the
-- checked-out migrations define that schema.

begin;

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values (
  'b1300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated', 'recovery-owner@b13.test', '', now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', ''
);

insert into public.profiles (id, full_name)
values ('b1300000-0000-4000-8000-000000000001', 'Recovery Owner');

insert into public.tenants (id, name, slug, active)
values ('b1300000-0000-4000-8000-000000000011', 'Recovery Tenant', 'b13-recovery', true);

insert into public.memberships (tenant_id, user_id, role, active)
values ('b1300000-0000-4000-8000-000000000011', 'b1300000-0000-4000-8000-000000000001', 'owner', true);

insert into imports_private.client_import_batches (
  id, tenant_id, created_by, source_system, file_name, file_size, file_sha256,
  mapping, mapping_hash, expected_rows
) values (
  'b1300000-0000-4000-8000-000000000021', 'b1300000-0000-4000-8000-000000000011',
  'b1300000-0000-4000-8000-000000000001', 'b13-fixture', 'clientes.csv', 128,
  repeat('a', 64), '{}'::jsonb, repeat('b', 64), 1
);

insert into imports_private.client_import_rows (batch_id, row_number, tenant_id, normalized, row_hash)
values ('b1300000-0000-4000-8000-000000000021', 1, 'b1300000-0000-4000-8000-000000000011', '{}'::jsonb, repeat('c', 64));

-- Imported client: guarded by imports_private.guard_client_origin(); the
-- activity-log trigger needs an authenticated actor.
set local request.jwt.claims = '{"sub":"b1300000-0000-4000-8000-000000000001","role":"authenticated"}';
set local app.client_import_origin = 'on';
insert into public.clients (id, tenant_id, name, source_system, source_record_id, import_batch_id)
values (
  'b1300000-0000-4000-8000-000000000031', 'b1300000-0000-4000-8000-000000000011',
  'Cliente importado', 'b13-fixture', 'row-1', 'b1300000-0000-4000-8000-000000000021'
);
reset app.client_import_origin;
insert into public.clients (id, tenant_id, name)
values ('b1300000-0000-4000-8000-000000000032', 'b1300000-0000-4000-8000-000000000011', 'Cliente manual');

insert into files_private.storage_deletions (
  id, file_kind, tenant_id, parent_id, file_id, storage_key, reason
) values (
  'b1300000-0000-4000-8000-000000000041', 'order', 'b1300000-0000-4000-8000-000000000011',
  'b1300000-0000-4000-8000-000000000042', 'b1300000-0000-4000-8000-000000000043',
  'orders/b1300000-0000-4000-8000-000000000011/b1300000-0000-4000-8000-000000000042/b1300000-0000-4000-8000-000000000043',
  'user_delete'
);

insert into files_private.storage_deletion_events (deletion_id, event, attempt)
values ('b1300000-0000-4000-8000-000000000041', 'enqueued', 0);

insert into kiosk_private.kiosk_rate_limits (tenant_id, client_key, purpose, window_started_at, request_count)
values ('b1300000-0000-4000-8000-000000000011', repeat('d', 64), 'submit', now(), 1);

insert into kiosk_private.kiosk_request_permits (tenant_id, client_key, expires_at)
values ('b1300000-0000-4000-8000-000000000011', repeat('e', 64), now() + interval '1 day');

-- With billing_private (D2) a direct internal subscription is audited there.
insert into public.subscriptions (tenant_id, plan_id, provider, status, cancel_at_period_end)
select 'b1300000-0000-4000-8000-000000000011', p.id, 'internal', 'active', false
from public.plans p
where p.code = 'mvp';

do $fixture$
begin
  if to_regclass('billing_private.subscription_holds') is not null then
    execute $sql$
      insert into billing_private.subscription_holds (tenant_id, provider_subscription_id, livemode, last_status)
      values ('b1300000-0000-4000-8000-000000000011', 'sub_b13_fixture', false, 'trialing')
    $sql$;
  end if;
end;
$fixture$;

commit;
