-- Release gate: catalog-level security invariants after ALL migrations.
-- Read-only (no fixtures). Fails with the list of offending objects.
--
-- Changing an allowlist below is a security decision and must be reviewed.

do $release_gate$
declare
  v_offenders text;
  -- Unauthenticated entry points that are public by design (token / kiosk HMAC).
  v_anon_rpcs constant text[] := array[
    'preview_tenant_invitation(text)',
    'kiosk_bootstrap(text,text,bigint,text,text,text)',
    'admit_kiosk_request(text,text,bigint,text,text,text)',
    'submit_kiosk_order(text,text,bigint,text,text,text,uuid,uuid,text,uuid,text,text,text,text,text,timestamp with time zone,text)'
  ];
begin
  -- 1. Every public table enforces RLS.
  select string_agg(c.relname, ', ' order by c.relname) into v_offenders
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if v_offenders is not null then
    raise exception 'release gate: tables without RLS: %', v_offenders;
  end if;

  -- 2. anon cannot read or write any public relation directly.
  select string_agg(c.relname || ':' || p.priv, ', ' order by c.relname, p.priv) into v_offenders
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv)
  where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
    and has_table_privilege('anon', c.oid, p.priv);
  if v_offenders is not null then
    raise exception 'release gate: anon table privileges: %', v_offenders;
  end if;

  -- 3. authenticated cannot TRUNCATE (not covered by RLS).
  select string_agg(c.relname, ', ' order by c.relname) into v_offenders
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and has_table_privilege('authenticated', c.oid, 'TRUNCATE');
  if v_offenders is not null then
    raise exception 'release gate: authenticated TRUNCATE: %', v_offenders;
  end if;

  -- 4. Every SECURITY DEFINER routine in app schemas pins search_path.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_offenders
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where p.prosecdef
    and n.nspname in ('public', 'files_private', 'kiosk_private', 'imports_private')
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%'
    );
  if v_offenders is not null then
    raise exception 'release gate: SECURITY DEFINER without search_path: %', v_offenders;
  end if;

  -- 5. anon may only execute the allowlisted public SECURITY DEFINER RPCs.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_offenders
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not (p.oid::regprocedure::text = any (v_anon_rpcs));
  if v_offenders is not null then
    raise exception 'release gate: anon can execute SECURITY DEFINER: %', v_offenders;
  end if;

  -- 6. Private schemas stay closed to every API role.
  select string_agg(n.nspname || ':' || r.role, ', ' order by 1) into v_offenders
  from pg_namespace n
  cross join unnest(array['anon', 'authenticated', 'service_role', 'authenticator']) as r(role)
  where n.nspname in ('files_private', 'kiosk_private', 'imports_private')
    and has_schema_privilege(r.role, n.oid, 'USAGE');
  if v_offenders is not null then
    raise exception 'release gate: private schema usage: %', v_offenders;
  end if;

  raise notice 'release gate security invariants PASS';
end
$release_gate$;
