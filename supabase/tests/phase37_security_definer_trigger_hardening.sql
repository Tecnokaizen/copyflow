-- SECURITY DEFINER trigger hardening V1
-- (migration 20260925150000_harden_security_definer_trigger_execute_v1).
--
-- Read-only invariant suite: no fixtures, no mutations. Can also be run as a
-- post-apply verification. Behavioural coverage of the triggers themselves
-- stays in phase31 (tenant provisioning) and phase33/phase34 (quotes), which
-- run in the same CI job.
begin;

do $phase37$
declare
  v_expected constant jsonb := jsonb_build_array(
    jsonb_build_object('fn', 'public.enforce_tenant_active_immutability()', 'tbl', 'public.tenants', 'trg', 'trg_tenants_active_immutable'),
    jsonb_build_object('fn', 'public.tg_assign_quote_reference()', 'tbl', 'public.quotes', 'trg', 'quotes_assign_reference'),
    jsonb_build_object('fn', 'public.tg_quotes_activity()', 'tbl', 'public.quotes', 'trg', 'quotes_activity')
  );
  v_item jsonb;
  v_fn regprocedure;
  v_role text;
  v_secdef boolean;
  v_trg_fn oid;
  v_trg_enabled "char";
begin
  for v_item in select * from jsonb_array_elements(v_expected) loop
    -- 1. Function still exists and is still SECURITY DEFINER (body untouched).
    v_fn := to_regprocedure(v_item->>'fn');
    if v_fn is null then
      raise exception 'phase37: function % does not exist', v_item->>'fn';
    end if;

    select p.prosecdef into v_secdef from pg_catalog.pg_proc p where p.oid = v_fn;
    if v_secdef is distinct from true then
      raise exception 'phase37: % is no longer SECURITY DEFINER', v_item->>'fn';
    end if;

    -- 2 + 7. Still wired to its trigger, and the trigger is enabled.
    select t.tgfoid, t.tgenabled
      into v_trg_fn, v_trg_enabled
    from pg_catalog.pg_trigger t
    where t.tgrelid = (v_item->>'tbl')::regclass
      and t.tgname = v_item->>'trg'
      and not t.tgisinternal;

    if v_trg_fn is null then
      raise exception 'phase37: trigger % on % not found', v_item->>'trg', v_item->>'tbl';
    end if;
    if v_trg_fn <> v_fn::oid then
      raise exception 'phase37: trigger % no longer uses %', v_item->>'trg', v_item->>'fn';
    end if;
    if v_trg_enabled = 'D' then
      raise exception 'phase37: trigger % is disabled', v_item->>'trg';
    end if;

    -- 3-5. No client role (nor PUBLIC) can execute it.
    foreach v_role in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(v_role, v_fn, 'EXECUTE') then
        raise exception 'phase37: % still has EXECUTE on %', v_role, v_item->>'fn';
      end if;
    end loop;

    if exists (
      select 1
      from pg_catalog.pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.oid = v_fn
        and a.grantee = 0
        and a.privilege_type = 'EXECUTE'
    ) then
      raise exception 'phase37: PUBLIC still has EXECUTE on %', v_item->>'fn';
    end if;

    -- 6. postgres keeps EXECUTE.
    if not has_function_privilege('postgres', v_fn, 'EXECUTE') then
      raise exception 'phase37: postgres lost EXECUTE on %', v_item->>'fn';
    end if;

    v_trg_fn := null;
    v_trg_enabled := null;
  end loop;

  raise notice 'phase37_security_definer_trigger_hardening_ok';
end;
$phase37$;

rollback;
