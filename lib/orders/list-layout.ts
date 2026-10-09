export type OrdersListLayout = "list" | "grid";

// The list section opens as a grid unless the URL explicitly requests the table.
// URL selection remains shareable and survives switching between sections.
export function parseOrdersListLayout(value: string | null): OrdersListLayout {
  return value === "list" ? "list" : "grid";
}
