/**
 * When picking a status chip/filter on /orders, keep archived stable and
 * only bounce operative scopes to "all" for terminal statuses.
 */
export function nextListFilterForStatusSelection(input: {
  listFilter: string;
  statusIsTerminal: boolean;
}): string {
  if (input.statusIsTerminal && input.listFilter !== "archived") {
    return "all";
  }
  return input.listFilter;
}
