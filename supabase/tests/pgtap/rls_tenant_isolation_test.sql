-- pgTAP: multi-tenant RLS isolation at the database layer.
-- Runs with `supabase test db supabase/tests/pgtap`.
--
-- Setup runs as the superuser (RLS bypassed) to create two tenants with data.
-- Assertions run as the `authenticated` role with a real JWT claim
-- (request.jwt.claims -> sub = auth.uid()), i.e. the exact context PostgREST
-- uses for the app. Everything is rolled back at the end.

BEGIN;

SELECT plan(6);

-- Fixtures ------------------------------------------------------------------
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, recovery_token,
  email_change_token_new, email_change
) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner-a@rls.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Owner A"}'::jsonb, now(), now(), '', '', '', ''),
  ('bbbbbbbb-0000-4000-8000-000000000001',
   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'owner-b@rls.test', crypt('pw', gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"full_name":"Owner B"}'::jsonb, now(), now(), '', '', '', '');

INSERT INTO public.profiles (id, full_name) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Owner A'),
  ('bbbbbbbb-0000-4000-8000-000000000001', 'Owner B');

INSERT INTO public.tenants (id, name, slug, active) VALUES
  ('aaaaaaaa-1111-4000-8000-000000000001', 'Tenant A', 'rls-tenant-a', true),
  ('bbbbbbbb-1111-4000-8000-000000000001', 'Tenant B', 'rls-tenant-b', true);

INSERT INTO public.memberships (id, tenant_id, user_id, role, active) VALUES
  ('aaaaaaaa-3333-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000001', 'owner', true),
  ('bbbbbbbb-3333-4000-8000-000000000001',
   'bbbbbbbb-1111-4000-8000-000000000001',
   'bbbbbbbb-0000-4000-8000-000000000001', 'owner', true);

-- Clients carry an AFTER INSERT activity-log trigger that needs auth.uid().
-- Keep the superuser role (so RLS is bypassed for setup) but set the matching
-- JWT claim so the trigger can resolve the acting owner.
SET LOCAL request.jwt.claims TO
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';
INSERT INTO public.clients (id, tenant_id, name) VALUES
  ('aaaaaaaa-2222-4000-8000-000000000001',
   'aaaaaaaa-1111-4000-8000-000000000001', 'Client A');

SET LOCAL request.jwt.claims TO
  '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}';
INSERT INTO public.clients (id, tenant_id, name) VALUES
  ('bbbbbbbb-2222-4000-8000-000000000001',
   'bbbbbbbb-1111-4000-8000-000000000001', 'Client B');

-- Act as the authenticated role and record blocked-update row counts.
SET LOCAL role authenticated;
CREATE TEMP TABLE _mod (label text, n int);

-- Owner A -------------------------------------------------------------------
SET LOCAL request.jwt.claims TO
  '{"sub":"aaaaaaaa-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.clients
     WHERE id = 'aaaaaaaa-2222-4000-8000-000000000001'),
  1, 'A can read its own client');

SELECT is(
  (SELECT count(*)::int FROM public.clients
     WHERE tenant_id = 'bbbbbbbb-1111-4000-8000-000000000001'),
  0, 'A cannot read tenant B clients');

DO $$
DECLARE c int;
BEGIN
  UPDATE public.clients SET name = 'HACKED BY A'
    WHERE id = 'bbbbbbbb-2222-4000-8000-000000000001';
  GET DIAGNOSTICS c = ROW_COUNT;
  INSERT INTO _mod VALUES ('a', c);
END $$;

-- Owner B -------------------------------------------------------------------
SET LOCAL request.jwt.claims TO
  '{"sub":"bbbbbbbb-0000-4000-8000-000000000001","role":"authenticated"}';

SELECT is(
  (SELECT count(*)::int FROM public.clients
     WHERE id = 'bbbbbbbb-2222-4000-8000-000000000001'),
  1, 'B can read its own client');

SELECT is(
  (SELECT count(*)::int FROM public.clients
     WHERE tenant_id = 'aaaaaaaa-1111-4000-8000-000000000001'),
  0, 'B cannot read tenant A clients');

DO $$
DECLARE c int;
BEGIN
  UPDATE public.clients SET name = 'HACKED BY B'
    WHERE id = 'aaaaaaaa-2222-4000-8000-000000000001';
  GET DIAGNOSTICS c = ROW_COUNT;
  INSERT INTO _mod VALUES ('b', c);
END $$;

SELECT is((SELECT n FROM _mod WHERE label = 'a'), 0,
  'A cannot modify tenant B clients');
SELECT is((SELECT n FROM _mod WHERE label = 'b'), 0,
  'B cannot modify tenant A clients');

RESET role;

SELECT * FROM finish();

ROLLBACK;
