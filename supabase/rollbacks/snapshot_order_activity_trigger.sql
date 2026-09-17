\pset tuples_only on
\pset format unaligned

select jsonb_build_object(
  'function_definition', pg_get_functiondef(p.oid),
  'function_owner', pg_get_userbyid(p.proowner),
  'function_acl', coalesce(to_jsonb(p.proacl), 'null'::jsonb),
  'function_config', coalesce(to_jsonb(p.proconfig), 'null'::jsonb),
  'trigger_definition', pg_get_triggerdef(t.oid, true),
  'trigger_enabled', t.tgenabled
)::text
from pg_proc p
join pg_namespace pn on pn.oid = p.pronamespace
join pg_trigger t on t.tgfoid = p.oid
join pg_class c on c.oid = t.tgrelid
join pg_namespace cn on cn.oid = c.relnamespace
where pn.nspname = 'public'
  and p.proname = 'tg_activity_log_order_created'
  and cn.nspname = 'public'
  and c.relname = 'orders'
  and t.tgname = 'trg_orders_activity_log_created'
  and not t.tgisinternal;
