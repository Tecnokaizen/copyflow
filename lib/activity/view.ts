export type ActivityViewMode = "list" | "grid";

export const ACTIVITY_VIEW_STORAGE_KEY = "gestcopy-activity-view";

export function parseActivityViewMode(
  raw: string | null | undefined
): ActivityViewMode {
  return raw === "grid" ? "grid" : "list";
}

export function readStoredActivityView(
  storage: { getItem(key: string): string | null } | null
): ActivityViewMode {
  if (!storage) {
    return "list";
  }

  return parseActivityViewMode(storage.getItem(ACTIVITY_VIEW_STORAGE_KEY));
}
