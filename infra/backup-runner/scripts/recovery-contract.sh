#!/usr/bin/env bash
# B1.3 recovery contract shared by backup-database.sh and restore-database-local.sh.
# Sourced, never executed. Defines which schemas form the application recovery
# set and the catalog fingerprint the restore must reproduce exactly.

# Schemas owned by PostgreSQL or the Supabase platform. Every other schema is
# Gestcopy application state and is dumped automatically, so a schema added by
# a future migration can never be silently left out of the recovery set.
GESTCOPY_PLATFORM_SCHEMAS=(
  _analytics _realtime _supavisor auth cron extensions graphql graphql_public
  net pgbouncer pgmq pgmq_public pgsodium pgsodium_masks pgtle realtime storage
  supabase_functions supabase_migrations tiger tiger_data topology vault
)

# Application schemas that already exist in Production. A source or archive
# without any of them is not a complete Gestcopy recovery set.
GESTCOPY_REQUIRED_APPLICATION_SCHEMAS=(public files_private imports_private kiosk_private)

GESTCOPY_FINGERPRINT_VERSION=1

# Role names whose privileges are administrative, not tenant-facing. `--no-owner`
# reassigns restored objects to the restoring role, so ACL entries of the owner
# and of these roles are not comparable between source and target.
GESTCOPY_ADMIN_ROLES_SQL="ARRAY['postgres','supabase_admin','pg_database_owner']::text[]"

valid_schema_name() {
  [[ "$1" =~ ^[a-z_][a-z0-9_]{0,62}$ ]]
}

# Prints a SQL text[] literal for the given (already validated) schema names.
schema_array_sql() {
  local name list=""
  for name in "$@"; do
    valid_schema_name "${name}" || return 1
    list+="${list:+,}'${name}'"
  done
  printf 'ARRAY[%s]::text[]' "${list}"
}

# One line: "gestcopy-application-schemas|a,b,c" (sorted).
application_schemas_sql() {
  local platform
  platform="$(schema_array_sql "${GESTCOPY_PLATFORM_SCHEMAS[@]}")"
  printf '%s' "SELECT 'gestcopy-application-schemas|' || coalesce(string_agg(nspname, ',' ORDER BY nspname COLLATE \"C\"), '') FROM pg_catalog.pg_namespace WHERE nspname <> 'information_schema' AND nspname !~ '^pg_' AND nspname <> ALL (${platform});"
}

