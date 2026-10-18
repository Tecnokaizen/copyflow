-- Rollback for 20261018180000_tenant_feature_grants_audit_v1.sql (Frente A1).
--
-- Removes set_tenant_feature_v2, clear_tenant_feature_override,
-- list_tenant_feature_reviews_due, the history table and its triggers, and the
-- terms columns of tenant_feature_overrides; restores the default TRUNCATE of
-- service_role on it and the previous comments. set_tenant_feature and
-- tenant_has_feature were never changed, so they need nothing.
--
-- Every override row stays as it is (enabled and limit_value): nothing is
-- granted, revoked or re-resolved by this script.
--
-- It REFUSES to run when it would lose audit data: any event that is not a
-- baseline written by the migration, or any override with terms (reason or
-- review_at). Export the history first and then opt in explicitly:
--   \copy (select * from public.tenant_feature_override_events order by id) to 'tenant_feature_override_events.csv' csv header
--   PGOPTIONS='-c app.rollback_tenant_feature_grants=discard_history' psql ... -f <this file>
-- Needs its own diagnosis and authorization in any remote environment.
-- Verified locally: afterwards the schema equals that of the migrations up to
-- 20261018170000 (supabase/rollbacks/verify_20261018180000_tenant_feature_grants_audit_v1.sql).
-- Then: supabase migration repair --status reverted 20261018180000
begin;

do $guard$
begin
  if coalesce(current_setting('app.rollback_tenant_feature_grants', true), '') <> 'discard_history'
     and (
       exists (select 1 from public.tenant_feature_override_events where action <> 'baseline')
       or exists (
         select 1 from public.tenant_feature_overrides
         where reason is not null or review_at is not null
       )
     ) then
    raise exception 'rollback_tenant_feature_grants_refused: the feature grant history or terms would be lost; export them and set app.rollback_tenant_feature_grants=discard_history';
  end if;
end;
$guard$;

drop trigger trg_tenant_feature_overrides_no_truncate on public.tenant_feature_overrides;
drop trigger trg_tenant_feature_overrides_audit on public.tenant_feature_overrides;
drop trigger trg_tenant_feature_overrides_terms on public.tenant_feature_overrides;

drop function public.list_tenant_feature_reviews_due(timestamp with time zone);
drop function public.clear_tenant_feature_override(text, text, text, text);
drop function public.set_tenant_feature_v2(text, text, boolean, bigint, text, timestamp with time zone, text);

drop table public.tenant_feature_override_events;

drop function public.tg_tenant_feature_overrides_audit_v1();
drop function public.tg_tenant_feature_audit_refuse_v1();

alter table public.tenant_feature_overrides
  drop constraint tenant_feature_overrides_terms_check,
  drop constraint tenant_feature_overrides_granted_by_check,
  drop constraint tenant_feature_overrides_reason_check,
  drop column review_at,
  drop column granted_at,
  drop column granted_by,
  drop column reason;

grant truncate on table public.tenant_feature_overrides to service_role;

comment on table public.tenant_feature_overrides is
  'Explicit tenant feature gate. Overrides the plan. No client writes.';

comment on function public.set_tenant_feature(text, text, boolean, bigint) is
  'Idempotent operator override. service_role or database owner only.';

commit;
