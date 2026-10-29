-- Rollback for 20261028090000_commercial_plans_pro_offers_v1.sql.
--
-- Drops the tenant billing offer RPCs and set_feature_rollout_v1, restores
-- tenant_has_feature as in 20260923190000_quotes_v1 (no hold check), removes
-- quotes and clients_import from Basic, and retires plan pro.
--
-- WARNING: tenants on Basic lose quotes and clients_import unless they have a
-- tenant feature override. List them first (docs/BILLING-PRO-OFFERS-V1.md,
-- preflight query) and grant overrides where needed. Only for an incident,
-- with authorization.
--
-- Refuses (raises, nothing changes) when any subscription is on pro: a paying
-- Pro customer needs a commercial decision, not a rollback.
--
-- Data kept: billing_private.tenant_billing_offers and
-- billing_private.feature_rollouts with their rows (evidence of grants,
-- acceptances, holds and releases); nothing reads feature_rollouts after
-- this. Pro billing_prices rows are deactivated, not deleted; the pro plan
-- row stays inactive because they reference it.

begin;

do $$
begin
  if exists (
    select 1
    from public.subscriptions s
    join public.plans p on p.id = s.plan_id
    where p.code = 'pro'
  ) then
    raise exception 'rollback refused: subscriptions on plan pro exist';
  end if;
end;
$$;

-- Restore the resolver first (same body as 20260923190000_quotes_v1).
create or replace function public.tenant_has_feature (
  p_tenant_id uuid,
  p_code text
)
  returns boolean
  language plpgsql
  stable
  security definer
  set search_path to ''
as $function$
declare
  v_role text := coalesce(auth.role(), '');
  v_enabled boolean;
begin
  -- authenticated may only resolve tenants where they have an active membership.
  -- service_role and a direct postgres/supabase_admin session keep operational access.
  -- A JWT role of authenticated is never treated as operational, even if session_user is postgres.
  if v_role = 'service_role'
     or (
       v_role = ''
       and session_user in ('postgres', 'supabase_admin')
     )
  then
    null;
  elsif v_role = 'authenticated'
     and exists (
       select 1
       from public.memberships m
       where m.tenant_id = p_tenant_id
         and m.user_id = auth.uid()
         and m.active is true
     )
  then
    null;
  else
    return false;
  end if;

  select o.enabled into v_enabled
  from public.tenant_feature_overrides o
  join public.features f on f.id = o.feature_id
  where o.tenant_id = p_tenant_id
    and f.code = p_code;

  if found then
    return coalesce(v_enabled, false);
  end if;

  -- Plan fallback does not filter subscriptions.livemode.
  -- Do not use this resolver for Stripe-sensitive features until that mode is part of the rule.
  -- quotes is not attached to Basic or mvp, so this fallback does not enable it.
  select pf.enabled into v_enabled
  from public.subscriptions s
  join public.plan_features pf on pf.plan_id = s.plan_id
  join public.features f on f.id = pf.feature_id
  where s.tenant_id = p_tenant_id
    and f.code = p_code
    and s.status in ('active', 'trialing')
  order by s.created_at desc
  limit 1;

  return coalesce(v_enabled, false);
end;
$function$;

drop function if exists public.set_feature_rollout_v1(text, text, text, text);
drop function if exists public.redeem_tenant_billing_offer_v1(uuid, uuid, boolean, text, text);
drop function if exists public.accept_tenant_billing_offer_v1(uuid, uuid, uuid, text);
drop function if exists public.list_tenant_billing_offers_v1(uuid, boolean, boolean);
drop function if exists public.revoke_tenant_billing_offer_v1(uuid, text, text);
drop function if exists public.grant_tenant_billing_offer_v1(
  uuid, text, boolean, text, bigint, text, integer, timestamptz, timestamptz, timestamptz, text, text, text
);

delete from public.plan_features pf
using public.plans p, public.features f
where pf.plan_id = p.id
  and pf.feature_id = f.id
  and p.code = 'basic'
  and f.code in ('quotes', 'clients_import');

update public.billing_prices bp
set active = false, updated_at = pg_catalog.now()
from public.plans p
where bp.plan_id = p.id
  and p.code = 'pro'
  and bp.active is true;

delete from public.plan_features pf
using public.plans p
where pf.plan_id = p.id
  and p.code = 'pro';

update public.plans
set active = false, updated_at = pg_catalog.now()
where code = 'pro';

commit;
