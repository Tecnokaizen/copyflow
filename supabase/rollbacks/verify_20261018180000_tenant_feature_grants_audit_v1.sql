-- Post-rollback check for 20261018180000_tenant_feature_grants_audit_v1.sql:
-- no A1 object is left and tenant_feature_overrides is back to its pre-A1
-- shape, privileges and comments. Read-only.
\set ON_ERROR_STOP on

do $rollback_verify$
declare
  v_columns text;
  v_constraints text;
begin
  if to_regclass('public.tenant_feature_override_events') is not null then
    raise exception 'ROLLBACK FAIL: tenant_feature_override_events still exists';
  end if;

  if to_regprocedure('public.set_tenant_feature_v2(text,text,boolean,bigint,text,timestamptz,text)') is not null
     or to_regprocedure('public.clear_tenant_feature_override(text,text,text,text)') is not null
     or to_regprocedure('public.list_tenant_feature_reviews_due(timestamptz)') is not null
     or to_regprocedure('public.tg_tenant_feature_overrides_audit_v1()') is not null
     or to_regprocedure('public.tg_tenant_feature_audit_refuse_v1()') is not null then
    raise exception 'ROLLBACK FAIL: an A1 function still exists';
  end if;

  if exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.tenant_feature_overrides'::regclass and not t.tgisinternal
  ) then
    raise exception 'ROLLBACK FAIL: tenant_feature_overrides still has triggers';
  end if;

  select string_agg(a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                    || case when a.attnotnull then ' not null' else '' end, ', ' order by a.attnum)
    into v_columns
  from pg_attribute a
  where a.attrelid = 'public.tenant_feature_overrides'::regclass
    and a.attnum > 0 and not a.attisdropped;
  if v_columns is distinct from
     'tenant_id uuid not null, feature_id uuid not null, enabled boolean not null, limit_value bigint, '
     || 'created_at timestamp with time zone not null, updated_at timestamp with time zone not null' then
    raise exception 'ROLLBACK FAIL: tenant_feature_overrides columns are %', v_columns;
  end if;

  select string_agg(c.conname, ', ' order by c.conname)
    into v_constraints
  from pg_constraint c
  where c.conrelid = 'public.tenant_feature_overrides'::regclass;
  if v_constraints is distinct from
     'tenant_feature_overrides_feature_id_fkey, tenant_feature_overrides_limit_value_check, '
     || 'tenant_feature_overrides_pkey, tenant_feature_overrides_tenant_id_fkey' then
    raise exception 'ROLLBACK FAIL: tenant_feature_overrides constraints are %', v_constraints;
  end if;

  if not has_table_privilege('service_role', 'public.tenant_feature_overrides', 'TRUNCATE')
     or has_table_privilege('service_role', 'public.tenant_feature_overrides', 'SELECT, INSERT, UPDATE, DELETE')
     or has_table_privilege('authenticated', 'public.tenant_feature_overrides', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
     or has_table_privilege('anon', 'public.tenant_feature_overrides', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE') then
    raise exception 'ROLLBACK FAIL: tenant_feature_overrides privileges not restored';
  end if;

  if obj_description('public.tenant_feature_overrides'::regclass, 'pg_class')
       is distinct from 'Explicit tenant feature gate. Overrides the plan. No client writes.'
     or obj_description('public.set_tenant_feature(text,text,boolean,bigint)'::regprocedure, 'pg_proc')
       is distinct from 'Idempotent operator override. service_role or database owner only.' then
    raise exception 'ROLLBACK FAIL: comments not restored';
  end if;

  if not has_function_privilege('service_role', 'public.set_tenant_feature(text,text,boolean,bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.set_tenant_feature(text,text,boolean,bigint)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.tenant_has_feature(uuid,text)', 'EXECUTE') then
    raise exception 'ROLLBACK FAIL: legacy feature functions changed';
  end if;

  raise notice 'rollback 20261018180000 verified';
end;
$rollback_verify$;
