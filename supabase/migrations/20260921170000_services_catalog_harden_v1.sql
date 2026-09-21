-- Settings V1 · harden services catalog identity and category binding.
-- Preflight confirmed zero orphan/cross-tenant category_id rows.
-- Does not change create_service / update_service / list_services contracts.

begin;

-- ---------------------------------------------------------------------------
-- Immutable tenant_id on services
-- ---------------------------------------------------------------------------
create or replace function public.tg_services_immutable_tenant()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if new.tenant_id is distinct from old.tenant_id then
    raise exception 'service_tenant_immutable'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.tg_services_immutable_tenant() is
  'BEFORE UPDATE: services.tenant_id is immutable for all roles.';

revoke all on function public.tg_services_immutable_tenant()
  from public;
grant execute on function public.tg_services_immutable_tenant()
  to postgres;

drop trigger if exists trg_services_immutable_tenant on public.services;
create trigger trg_services_immutable_tenant
  before update on public.services
  for each row
  execute function public.tg_services_immutable_tenant();

-- ---------------------------------------------------------------------------
-- Tenant-aware category FK (NULL category allowed via MATCH SIMPLE)
-- ---------------------------------------------------------------------------
alter table public.services
  add constraint services_tenant_category_fkey
  foreign key (tenant_id, category_id)
  references public.service_categories (tenant_id, id)
  on delete restrict
  on update restrict;

comment on constraint services_tenant_category_fkey on public.services is
  'Service category must be null or belong to the same tenant. No cascade.';

commit;
