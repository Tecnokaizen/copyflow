-- Rollback for 20261028130000_order_work_sequence_v1.sql (SUR4 E7 · work sequence).
--
-- Removes work_stages, order_work_steps, their guards, the purge trigger on
-- orders, the five RPCs and the helpers, and the A1 feature order_work_sequence
-- (and any override granted for it). orders and team_members were not changed
-- by the migration, so nothing is restored there.
--
-- It REFUSES to run when it would lose data: any step or any stage. Steps are
-- who-did-what history and stages are tenant configuration; there is no opt-in
-- to discard them. It does not delete order.work_step* rows from activity_log
-- (history).
-- Then: supabase migration repair --status reverted 20261028130000
begin;

do $guard$
begin
  if exists (select 1 from public.order_work_steps)
     or exists (select 1 from public.work_stages) then
    raise exception 'rollback refused: the work sequence still has rows';
  end if;
end
$guard$;

drop trigger if exists trg_orders_purge_work_steps on public.orders;

drop function public.create_suggested_work_stages_v1(uuid);
drop function public.upsert_work_stage_v1(uuid, uuid, text, text, boolean, integer);
drop function public.team_work_load_v1(uuid);
drop function public.set_order_work_step_done_v1(uuid, boolean, uuid);
drop function public.replace_order_work_steps_v1(uuid, text, jsonb);
drop function public.work_stage_json_v1(public.work_stages);
drop function public.order_work_steps_recompute_current_v1(uuid, uuid);
drop function public.order_work_steps_snapshot_v1(uuid, uuid);
drop function public.order_work_steps_json_v1(uuid, uuid);
drop function public.order_work_step_json_v1(public.order_work_steps);
drop function public.order_work_steps_input_v1(jsonb);
drop function public.order_work_step_payload_error_v1(jsonb);
drop function public.work_sequence_actor_name_v1(uuid, uuid);

drop table public.order_work_steps;
drop table public.work_stages;

drop function public.tg_orders_purge_work_steps_v1();
drop function public.tg_order_work_refuse_truncate_v1();
drop function public.tg_order_work_steps_guard_v1();
drop function public.tg_work_stages_guard_v1();

delete from public.tenant_feature_overrides o
using public.features f
where o.feature_id = f.id
  and f.code = 'order_work_sequence';
delete from public.features
where code = 'order_work_sequence';

commit;
