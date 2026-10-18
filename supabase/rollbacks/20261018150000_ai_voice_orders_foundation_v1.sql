-- Rollback for 20261018150000_ai_voice_orders_foundation_v1.sql (#90).
--
-- Use only if the voice ledger itself must be withdrawn. Rolling back the
-- APPLICATION alone does not need this script: no other code reads these
-- tables or calls these RPCs, and the platform kill switch is off by default.
--
-- What it does:
--   * refuses to run if the ledger holds any usage event (those are the cost
--     records of real provider calls): from that point recover forward, or
--     export ai_usage_events first;
--   * drops the seven RPCs and both tables. The catalog code ai_voice_orders
--     belongs to 20261015200000 (#105) and is NOT touched, nor are any
--     tenant_feature_overrides.
-- Verified on a database with main + #90: afterwards no ai_* object remains
-- and the catalog equals that of main.
-- Then: supabase migration repair --status reverted 20261018150000
begin;

do $guard$
begin
  if to_regclass('public.ai_usage_events') is not null
     and exists (select 1 from public.ai_usage_events) then
    raise exception 'rollback_90_refused: ai_usage_events has rows; recover forward';
  end if;
end;
$guard$;

drop function if exists public.ai_set_voice_usage_limit(text, text, uuid, boolean, bigint, integer, integer, integer);
drop function if exists public.ai_voice_status(uuid);
drop function if exists public.ai_settle_usage(uuid, text, bigint, numeric, integer, integer, text);
drop function if exists public.ai_reserve_usage(uuid, text, text, uuid, bigint, text, text, text);
drop function if exists public.ai_usage_charged_micros(text, uuid, uuid, text, date);
drop function if exists public.ai_resolve_limits(uuid, uuid, text);
drop function if exists public.ai_expire_stale_reservations(uuid, uuid, text);
drop table if exists public.ai_usage_events;
drop table if exists public.ai_usage_limits;

commit;
