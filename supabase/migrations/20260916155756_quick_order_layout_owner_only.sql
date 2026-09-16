-- Quick Order Layout configuration is owner-only, while the historical
-- owner/admin policy for every other tenant setting remains unchanged.

create or replace function public.tg_protect_quick_order_layout_owner()
returns trigger
language plpgsql
security invoker
set search_path to ''
as $function$
begin
  if new.preferences -> 'quick_order_layout_v1'
       is distinct from old.preferences -> 'quick_order_layout_v1'
     and not public.has_tenant_role(
       old.tenant_id,
       array['owner'::text]
     ) then
    raise exception 'Only the tenant owner can configure quick order layout'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

drop trigger if exists tenant_settings_protect_quick_order_layout
  on public.tenant_settings;

create trigger tenant_settings_protect_quick_order_layout
  before update of preferences on public.tenant_settings
  for each row
  execute function public.tg_protect_quick_order_layout_owner();

revoke all on function public.tg_protect_quick_order_layout_owner()
  from public, anon, authenticated, service_role;
grant execute on function public.tg_protect_quick_order_layout_owner()
  to postgres;

comment on function public.tg_protect_quick_order_layout_owner() is
  'INVOKER trigger: protects only preferences.quick_order_layout_v1 as owner-only; other tenant settings retain historical owner/admin RLS.';
