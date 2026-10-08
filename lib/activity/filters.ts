import type { ActivityEvent } from "@/lib/activity/types";

/** Filter value only. Stored events remain order.details_changed. */
export const ASSIGNEE_ACTIVITY_FILTER = "order.assignee_changed";

export const ASSIGNEE_ACTIVITY_FIELD = "assigned_team_member_id";

export const assigneeActivityOption = {
  value: ASSIGNEE_ACTIVITY_FILTER,
  label: "Cambio de responsable",
} as const;

export function isAssigneeActivityEvent(event: {
  action: string;
  changed_field: string | null;
}) {
  return (
    event.action === "order.details_changed" &&
    event.changed_field === ASSIGNEE_ACTIVITY_FIELD
  );
}

export function matchesActivityActionFilter(
  event: { action: string; changed_field: string | null },
  action: string | null
) {
  if (!action) {
    return true;
  }

  if (action === ASSIGNEE_ACTIVITY_FILTER) {
    return isAssigneeActivityEvent(event);
  }

  if (action === "order.details_changed") {
    return (
      event.action === "order.details_changed" && !isAssigneeActivityEvent(event)
    );
  }

  return event.action === action;
}

export function withOrderNavigation(
  events: ActivityEvent[],
  visibleOrderIds: ReadonlySet<string>
): ActivityEvent[] {
  return events.map((event) => {
    if (event.entity_type !== "order") {
      return event;
    }

    return {
      ...event,
      navigable: Boolean(
        event.entity_id && visibleOrderIds.has(event.entity_id)
      ),
    };
  });
}
