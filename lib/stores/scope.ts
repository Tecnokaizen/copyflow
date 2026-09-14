import { isUuid } from "@/lib/team/payload";
import type { StoreLookup } from "@/lib/stores/types";

export const STORE_FILTER_NONE = "none";

export type StoreListFilter =
  | { kind: "all" }
  | { kind: "none" }
  | { kind: "id"; id: string }
  | { kind: "invalid" };

export type StoreAssignmentResult =
  | { ok: true }
  | { ok: false; code: "missing" | "tenant_mismatch" | "inactive" };

/**
 * Session tenant is the only authority. A store from another tenant is never
 * assignable, even if the client sent its id.
 */
export function evaluateStoreAssignment(input: {
  sessionTenantId: string;
  storeId: string | null;
  store: StoreLookup | null;
  requireActive?: boolean;
}): StoreAssignmentResult {
  if (input.storeId === null) {
    return { ok: true };
  }

  if (!input.store) {
    return { ok: false, code: "missing" };
  }

  if (
    input.store.id !== input.storeId ||
    input.store.tenant_id !== input.sessionTenantId
  ) {
    return { ok: false, code: "tenant_mismatch" };
  }

  if (input.requireActive !== false && !input.store.active) {
    return { ok: false, code: "inactive" };
  }

  return { ok: true };
}

export function parseStoreListFilter(
  raw: string | null | undefined
): StoreListFilter {
  if (raw == null) {
    return { kind: "all" };
  }

  const value = raw.trim();
  if (!value || value === "all") {
    return { kind: "all" };
  }

  if (value === STORE_FILTER_NONE) {
    return { kind: "none" };
  }

  if (isUuid(value)) {
    return { kind: "id", id: value };
  }

  return { kind: "invalid" };
}

export function storeListFilterParam(filter: StoreListFilter): string | null {
  if (filter.kind === "none") {
    return STORE_FILTER_NONE;
  }

  if (filter.kind === "id") {
    return filter.id;
  }

  return null;
}

export function defaultActiveStoreId(
  stores: Array<{ id: string; active?: boolean }>
): string | null {
  const active = stores.filter((store) => store.active !== false);
  return active.length === 1 ? active[0].id : null;
}
