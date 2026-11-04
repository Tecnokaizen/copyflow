/**
 * The view of /orders when the URL names none: Calendario (all tenants).
 * A manual choice is kept in ?view= while the user stays in the section.
 * Links that carry list-only parameters (filters, sort, layout) without a
 * view keep opening the list, so no filtered link changes meaning.
 */
export type OrdersViewMode = "list" | "calendar" | "service";

export const DEFAULT_ORDERS_VIEW: OrdersViewMode = "calendar";

const LIST_ONLY_PARAMS = ["filter", "status_id", "sort", "dir", "layout", "participant_team_member_id"];

export function parseOrdersViewMode(raw: string | null | undefined): OrdersViewMode | null {
  return raw === "list" || raw === "calendar" || raw === "service" ? raw : null;
}

export function resolveOrdersView(params: Pick<URLSearchParams, "get" | "has">): OrdersViewMode {
  const explicit = parseOrdersViewMode(params.get("view"));
  if (explicit) return explicit;
  return LIST_ONLY_PARAMS.some((key) => params.has(key)) ? "list" : DEFAULT_ORDERS_VIEW;
}
