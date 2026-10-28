import type { ReviewReason } from "@/lib/orders/review";

export type DashboardUpcomingOrder = {
  id: string;
  reference: string;
  title: string;
  priority: string;
  due_at: string | null;
  assigned_team_member: {
    name: string;
  } | null;
  status: {
    name: string;
    is_ready: boolean;
  } | null;
};

/** Operational orders that require review. Count is unique orders, not reasons. */
export type DashboardAttentionOrder = DashboardUpcomingOrder & {
  review_reasons: ReviewReason[];
};

export type DashboardWorkloadMember = {
  id: string;
  name: string;
  job_title: string | null;
  active: boolean;
  can_receive_orders: boolean;
  active_orders_count: number;
};

/**
 * SUR4 E9: «Le toca ahora» from team_work_load_v1, only with the work sequence
 * (feature + active stages). Each figure is a count of distinct operational
 * orders; it is never added to the responsible column or to the team total.
 */
export type DashboardWorkSequenceLoad = {
  /** team_member_id → orders whose current step is theirs. */
  current_by_member: Record<string, number>;
  current_unassigned: number;
  current_unavailable: number;
};

export type DashboardResponse = {
  tenant: string;
  timezone: string;
  local_date: string;
  counts: {
    active: number;
    urgent: number;
    overdue: number;
    due_today: number;
    upcoming: number;
    needs_attention: number;
  };
  needs_attention_includes: {
    overdue: boolean;
    due_today_pending: boolean;
    customer_not_notified: boolean;
    unassigned: boolean;
    ready: boolean;
    incomplete_files: boolean;
    pending_quote: boolean;
    blocked: boolean;
  };
  upcoming_orders: DashboardUpcomingOrder[];
  attention_orders: DashboardAttentionOrder[];
  workload: {
    active_orders_count: number;
    members: DashboardWorkloadMember[];
    work_sequence?: DashboardWorkSequenceLoad;
  };
  quotes: {
    open: number;
    in_review: number;
    sent: number;
    accepted_pending: number;
  } | null;
};