# One line: "gestcopy-recovery-fingerprint|{json}". Exact per-schema counts and
# hashes of rows, RLS, policies, functions (incl. SECURITY DEFINER), triggers,
# constraints (incl. FKs), indexes, views, types, sequences and non-admin ACLs.
# Objects that belong to extensions are excluded. Single line, no `--` comments:
# backup-database.sh sends it through the snapshot exporter session.
recovery_fingerprint_sql() {
  local schemas
  schemas="$(schema_array_sql "$@")" || return 1
  cat <<SQL | tr '\n' ' '
WITH s AS (
  SELECT n.oid, n.nspname, n.nspowner, n.nspacl FROM pg_catalog.pg_namespace n
  WHERE n.nspname = ANY (${schemas})
),
ext AS (
  SELECT d.classid, d.objid FROM pg_catalog.pg_depend d WHERE d.deptype = 'e'
),
rels AS (
  SELECT c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.relrowsecurity,
         c.relforcerowsecurity, s.nspname
  FROM pg_catalog.pg_class c JOIN s ON s.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
    AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_catalog.pg_class'::regclass AND ext.objid = c.oid)
),
tabs AS (SELECT * FROM rels WHERE relkind IN ('r', 'p')),
row_counts AS (
  SELECT t.nspname, t.relname,
         (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', t.nspname, t.relname), false, true, '')))[1]::text::bigint AS n
  FROM tabs t
),
funcs AS (
  SELECT s.nspname, p.oid, p.prosecdef, p.proowner, p.proacl,
         CASE WHEN p.prokind IN ('f', 'p') THEN pg_catalog.pg_get_functiondef(p.oid)
              ELSE p.prokind::text || ':' || p.proname || '(' || pg_catalog.pg_get_function_identity_arguments(p.oid) || ')' END AS def
  FROM pg_catalog.pg_proc p JOIN s ON s.oid = p.pronamespace
  WHERE NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_catalog.pg_proc'::regclass AND ext.objid = p.oid)
),
pols AS (
  SELECT pol.schemaname AS nspname,
         concat_ws('|', pol.tablename, pol.policyname, pol.permissive, array_to_string(pol.roles, ','), pol.cmd, pol.qual, pol.with_check) AS def
  FROM pg_catalog.pg_policies pol JOIN s ON s.nspname = pol.schemaname
),
trigs AS (
  SELECT s.nspname, pg_catalog.pg_get_triggerdef(t.oid) AS def
  FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid JOIN s ON s.oid = c.relnamespace
  WHERE NOT t.tgisinternal
),
cons AS (
  SELECT s.nspname, con.contype,
         coalesce(con.conrelid::regclass::text, con.contypid::regtype::text) || '.' || con.conname || ':' || pg_catalog.pg_get_constraintdef(con.oid) AS def
  FROM pg_catalog.pg_constraint con JOIN s ON s.oid = con.connamespace
),
idx AS (
  SELECT s.nspname, pg_catalog.pg_get_indexdef(i.indexrelid) AS def
  FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indexrelid JOIN s ON s.oid = c.relnamespace
  WHERE NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_catalog.pg_class'::regclass AND ext.objid = c.oid)
),
views AS (
  SELECT nspname, relkind::text || ':' || relname || ':' || pg_catalog.pg_get_viewdef(oid) AS def FROM rels WHERE relkind IN ('v', 'm')
),
typs AS (
  SELECT s.nspname,
         t.typname || ':' || t.typtype::text || ':' || coalesce((SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder) FROM pg_catalog.pg_enum e WHERE e.enumtypid = t.oid), pg_catalog.format_type(t.typbasetype, t.typtypmod), '') AS def
  FROM pg_catalog.pg_type t JOIN s ON s.oid = t.typnamespace
  WHERE (t.typtype IN ('e', 'd') OR (t.typtype = 'c' AND EXISTS (SELECT 1 FROM pg_catalog.pg_class c WHERE c.oid = t.typrelid AND c.relkind = 'c')))
    AND NOT EXISTS (SELECT 1 FROM ext WHERE ext.classid = 'pg_catalog.pg_type'::regclass AND ext.objid = t.oid)
),
acl_src AS (
  SELECT s.nspname, 'schema:' || s.nspname AS obj, s.nspowner AS owner, coalesce(s.nspacl, pg_catalog.acldefault('n', s.nspowner)) AS acl FROM s
  UNION ALL
  SELECT r.nspname, r.relkind::text || ':' || r.relname, r.relowner, coalesce(r.relacl, pg_catalog.acldefault((CASE WHEN r.relkind = 'S' THEN 's' ELSE 'r' END)::"char", r.relowner)) FROM rels r
  UNION ALL
  SELECT r.nspname, 'column:' || r.relname || '.' || a.attname, r.relowner, a.attacl
  FROM rels r JOIN pg_catalog.pg_attribute a ON a.attrelid = r.oid
  WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
  UNION ALL
  SELECT f.nspname, 'function:' || f.oid::regprocedure::text, f.proowner, coalesce(f.proacl, pg_catalog.acldefault('f', f.proowner)) FROM funcs f
),
acls AS (
  SELECT a.nspname,
         a.obj || ':' || CASE WHEN x.grantee = 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(x.grantee) END || ':' || x.privilege_type || ':' || x.is_grantable AS def
  FROM acl_src a CROSS JOIN LATERAL pg_catalog.aclexplode(a.acl) x
  WHERE x.grantee <> a.owner
    AND (x.grantee = 0 OR pg_catalog.pg_get_userbyid(x.grantee) <> ALL (${GESTCOPY_ADMIN_ROLES_SQL}))
),
per_schema AS (
  SELECT s.nspname, jsonb_build_object(
    'tables', (SELECT count(*) FROM tabs WHERE tabs.nspname = s.nspname),
    'rls_enabled', (SELECT count(*) FROM tabs WHERE tabs.nspname = s.nspname AND tabs.relrowsecurity),
    'rls_forced', (SELECT count(*) FROM tabs WHERE tabs.nspname = s.nspname AND tabs.relforcerowsecurity),
    'rls_md5', (SELECT md5(coalesce(string_agg(relname || ':' || relrowsecurity::text || ':' || relforcerowsecurity::text, ',' ORDER BY relname), '')) FROM tabs WHERE tabs.nspname = s.nspname),
    'rows_total', (SELECT coalesce(sum(n), 0) FROM row_counts r WHERE r.nspname = s.nspname),
    'rows_md5', (SELECT md5(coalesce(string_agg(relname || ':' || n::text, ',' ORDER BY relname), '')) FROM row_counts r WHERE r.nspname = s.nspname),
    'policies', (SELECT count(*) FROM pols WHERE pols.nspname = s.nspname),
    'policies_md5', (SELECT md5(coalesce(string_agg(def, E'\n' ORDER BY def), '')) FROM pols WHERE pols.nspname = s.nspname),
    'functions', (SELECT count(*) FROM funcs WHERE funcs.nspname = s.nspname),
    'security_definer', (SELECT count(*) FROM funcs WHERE funcs.nspname = s.nspname AND funcs.prosecdef),
    'functions_md5', (SELECT md5(coalesce(string_agg(def, E'\n' ORDER BY def), '')) FROM funcs WHERE funcs.nspname = s.nspname),
    'triggers', (SELECT count(*) FROM trigs WHERE trigs.nspname = s.nspname),
    'triggers_md5', (SELECT md5(coalesce(string_agg(def, E'\n' ORDER BY def), '')) FROM trigs WHERE trigs.nspname = s.nspname),
    'constraints', (SELECT count(*) FROM cons WHERE cons.nspname = s.nspname),
    'foreign_keys', (SELECT count(*) FROM cons WHERE cons.nspname = s.nspname AND cons.contype = 'f'),
    'constraints_md5', (SELECT md5(coalesce(string_agg(def, E'\n' ORDER BY def), '')) FROM cons WHERE cons.nspname = s.nspname),
    'indexes', (SELECT count(*) FROM idx WHERE idx.nspname = s.nspname),
    'indexes_md5', (SELECT md5(coalesce(string_agg(def, E'\n' ORDER BY def), '')) FROM idx WHERE idx.nspname = s.nspname),
    'views_md5', (SELECT md5(coalesce(string_agg(def, E'\n' ORDER BY def), '')) FROM views WHERE views.nspname = s.nspname),
    'types_md5', (SELECT md5(coalesce(string_agg(def, E'\n' ORDER BY def), '')) FROM typs WHERE typs.nspname = s.nspname),
    'sequences', (SELECT count(*) FROM rels WHERE rels.nspname = s.nspname AND rels.relkind = 'S'),
    'acl_entries', (SELECT count(*) FROM acls WHERE acls.nspname = s.nspname),
    'acl_md5', (SELECT md5(coalesce(string_agg(def, E'\n' ORDER BY def), '')) FROM acls WHERE acls.nspname = s.nspname)
  ) AS fp
  FROM s
)
SELECT 'gestcopy-recovery-fingerprint|' || jsonb_build_object(
  'fingerprint_version', ${GESTCOPY_FINGERPRINT_VERSION},
  'schemas', coalesce((SELECT jsonb_object_agg(nspname, fp) FROM per_schema), '{}'::jsonb)
)::text;
SQL
}

# Reads a `pg_restore --list` file and prints the schemas it defines, sorted.
archive_schemas() {
  awk '$4 == "SCHEMA" && $5 == "-" { print $6 }' "$1" | LC_ALL=C sort -u
}

# Prints "<schema> <table count>" for the TABLE entries of a `pg_restore --list` file.
archive_table_counts() {
  awk '$4 == "TABLE" && $5 != "DATA" { count[$5]++ } END { for (schema in count) print schema, count[schema] }' "$1" | LC_ALL=C sort
}
