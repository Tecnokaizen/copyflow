-- DB TRUNCATE hardening V1.
--
-- TRUNCATE is not subject to Row Level Security. Copyflow runs N tenants on a
-- single shared PostgreSQL, so no client-facing role may hold TRUNCATE on any
-- table in public. Production confirmed TRUNCATE granted to anon (order_files,
-- stores) and authenticated (20 tables), plus default privileges for role
-- postgres in public that hand TRUNCATE to both roles on every new table.
--
-- Scope is strictly TRUNCATE for anon/authenticated:
--   * other privileges (SELECT/INSERT/UPDATE/DELETE/REFERENCES/TRIGGER/MAINTAIN)
--     are left untouched;
--   * postgres and service_role are left untouched;
--   * RLS, RPCs and business logic are left untouched.
--
-- Residual platform note: Production also shows historical default privileges
-- owned by supabase_admin in public that include TRUNCATE. postgres is NOT a
-- member of supabase_admin (verified in Production), so ALTER DEFAULT
-- PRIVILEGES FOR ROLE supabase_admin cannot run through the normal migration
-- flow and is intentionally NOT included here. The Copyflow schema must keep
-- being created exclusively through migrations executed as postgres.

begin;

revoke truncate
  on all tables in schema public
  from anon, authenticated;

alter default privileges
  for role postgres
  in schema public
  revoke truncate on tables
  from anon, authenticated;

commit;
