-- Phase 1: memberships remains readable under its existing SELECT policy, but
-- authenticated users must not mutate access rows directly. Future membership
-- mutations will be exposed only through purpose-built, atomic RPCs.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
ON TABLE public.memberships
FROM authenticated;

-- RLS does not apply to TRUNCATE. The application has no legitimate TRUNCATE
-- path for identity or tenant records.
REVOKE TRUNCATE
ON TABLE public.profiles, public.tenants
FROM authenticated;

-- The existing memberships INSERT/UPDATE policies are intentionally retained
-- in this phase. They are ineffective for authenticated direct DML after the
-- privilege revocation and can be removed when the replacement RPCs land.
--
-- Next phase invariants for those RPCs:
-- - never create an owner from the Users and permissions UI;
-- - never demote or revoke an owner through the MVP management flow;
-- - never leave a tenant without an active owner;
-- - never allow an owner to revoke their own owner access;
-- - never allow an admin to modify owner or admin memberships.
--
-- Profile provisioning is unchanged in this phase. Auth signup can leave a
-- user without public.profiles; create_organization guarantees the profile;
-- a future accept_tenant_invitation RPC must guarantee it before membership.
