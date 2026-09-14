import { canWriteStores } from "@/lib/auth/membership-roles";

export type Store = {
  id: string;
  name: string;
  code: string | null;
  active: boolean;
};

export type StorePayload = {
  name: string;
  code: string | null;
  active: boolean;
};

export type StorePatch = {
  name?: string;
  code?: string | null;
  active?: boolean;
};

export type StoreLookup = {
  id: string;
  tenant_id: string;
  active: boolean;
};

export function mapStoreLookup(row: unknown): StoreLookup | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const tenantId =
    typeof record.tenant_id === "string" ? record.tenant_id : null;

  if (!id || !tenantId) {
    return null;
  }

  return {
    id,
    tenant_id: tenantId,
    active: record.active !== false,
  };
}

export function mapStore(row: unknown): Store | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name.trim() : "";

  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    code: typeof record.code === "string" && record.code.trim()
      ? record.code.trim()
      : null,
    active: record.active !== false,
  };
}

export { canWriteStores };
