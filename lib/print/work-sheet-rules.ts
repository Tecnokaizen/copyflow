// SUR4 E2 (contract §6, N19, N20, N25): pure rules of the work sheet. No I/O,
// so every rule is testable with fixtures. The loader (load-order.ts) only
// feeds them what the closed selects return.
import type { OrderFeatures } from "@/lib/orders/order-features";
import type { OrderLabels } from "@/lib/orders/labels";
import { formatOrderMoney } from "@/lib/orders/money";
import { ORDER_RICH_TEXT } from "@/lib/orders/rich-text";
import { isWorkStageIcon } from "@/lib/orders/work-stage-icons";
import { normalizeRichText, richTextToPlainText } from "@/lib/rich-text/html";
import type {
  PrintFact,
  WorkSheetNote,
  WorkSheetProfile,
  WorkSheetStep,
} from "@/lib/print/types";

/**
 * N25: the ficha profile only with order_work_sheet_ficha. Nothing else
 * (URL parameter, role, cookie, request body) can switch it: the only input
 * is the server-side feature, compared strictly with `true`.
 */
export function workSheetProfile(
  features: Pick<OrderFeatures, "workSheetFicha">
): WorkSheetProfile {
  return features.workSheetFicha === true ? "ficha" : "standard";
}

/** Lowercase, without accents and with single spaces, to compare texts. */
export function comparableText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * N20: the ficha prints the service on the first line of the description box
 * only when its name is not already inside the description (plain text).
 */
export function printableService(
  serviceName: string | null | undefined,
  descriptionHtml: string | null | undefined
): boolean {
  const service = comparableText(serviceName);
  if (!service) return false;
  return !comparableText(richTextToPlainText(descriptionHtml)).includes(service);
}

/**
 * N20 (pending SUR4 confirmation): the store goes next to the reference only
 * when the order has one and the tenant has more than one active store.
 */
export function printableStore(
  storeName: string | null | undefined,
  activeStoreCount: number
): boolean {
  return Boolean(storeName?.trim()) && Number.isFinite(activeStoreCount) && activeStoreCount > 1;
}

export type WorkSheetStepRow = {
  position?: number | null;
  completed_at?: string | null;
  is_current?: boolean | null;
  stage?: { name?: string | null; icon?: string | null } | null;
  team_member?: { name?: string | null } | null;
  executed_by?: { name?: string | null } | null;
};

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function workSheetSteps(rows: WorkSheetStepRow[] | null | undefined): WorkSheetStep[] {
  return (rows ?? [])
    .filter((row) => row && typeof row === "object")
    .map((row) => {
      const done = typeof row.completed_at === "string" && row.completed_at.length > 0;
      const person = clean(row.team_member?.name);
      const executor = done ? clean(row.executed_by?.name) : null;
      const icon = row.stage?.icon;
      return {
        position: typeof row.position === "number" ? row.position : 0,
        stageName: clean(row.stage?.name) ?? "Fase",
        stageIcon: isWorkStageIcon(icon) ? icon : "other",
        personName: person ?? "Sin asignar",
        executorName: executor && executor !== person ? executor : null,
        done,
        current: !done && row.is_current === true,
      } satisfies WorkSheetStep;
    })
    .sort((a, b) => a.position - b.position);
}

export type WorkSheetNoteRow = {
  body?: string | null;
  visibility?: string | null;
  state?: string | null;
  redacted_at?: string | null;
};

/**
 * Only post-its expressly authorized as printable, not voided and not
 * suppressed. The loader already filters in the query; this is the second
 * lock, so a wrong row can never reach paper.
 */
export function printableNotes(rows: WorkSheetNoteRow[] | null | undefined): WorkSheetNote[] {
  const notes: WorkSheetNote[] = [];
  for (const row of rows ?? []) {
    if (!row || row.visibility !== "printable") continue;
    if (row.state === "voided" || row.redacted_at) continue;
    const body = normalizeRichText(row.body, ORDER_RICH_TEXT);
    if (body) notes.push({ body });
  }
  return notes;
}

export type CollectionAmounts = {
  total: string | null;
  paid: string | null;
  pending: string | null;
};

function money(value: unknown): string | null {
  return typeof value === "string" && /^\d+\.\d{2}$/.test(value) ? value : null;
}

/**
 * The three amounts of order_collection_v1, as on the order page. Everything
 * else in the answer (payments, methods, receipts, reasons) is dropped here.
 */
export function collectionAmounts(data: unknown): CollectionAmounts | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const row = data as Record<string, unknown>;
  if (row.ok !== true) return null;
  return {
    total: money(row.total_amount),
    paid: money(row.paid_amount),
    pending: money(row.pending_amount),
  };
}

/** «Sin definir» when the order has no total, like the order page. */
export function amountFacts(amounts: CollectionAmounts | null, labels: OrderLabels): PrintFact[] {
  if (!amounts) {
    return [
      { label: labels.total, value: "—" },
      { label: labels.paid, value: "—" },
      { label: labels.due, value: "—" },
    ];
  }
  return [
    { label: labels.total, value: amounts.total ? formatOrderMoney(amounts.total) : "Sin definir" },
    { label: labels.paid, value: formatOrderMoney(amounts.paid) },
    { label: labels.due, value: amounts.pending ? formatOrderMoney(amounts.pending) : "Sin definir" },
  ];
}

/** N10: no columns yet, blank spaces to fill in by hand. */
export const WORK_SHEET_PROOF_FIELDS = [
  "Requiere prueba",
  "Fecha de envío prueba",
  "Fecha prueba",
] as const;

export const LEGACY_NOTES_NOTICE = "Este pedido tiene notas internas, que no se imprimen.";
