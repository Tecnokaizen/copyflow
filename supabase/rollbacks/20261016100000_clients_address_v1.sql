-- Rollback for 20261016100000_clients_address_v1.sql (#107).
--
-- Use only if the address change itself must be withdrawn. Rolling back the
-- APPLICATION alone does not need this script: the previous app ignores the
-- nullable clients.address column and never calls the v2 RPCs.
--
-- What it does:
--   * refuses to run if any client already has an address (it would be lost):
--     from that point recover forward, or export the addresses first;
--   * drops create_client_v2 / update_client_v2, the length check and the
--     column. create_client / update_client are untouched by the migration.
-- Verified on a database with main + #107: afterwards the clients columns,
-- constraints, triggers and RPCs equal those of main.
-- Then: supabase migration repair --status reverted 20261016100000
begin;

do $guard$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clients' and column_name = 'address'
  ) and exists (select 1 from public.clients where address is not null) then
    raise exception 'rollback_107_refused: clients with an address exist; recover forward';
  end if;
end;
$guard$;

drop function if exists public.update_client_v2(uuid, uuid, text, text, text, text, text, text, text, uuid, text);
drop function if exists public.create_client_v2(uuid, text, text, text, text, text, text, text, uuid, text);
alter table public.clients drop constraint if exists clients_address_length_check;
alter table public.clients drop column if exists address;

commit;
