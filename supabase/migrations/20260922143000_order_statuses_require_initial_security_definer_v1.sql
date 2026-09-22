-- Fix deferred initial-status invariant for inactive onboarding tenants.
--
-- order_statuses_require_initial is DEFERRABLE INITIALLY DEFERRED. After
-- create_organization (SECURITY DEFINER) inserts seed statuses for an
-- active=false commercial tenant, the deferred trigger previously ran as
-- SECURITY INVOKER under authenticated/PostgREST. Active-tenant RLS hid the
-- rows (count=0) and raised 23514 incorrectly.
--
-- The invariant is internal: inspect physical rows with SECURITY DEFINER.
-- Does NOT modify DEMO/SUR4 rows, RLS, or the exactly-one-initial rule.

CREATE OR REPLACE FUNCTION public.tg_order_statuses_require_initial()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare
  v_tenant_id uuid;
  v_count integer;
begin
  v_tenant_id := case
    when tg_op = 'DELETE' then old.tenant_id
    else new.tenant_id
  end;

  -- Cascading tenant deletion must not be blocked by the catalog invariant.
  if not exists (
    select 1 from public.tenants t where t.id = v_tenant_id
  ) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select count(*)
  into v_count
  from public.order_statuses s
  where s.tenant_id = v_tenant_id
    and s.is_initial = true
    and s.active = true;

  if v_count <> 1 then
    raise exception 'tenant must keep exactly one active initial order status'
      using errcode = '23514';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

COMMENT ON FUNCTION public.tg_order_statuses_require_initial() IS
  'Deferred invariant: exactly one active initial order status per tenant. SECURITY DEFINER so RLS cannot hide rows during inactive onboarding bootstrap.';

REVOKE ALL ON FUNCTION public.tg_order_statuses_require_initial() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_order_statuses_require_initial() FROM anon;
REVOKE ALL ON FUNCTION public.tg_order_statuses_require_initial() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.tg_order_statuses_require_initial()
  TO postgres, service_role;
