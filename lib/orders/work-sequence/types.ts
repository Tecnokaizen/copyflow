// SUR4 E8 · Work sequence of an order: shapes shared by the API routes and the
// client components. The database (20261028130000) is the source of truth;
// these are the JSON contracts of /api/orders/[id]/work-steps and
// /api/work-stages.

export const MAX_WORK_STEPS = 10;
export const MAX_WORK_STAGES = 30;
export const WORK_STAGE_NAME_MAX = 40;
export const WORK_STAGE_SORT_MAX = 1000;

export type WorkStageDto = {
  id: string;
  name: string;
  icon: string;
  active: boolean;
  sort_order: number;
};

export type WorkStepStageDto = {
  id: string;
  name: string;
  icon: string;
  active: boolean;
};

export type WorkStepPersonDto = {
  id: string;
  name: string;
  active: boolean;
  can_receive_orders: boolean;
};

export type WorkStepExecutorDto = {
  id: string;
  name: string;
};

export type WorkStepDto = {
  id: string;
  position: number;
  stage: WorkStepStageDto | null;
  team_member: WorkStepPersonDto | null;
  executed_by: WorkStepExecutorDto | null;
  done: boolean;
  completed_at: string | null;
  completed_by_name: string | null;
  is_current: boolean;
};

/** GET /api/orders/[id]/work-steps (and the tail of every successful write). */
export type WorkSequenceDto = {
  order_id: string;
  row_version: string;
  archived: boolean;
  /** Role may write steps (owner, admin, manager, staff) and the order is not archived. */
  can_edit: boolean;
  steps: WorkStepDto[];
  /** Active stages of the tenant, for the editor (sort_order, then name). */
  stages: WorkStageDto[];
};

/** One step of PUT /api/orders/[id]/work-steps. */
export type WorkStepInput = {
  id?: string;
  stage_id: string;
  team_member_id: string | null;
};

/** GET /api/work-stages */
export type WorkStageListDto = {
  stages: WorkStageDto[];
  can_manage: boolean;
};

export type AssignableMember = {
  id: string;
  name: string;
};
