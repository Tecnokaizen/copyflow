-- Rollback for 20261018161000_billing_storage_capacity_explicit_v1.sql.
--
-- Restores resolve_tenant_storage_limit_bytes as in 20260921181000 (NULL =
-- quota not enforced) and removes the grant RPC, the capacity resolver, the
-- audit read model and the audit trigger.
--
-- WARNING: after this, tenants without a quota-bearing subscription have
-- unlimited storage again, which the S2 decision forbids. Only for an
-- incident, with authorization.
--
-- Keeps billing_private.internal_subscription_audit and its rows (audit
-- history is never deleted), the internal subscriptions granted meanwhile and
-- the explicit mvp capacity (harmless under the old resolver).

begin;

drop trigger if exists subscriptions_internal_audit on public.subscriptions;
drop function if exists public.tg_subscriptions_internal_audit();
drop function if exists public.grant_internal_subscription_v1(uuid, text, text, timestamptz, text, text, jsonb);
drop function if exists public.list_internal_subscription_audit_v1(uuid, integer);

create or replace function public.resolve_tenant_storage_limit_bytes(
  p_tenant_id uuid
)
returns bigint
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_limit bigint;
begin
  if p_tenant_id is null then
    return null;
  end if;

  select pf.limit_value
  into v_limit
  from public.subscriptions s
  join public.plans p
    on p.id = s.plan_id
  join public.plan_features pf
    on pf.plan_id = p.id
  join public.features f
    on f.id = pf.feature_id
  where s.tenant_id = p_tenant_id
    and s.status = any (array['trialing', 'active', 'past_due']::text[])
    and f.code = 'storage_bytes'
    and pf.enabled is true
  order by s.created_at desc
  limit 1;

  -- Missing feature row, disabled feature, or explicit NULL limit_value:
  -- legacy-unconfigured (do not enforce). limit_value = 0 means zero bytes.
  return v_limit;
end;
$function$;

comment on function public.resolve_tenant_storage_limit_bytes(uuid) is
  'Effective commercial storage quota in bytes from current subscription plan feature storage_bytes. NULL = not enforced / legacy-unconfigured.';

revoke all on function public.resolve_tenant_storage_limit_bytes(uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_tenant_storage_limit_bytes(uuid)
  to postgres, service_role;

-- The restored body no longer calls the capacity resolver.
drop function if exists public.resolve_tenant_storage_capacity_v1(uuid);

commit;
