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

function dispositionFilename(filename: string) {
  const safe = filename.replace(/[\r\n"]/g, "");
  return {
    safe,
    encoded: encodeURIComponent(safe),
  };
}

function contentDisposition(kind: "attachment" | "inline", filename: string) {
  const { safe, encoded } = dispositionFilename(filename);
  return `${kind}; filename="${safe}"; filename*=UTF-8''${encoded}`;
}

export function contentDispositionAttachment(filename: string): string {
  return contentDisposition("attachment", filename);
}

export function contentDispositionInline(filename: string): string {
  return contentDisposition("inline", filename);
}
