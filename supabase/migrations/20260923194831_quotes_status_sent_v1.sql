-- Quotes UX: additive status "sent". pending stays as a code.
-- Rename the default label only when the tenant never customized it.

create or replace function public.seed_quote_statuses (
  p_tenant_id uuid
)
  returns void
  language plpgsql
  security definer
  set search_path to ''
as $function$
begin
  insert into public.quote_statuses (
    tenant_id, name, code, active, sort_order
  ) values
    (p_tenant_id, 'Borrador', 'draft', true, 10),
    (p_tenant_id, 'En revisión', 'pending', true, 20),
    (p_tenant_id, 'Enviado', 'sent', true, 30),
    (p_tenant_id, 'Aceptado', 'accepted', true, 40),
    (p_tenant_id, 'Rechazado', 'rejected', true, 50)
  on conflict (tenant_id, code) do nothing;
end;
$function$;

comment on function public.seed_quote_statuses(uuid) is
  'Idempotent quote status catalog. Does not rename or delete existing codes.';

update public.quote_statuses
set name = 'En revisión'
where code = 'pending'
  and name = 'Pendiente';

insert into public.quote_statuses (
  tenant_id, name, code, active, sort_order
)
select
  t.id,
  'Enviado',
  'sent',
  true,
  25
from public.tenants t
where not exists (
  select 1
  from public.quote_statuses qs
  where qs.tenant_id = t.id
    and qs.code = 'sent'
);
