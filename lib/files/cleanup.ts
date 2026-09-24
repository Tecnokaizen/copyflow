export const CLEANUP_LIMIT = 100;

export type CleanupCandidate = {
  kind: "order" | "quote";
  id: string;
  tenant_id: string;
  parent_id: string;
  storage_key: string;
  upload_expires_at: string;
};

export function selectCleanupCandidates(
  candidates: readonly CleanupCandidate[]
): CleanupCandidate[] {
  // Each table supplies its oldest CLEANUP_LIMIT rows; neither kind owns the budget.
  return [...candidates]
    .sort((a, b) => {
      const age = Date.parse(a.upload_expires_at) - Date.parse(b.upload_expires_at);
      if (age !== 0) return age;
      if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, CLEANUP_LIMIT);
}
