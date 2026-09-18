import { canWriteOrders } from "@/lib/auth/membership-roles";
import { isOrderArchived } from "@/lib/orders/operational";
import { ORDER_ARCHIVED_CODE } from "@/lib/orders/lifecycle-ux";

export type TenantContext = {
  user: { id: string };
  tenant: { id: string; slug: string };
  membership: { role: string; active: boolean };
};

export function orderArchivedResponse() {
  return {
    status: 409 as const,
    body: { error: "Order is archived", code: ORDER_ARCHIVED_CODE },
  };
}

export function assertCanMutateOrderFiles(input: {
  role: string | null | undefined;
  archivedAt: string | null | undefined;
}): { ok: true } | { ok: false; status: number; body: Record<string, unknown> } {
  if (!canWriteOrders(input.role)) {
    return {
      ok: false,
      status: 403,
      body: { error: "Forbidden" },
    };
  }
  if (isOrderArchived({ archived_at: input.archivedAt ?? null })) {
    return { ok: false, ...orderArchivedResponse() };
  }
  return { ok: true };
}

export function contentDispositionAttachment(filename: string): string {
  const safe = filename.replace(/"/g, "");
  const encoded = encodeURIComponent(safe);
  return `attachment; filename="${safe}"; filename*=UTF-8''${encoded}`;
}
