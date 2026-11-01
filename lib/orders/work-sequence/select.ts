// SUR4 E8: PostgREST select strings for the work sequence.
//
// order_work_steps has TWO foreign keys towards the people table: the assigned
// person and the executor. So an embed without a hint is ambiguous and PostgREST answers
// 300 (PGRST201). Every embed names its constraint (E1, postgrest-hints.test).
export const WORK_STEP_SELECT = [
  "id",
  "position",
  "completed_at",
  "completed_by_name",
  "is_current",
  "stage:work_stages!order_work_steps_stage_fk(id, name, icon, active)",
  "team_member:team_members!order_work_steps_team_member_fk(id, name, active, can_receive_orders)",
  "executed_by:team_members!order_work_steps_executed_by_fk(id, name)",
].join(", ");

export const WORK_STAGE_SELECT = "id, name, icon, active, sort_order";

export const WORK_ORDER_HEAD_SELECT = "id, row_version, archived_at";
