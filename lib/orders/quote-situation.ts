import type { ManagementOption, SourceQuote } from "@/lib/orders/types";

/**
 * Quote situation shown on the order ficha ("Producción · Presupuesto").
 *
 * Source of truth, in order:
 * 1. The source quote linked through `quotes.converted_order_id` (resolved by
 *    `order_source_quote_v2`, tenant- and role-scoped). Conversion requires an
 *    accepted quote and the quote becomes immutable, so its commercial status
 *    is read live, never copied into `orders`.
 * 2. The order's own administrative field `orders.quote_status_id` (same
 *    per-tenant `quote_statuses` catalog), for orders without a source quote.
 * 3. Nothing linked and nothing indicated → "No requerido".
 */
export const QUOTE_NOT_REQUIRED_CODE = "not_required";
export const QUOTE_NOT_REQUIRED_LABEL = "No requerido";
export const QUOTE_CONVERTED_DETAIL = "Convertido en pedido";

const FALLBACK_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  pending: "En revisión",
  sent: "Enviado",
  accepted: "Aceptado",
  rejected: "Rechazado",
  expired: "Caducado",
};

export type OrderQuoteSituation =
  | {
      kind: "source";
      code: string;
      label: string;
      detail: typeof QUOTE_CONVERTED_DETAIL;
      quote: { id: string; reference: string };
    }
  | { kind: "manual"; code: string | null; label: string }
  | {
      kind: "not_required";
      code: typeof QUOTE_NOT_REQUIRED_CODE;
      label: typeof QUOTE_NOT_REQUIRED_LABEL;
    };

type QuoteStatusLike = { code?: string | null; name?: string | null } | null;

function catalogName(
  code: string,
  options: ReadonlyArray<Pick<ManagementOption, "code" | "name">> | null | undefined
) {
  const name = options?.find((option) => option.code === code)?.name?.trim();
  return name || FALLBACK_STATUS_LABELS[code] || code;
}

export function resolveOrderQuoteSituation(input: {
  sourceQuote: SourceQuote | null | undefined;
  quoteStatus: QuoteStatusLike | undefined;
  quoteStatusOptions?: ReadonlyArray<Pick<ManagementOption, "code" | "name">> | null;
}): OrderQuoteSituation {
  const { sourceQuote, quoteStatus, quoteStatusOptions } = input;

  if (sourceQuote?.id) {
    return {
      kind: "source",
      code: sourceQuote.status,
      label: catalogName(sourceQuote.status, quoteStatusOptions),
      detail: QUOTE_CONVERTED_DETAIL,
      quote: { id: sourceQuote.id, reference: sourceQuote.reference },
    };
  }

  const manualName = quoteStatus?.name?.trim();
  if (manualName) {
    return { kind: "manual", code: quoteStatus?.code ?? null, label: manualName };
  }

  return {
    kind: "not_required",
    code: QUOTE_NOT_REQUIRED_CODE,
    label: QUOTE_NOT_REQUIRED_LABEL,
  };
}

/** Plain-text form used where a single string is needed. */
export function formatOrderQuoteSituation(situation: OrderQuoteSituation) {
  return situation.kind === "source"
    ? `${situation.label} · ${situation.detail}`
    : situation.label;
}

/**
 * Options for the manual selector (orders without source quote). The empty
 * value already means "No requerido", so a tenant catalog entry with the same
 * meaning is hidden unless it is the value currently stored on the order.
 */
export function manualQuoteStatusOptions<T extends Pick<ManagementOption, "id" | "code">>(
  options: ReadonlyArray<T> | null | undefined,
  currentId: string | null | undefined
): T[] {
  return (options ?? []).filter(
    (option) => option.code !== QUOTE_NOT_REQUIRED_CODE || option.id === currentId
  );
}
