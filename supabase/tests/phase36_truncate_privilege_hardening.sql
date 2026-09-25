-- DB TRUNCATE hardening V1 (migration 20260925123000_harden_truncate_privileges_v1).
--
-- Read-only invariant suite: it creates no fixtures and mutates nothing, so it
-- can also be run as a post-apply verification. Wrapped in begin/rollback to
-- follow the repo convention.
--
-- supabase_admin: Production confirms that postgres is NOT a member of
-- supabase_admin. Its default privileges are out of scope for this migration
-- and are documented as a residual platform risk; this suite makes no
-- assertions about them.
begin;

do $phase36$
declare
  v_offenders text;
  v_table text;
  v_privilege text;
  v_rls boolean;
begin
  -- A. No current table in public grants TRUNCATE to anon or authenticated.
  -- Effective check via has_table_privilege (covers direct and inherited
  -- grants), over ordinary and partitioned tables.
  select string_agg(format('%s:%s', r.rolname, c.relname), ', ' order by r.rolname, c.relname)
    into v_offenders
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'::name), ('authenticated'::name)) as r(rolname)
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and has_table_privilege(r.rolname, c.oid, 'TRUNCATE');

  if v_offenders is not null then
    raise exception 'phase36: TRUNCATE still granted on public tables -> %', v_offenders;
  end if;

  -- B. Default privileges of postgres for tables in public (schema-level entry)
  -- and globally (defaclnamespace = 0) must not hand TRUNCATE to anon or
  -- authenticated. Uses aclexplode over the real catalog, not text matching.
  select string_agg(
           format('%s(%s)', g.rolname, coalesce(n.nspname, '<global>')),
           ', ' order by g.rolname)
    into v_offenders
  from pg_catalog.pg_default_acl d
  left join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
  cross join lateral aclexplode(d.defaclacl) a
  join pg_catalog.pg_roles g on g.oid = a.grantee
  where d.defaclrole = 'postgres'::regrole
    and d.defaclobjtype = 'r'
    and (d.defaclnamespace = 0 or n.nspname = 'public')
    and g.rolname in ('anon', 'authenticated')
    and a.privilege_type = 'TRUNCATE';

  if v_offenders is not null then
    raise exception 'phase36: postgres default privileges still grant TRUNCATE on new tables -> %', v_offenders;
  end if;

  -- C. RLS stays enabled on key tenant tables.
  foreach v_table in array array['orders', 'clients', 'services'] loop
    select c.relrowsecurity
      into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_table;

    if v_rls is distinct from true then
      raise exception 'phase36: RLS is not enabled on public.%', v_table;
    end if;
  end loop;

  -- D. Normal authenticated privileges that the app relies on are intact
  -- (row access is still governed by RLS).
  foreach v_table in array array['orders', 'clients', 'services'] loop
    foreach v_privilege in array array['SELECT', 'INSERT', 'UPDATE'] loop
      if not has_table_privilege('authenticated', format('public.%I', v_table), v_privilege) then
        raise exception 'phase36: authenticated lost % on public.%', v_privilege, v_table;
      end if;
    end loop;
  end loop;

  -- E. Administrative roles are not touched by this migration.
  if not has_table_privilege('service_role', 'public.orders', 'SELECT') then
    raise exception 'phase36: service_role lost SELECT on public.orders';
  end if;

  raise notice 'phase36_truncate_privilege_hardening_ok';
end;
$phase36$;

rollback;
