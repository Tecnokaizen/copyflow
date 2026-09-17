\set ON_ERROR_STOP on

do $rollback_verify$
declare
  v_definition text;
  v_count integer;
begin
  if to_regnamespace('kiosk_private') is not null then
    raise exception 'ROLLBACK FAIL: kiosk_private still exists';
  end if;

  if to_regprocedure(
    'public.kiosk_bootstrap(text,text,bigint,text,text,text)'
  ) is not null
     or to_regprocedure(
       'public.admit_kiosk_request(text,text,bigint,text,text,text)'
     ) is not null
     or to_regprocedure(
       'public.submit_kiosk_order(text,text,bigint,text,text,text,uuid,uuid,text,uuid,text,text,text,text,timestamptz,text)'
     ) is not null then
    raise exception 'ROLLBACK FAIL: public Kiosk wrapper still exists';
  end if;

  select pg_get_functiondef(
    'public.tg_activity_log_order_created()'::regprocedure
  )
  into v_definition;

  if position('app.kiosk_submission' in v_definition) > 0
     or position('if v_actor is null then' in lower(v_definition)) = 0 then
    raise exception 'ROLLBACK FAIL: order activity trigger function not restored';
  end if;

  select count(*)
  into v_count
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and n.nspname = 'public'
    and c.relname = 'orders'
    and t.tgname = 'trg_orders_activity_log_created'
    and p.proname = 'tg_activity_log_order_created';

  if v_count <> 1 then
    raise exception 'ROLLBACK FAIL: activity trigger binding changed';
  end if;
end;
$rollback_verify$;
