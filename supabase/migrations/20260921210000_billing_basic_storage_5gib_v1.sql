-- Billing B2 · Basic included storage = 5 GiB.
-- 5 GiB = 5 * 1024^3 = 5368709120 bytes.
-- Does NOT attach storage_bytes to mvp. Does NOT touch tenant subscriptions.

begin;

insert into public.plan_features (plan_id, feature_id, enabled, limit_value)
select
  p.id,
  f.id,
  true,
  5368709120::bigint
from public.plans p
cross join public.features f
where p.code = 'basic'
  and f.code = 'storage_bytes'
on conflict (plan_id, feature_id) do update
set
  enabled = true,
  limit_value = 5368709120::bigint,
  updated_at = pg_catalog.now();

-- Guard: mvp must remain without storage_bytes row.
do $guard$
begin
  if exists (
    select 1
    from public.plan_features pf
    join public.plans p on p.id = pf.plan_id
    join public.features f on f.id = pf.feature_id
    where p.code = 'mvp'
      and f.code = 'storage_bytes'
  ) then
    raise exception 'billing_b2: mvp must not have storage_bytes plan_feature';
  end if;
end;
$guard$;

commit;
