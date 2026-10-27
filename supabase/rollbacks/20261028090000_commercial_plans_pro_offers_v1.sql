-- Rollback for 20261028090000_commercial_plans_pro_offers_v1.sql.
--
-- Drops the tenant billing offer RPCs, removes quotes and clients_import from
-- Basic, and retires plan pro.
--
-- WARNING: tenants on Basic lose quotes and clients_import unless they have a
-- tenant feature override. List them first (docs/BILLING-PRO-OFFERS-V1.md,
-- preflight query) and grant overrides where needed. Only for an incident,
-- with authorization.
--
-- Refuses (raises, nothing changes) when any subscription is on pro: a paying
-- Pro customer needs a commercial decision, not a rollback.
--
-- Data kept: billing_private.tenant_billing_offers and its rows (evidence of
-- grants and acceptances). Pro billing_prices rows are deactivated, not
-- deleted; the pro plan row stays inactive because they reference it.

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
