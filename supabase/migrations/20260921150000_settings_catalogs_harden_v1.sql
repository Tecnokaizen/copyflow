-- Settings V1 · harden operational catalogs against PostgREST bypass.
-- Immutable tenant_id (all 8). Immutable code (6 with code).
-- Reserve entry_channels.code='kiosk' for dedicated Kiosk paths.
-- Does not revoke authenticated INSERT/UPDATE (Settings API depends on them).
-- create_organization / seeds / kiosk tests that run as postgres remain unaffected
-- (guard keys off current_user = 'authenticated'). Privileged bypass:
--   select set_config('app.allow_kiosk_channel_mutation', 'true', true);

begin;

-- ---------------------------------------------------------------------------
-- Generic identity immutability for Settings catalogs
-- ---------------------------------------------------------------------------
create or replace function public.tg_settings_catalog_immutable_identity()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_new jsonb := pg_catalog.to_jsonb(new);
  v_old jsonb := pg_catalog.to_jsonb(old);
begin
  if (v_new ->> 'tenant_id') is distinct from (v_old ->> 'tenant_id') then
    raise exception 'catalog_tenant_immutable'
      using errcode = '42501';
  end if;

  if v_new ? 'code'
     and (v_new ->> 'code') is distinct from (v_old ->> 'code') then
    raise exception 'catalog_code_immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.tg_settings_catalog_immutable_identity() is
  'BEFORE UPDATE: tenant_id always immutable; code immutable when the row has a code column.';

revoke all on function public.tg_settings_catalog_immutable_identity()
  from public;
grant execute on function public.tg_settings_catalog_immutable_identity()
  to postgres;

-- Attach to all eight Settings catalogs.
drop trigger if exists trg_customer_types_immutable_identity on public.customer_types;
create trigger trg_customer_types_immutable_identity
  before update on public.customer_types
  for each row
  execute function public.tg_settings_catalog_immutable_identity();

drop trigger if exists trg_entry_channels_immutable_identity on public.entry_channels;
create trigger trg_entry_channels_immutable_identity
  before update on public.entry_channels
  for each row
  execute function public.tg_settings_catalog_immutable_identity();

drop trigger if exists trg_order_contexts_immutable_identity on public.order_contexts;
create trigger trg_order_contexts_immutable_identity
  before update on public.order_contexts
  for each row
  execute function public.tg_settings_catalog_immutable_identity();

drop trigger if exists trg_file_statuses_immutable_identity on public.file_statuses;
create trigger trg_file_statuses_immutable_identity
  before update on public.file_statuses
  for each row
  execute function public.tg_settings_catalog_immutable_identity();

drop trigger if exists trg_quote_statuses_immutable_identity on public.quote_statuses;
create trigger trg_quote_statuses_immutable_identity
  before update on public.quote_statuses
  for each row
  execute function public.tg_settings_catalog_immutable_identity();

drop trigger if exists trg_payment_statuses_immutable_identity on public.payment_statuses;
create trigger trg_payment_statuses_immutable_identity
  before update on public.payment_statuses
  for each row
  execute function public.tg_settings_catalog_immutable_identity();

drop trigger if exists trg_delivery_methods_immutable_identity on public.delivery_methods;
create trigger trg_delivery_methods_immutable_identity
  before update on public.delivery_methods
  for each row
  execute function public.tg_settings_catalog_immutable_identity();

drop trigger if exists trg_service_categories_immutable_identity on public.service_categories;
create trigger trg_service_categories_immutable_identity
  before update on public.service_categories
  for each row
  execute function public.tg_settings_catalog_immutable_identity();

-- ---------------------------------------------------------------------------
-- Kiosk channel reserve (entry_channels only)
-- ---------------------------------------------------------------------------
create or replace function public.tg_entry_channels_kiosk_guard()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_setting text := coalesce(
    pg_catalog.current_setting('app.allow_kiosk_channel_mutation', true),
    ''
  );
begin
  -- Privileged / future dedicated Kiosk RPCs can opt in per-transaction.
  if v_setting = 'true' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- Only constrain sessions that are actually running as the PostgREST
  -- `authenticated` DB role. Seeds/tests/postgres (even with leftover JWT
  -- claims) and SECURITY DEFINER paths remain usable for privileged opt-in.
  if current_user is distinct from 'authenticated' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(new.code, ''))) = 'kiosk' then
      raise exception 'kiosk_channel_reserved'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if pg_catalog.lower(pg_catalog.btrim(coalesce(old.code, ''))) = 'kiosk'
       and new.active is distinct from old.active then
      raise exception 'kiosk_channel_active_immutable'
        using errcode = '42501';
    end if;
    return new;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

comment on function public.tg_entry_channels_kiosk_guard() is
  'Blocks authenticated inserts of code=kiosk and authenticated active flips on kiosk. Bypass via app.allow_kiosk_channel_mutation=true.';

revoke all on function public.tg_entry_channels_kiosk_guard()
  from public;
grant execute on function public.tg_entry_channels_kiosk_guard()
  to postgres;

drop trigger if exists trg_entry_channels_kiosk_guard on public.entry_channels;
create trigger trg_entry_channels_kiosk_guard
  before insert or update on public.entry_channels
  for each row
  execute function public.tg_entry_channels_kiosk_guard();

commit;
