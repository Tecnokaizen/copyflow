import { canonicalMoney } from "./money";
import { isPaymentMethod, type PaymentMethod } from "./payment-methods";
import { isUuid } from "@/lib/team/payload";

export type PaymentPayload = {
  amount: string;
  paid_at: string;
  idempotency_key: string;
  payment_method: PaymentMethod;
  receipt_file_id: string | null;
};
export function parsePaymentPayload(body: unknown): PaymentPayload | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const row = body as Record<string, unknown>;
  const amount = typeof row.amount === "string" ? canonicalMoney(row.amount, false) : null;
  const date = typeof row.paid_at === "string" ? row.paid_at : null;
  if (!amount || !date || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date))) return null;
  if (typeof row.idempotency_key !== "string" || !/^[A-Za-z0-9:_-]{8,80}$/.test(row.idempotency_key)) return null;
  if (!isPaymentMethod(row.payment_method)) return null;
  if (row.receipt_file_id != null && (typeof row.receipt_file_id !== "string" || !isUuid(row.receipt_file_id))) return null;
  return { amount, paid_at: date, idempotency_key: row.idempotency_key,
    payment_method: row.payment_method, receipt_file_id: (row.receipt_file_id as string | null) ?? null };
}
