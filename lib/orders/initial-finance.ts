import { canonicalMoney, formatOrderMoney } from "@/lib/orders/money";
import { isPaymentMethod, type PaymentMethod } from "./payment-methods";
import { paymentPendingStorageKey } from "./payment-pending";
import { parsePaymentPayload } from "./payment-payload";
import type { DraftStorage } from "./session-draft";

export type InitialFinanceDraft = {
  totalAmount: string;
  advanceAmount: string;
};

export type ParsedInitialFinance =
  | { ok: false; error: string }
  | {
      ok: true;
      totalAmount: string | null;
      advanceAmount: string | null;
      pendingAmount: string | null;
    };

function cents(money: string): bigint {
  const [whole, decimals] = money.split(".");
  return BigInt(whole) * BigInt(100) + BigInt(decimals);
}

export function parseInitialFinance(draft: InitialFinanceDraft): ParsedInitialFinance {
  const totalText = draft.totalAmount.trim();
  const advanceText = draft.advanceAmount.trim();
  if (!totalText && !advanceText) {
    return { ok: true, totalAmount: null, advanceAmount: null, pendingAmount: null };
  }
  if (!totalText) {
    return { ok: false, error: "Define el importe total antes de indicar una entrega a cuenta." };
  }
  const totalAmount = canonicalMoney(totalText, true);
  if (!totalAmount) {
    return { ok: false, error: "El importe total no es válido. Usa euros con hasta dos decimales." };
  }
  const advance = advanceText ? canonicalMoney(advanceText, true) : "0.00";
  if (!advance) {
    return { ok: false, error: "La entrega a cuenta no es válida. Usa euros con hasta dos decimales." };
  }
  if (cents(advance) > cents(totalAmount)) {
    return { ok: false, error: "La entrega a cuenta no puede superar el total del pedido." };
  }
  const pendingCents = cents(totalAmount) - cents(advance);
  const pendingAmount = `${pendingCents / BigInt(100)}.${String(pendingCents % BigInt(100)).padStart(2, "0")}`;
  return {
    ok: true,
    totalAmount,
    advanceAmount: advance === "0.00" ? null : advance,
    pendingAmount,
  };
}

export function pendingInitialFinanceLabel(result: ParsedInitialFinance) {
  return result.ok && result.pendingAmount !== null
    ? formatOrderMoney(result.pendingAmount)
    : "—";
}

type CollectionSnapshot = { total_amount: string | null; row_version: string };
type RequestClient = typeof fetch;

async function collectionRequest(
  request: RequestClient,
  url: string,
  init?: RequestInit
): Promise<CollectionSnapshot> {
  const response = await request(url, { cache: "no-store", ...init });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("El servidor no ha confirmado el cobro. Reintenta desde este pedido.");
  }
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  if (!response.ok) {
    throw new Error(
      typeof record.error === "string" ? record.error : "No se ha podido confirmar el cobro."
    );
  }
  if (
    typeof record.row_version !== "string" ||
    (record.total_amount !== null && typeof record.total_amount !== "string")
  ) {
    throw new Error("No se ha podido verificar el estado del cobro.");
  }
  return { total_amount: record.total_amount, row_version: record.row_version };
}

/** Create the order FIRST. The existing collection endpoints remain the source of truth.
 * Retry with the SAME key and paidAt after an uncertain POST response: server-side
 * idempotency prevents duplicate advance entries.
 */
export async function persistInitialFinance(input: {
  orderId: string;
  finance: Extract<ParsedInitialFinance, { ok: true }>;
  idempotencyKey: string;
  paidAt: string;
  paymentMethod?: PaymentMethod | "";
  storage?: DraftStorage;
  expectedTenantSlug?: string;
  expectedUserId?: string;
  request?: RequestClient;
}): Promise<void> {
  if (input.finance.totalAmount === null) return;
  const request = input.request ?? fetch;
  const base = `/api/orders/${encodeURIComponent(input.orderId)}`;
  // Check identity before any monetary write. Recoverable payment requests use
  // the same scoped storage as OrderCollection, so a reload can confirm them there.
  const contextResponse = await request("/api/context", { cache: "no-store" });
  if (!contextResponse.ok) throw new Error("No se ha podido comprobar la sesión.");
  const context = await contextResponse.json();
  if ((input.expectedTenantSlug && context?.tenant?.slug !== input.expectedTenantSlug) ||
      (input.expectedUserId && context?.user?.id !== input.expectedUserId)) {
    throw new Error("La sesión ha cambiado. Revisa los importes desde la ficha.");
  }
  const pendingKey = paymentPendingStorageKey(context?.tenant?.id ?? "", context?.user?.id ?? "", input.orderId);
  if (!pendingKey) throw new Error("No se ha podido comprobar la sesión.");
  const payment = input.finance.advanceAmount === null ? null : parsePaymentPayload({
    amount: input.finance.advanceAmount, paid_at: input.paidAt,
    idempotency_key: input.idempotencyKey, payment_method: input.paymentMethod,
  });
  if (input.finance.advanceAmount !== null && (!isPaymentMethod(input.paymentMethod) || !payment)) {
    throw new Error("Selecciona el método de pago de la entrega a cuenta.");
  }
  let collection = await collectionRequest(request, `${base}/payments`);
  if (collection.total_amount !== input.finance.totalAmount) {
    if (collection.total_amount !== null) {
      throw new Error("El total del pedido ha cambiado. Revisa el cobro desde la ficha.");
    }
    collection = await collectionRequest(request, `${base}/total`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        total_amount: input.finance.totalAmount,
        expected_version: collection.row_version,
      }),
    });
  }
  if (payment) {
    // Abort if the browser cannot preserve an uncertain payment. Never send
    // money first and then discover that the retry key could not be stored.
    if (input.storage) {
      const saved = input.storage.getItem(pendingKey);
      if (saved && saved !== JSON.stringify(payment)) {
        throw new Error("Hay otra confirmación pendiente. Revísala desde la ficha.");
      }
      input.storage.setItem(pendingKey, JSON.stringify(payment));
    }
    await collectionRequest(request, `${base}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payment),
    });
    input.storage?.removeItem(pendingKey);
  }
}
