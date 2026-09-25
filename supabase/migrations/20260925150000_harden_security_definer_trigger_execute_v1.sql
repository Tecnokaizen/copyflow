-- SECURITY DEFINER trigger hardening V1.
--
-- Three SECURITY DEFINER trigger functions still carry the default EXECUTE
-- privilege for client roles (via PUBLIC and/or explicit grants):
--   * public.enforce_tenant_active_immutability()  -> trg_tenants_active_immutable
--   * public.tg_assign_quote_reference()            -> quotes_assign_reference
--   * public.tg_quotes_activity()                   -> quotes_activity
--
-- Trigger functions are only meant to be fired by their triggers. PostgreSQL
-- does not check EXECUTE on the function when a trigger fires, so revoking it
-- from client roles does not change trigger behaviour. This aligns them with
-- the existing pattern used by the tg_activity_log_* functions
-- (REVOKE ALL FROM PUBLIC + GRANT EXECUTE TO postgres only).
--
-- Scope: privileges only. Function bodies, triggers, RLS and every other
-- SECURITY DEFINER function are left untouched.

begin;

revoke all on function public.enforce_tenant_active_immutability() from public;
revoke all on function public.enforce_tenant_active_immutability() from anon, authenticated, service_role;
grant execute on function public.enforce_tenant_active_immutability() to postgres;

revoke all on function public.tg_assign_quote_reference() from public;
revoke all on function public.tg_assign_quote_reference() from anon, authenticated, service_role;
grant execute on function public.tg_assign_quote_reference() to postgres;

revoke all on function public.tg_quotes_activity() from public;
revoke all on function public.tg_quotes_activity() from anon, authenticated, service_role;
grant execute on function public.tg_quotes_activity() to postgres;

commit;
