export type OrdersListLayout = "list" | "grid";

/** Grid is the initial presentation; an explicit list selection in the URL wins. */
export function resolveOrdersListLayout(raw: string | null): OrdersListLayout {
  return raw === "list" ? "list" : "grid";
}
