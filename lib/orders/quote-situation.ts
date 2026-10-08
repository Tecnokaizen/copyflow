import type { ManagementOption, SourceQuote } from "@/lib/orders/types";

/**
 * Quote situation shown on the order ficha ("Producción · Presupuesto").
 *
 * Source of truth, in order:
 * 1. The source quote linked through `quotes.converted_order_id` (resolved by
 *    `order_source_quote_v2`, tenant- and role-scoped). Conversion requires an
 *    accepted quote and the quote becomes immutable, so its commercial status
 *    is read live, never copied into `orders`.
 * 2. A source quote exists but the viewer cannot read it (role without quote
 *    access, or quotes feature off): only the link is acknowledged, never a
 *    status, amount or reference, and never a stale manual value.
 * 3. The order's own administrative field `orders.quote_status_id` (same
 *    per-tenant `quote_statuses` catalog), for orders without a source quote.
 * 4. The order's service is configured with `services.requires_quote`: the
 *    need stays visible with the tenant's `pending` catalog entry.
 * 5. Nothing linked and nothing indicated → "No requerido".
 */
export const QUOTE_NOT_REQUIRED_CODE = "not_required";
export const QUOTE_NOT_REQUIRED_LABEL = "No requerido";
export const QUOTE_CONVERTED_DETAIL = "Convertido en pedido";
export const QUOTE_RESTRICTED_LABEL = "Vinculado a un presupuesto";
export const QUOTE_RESTRICTED_DETAIL = "Detalle no disponible";
export const QUOTE_REQUIRED_DETAIL = "Requiere presupuesto";
export const QUOTE_PENDING_CODE = "pending";

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
  | {
      kind: "restricted";
      code: null;
      label: typeof QUOTE_RESTRICTED_LABEL;
      detail: typeof QUOTE_RESTRICTED_DETAIL;
    }
  | { kind: "manual"; code: string | null; label: string }
  | {
      kind: "required";
      /** `pending` when the tenant catalog has it; otherwise no status is implied. */
      code: string | null;
      label: string;
      detail: typeof QUOTE_REQUIRED_DETAIL;
    }
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
  sourceQuoteRestricted?: boolean;
  quoteStatus: QuoteStatusLike | undefined;
  serviceRequiresQuote?: boolean;
  quoteStatusOptions?: ReadonlyArray<Pick<ManagementOption, "code" | "name">> | null;
}): OrderQuoteSituation {
  const {
    sourceQuote,
    sourceQuoteRestricted = false,
    quoteStatus,
    serviceRequiresQuote = false,
    quoteStatusOptions,
  } = input;

  if (sourceQuote?.id) {
    return {
      kind: "source",
      code: sourceQuote.status,
      label: catalogName(sourceQuote.status, quoteStatusOptions),
      detail: QUOTE_CONVERTED_DETAIL,
      quote: { id: sourceQuote.id, reference: sourceQuote.reference },
    };
  }

  if (sourceQuoteRestricted) {
    return {
      kind: "restricted",
      code: null,
      label: QUOTE_RESTRICTED_LABEL,
      detail: QUOTE_RESTRICTED_DETAIL,
    };
  }

  const manualName = quoteStatus?.name?.trim();
  if (manualName) {
    return { kind: "manual", code: quoteStatus?.code ?? null, label: manualName };
  }

  if (serviceRequiresQuote) {
    const pending = quoteStatusOptions
      ?.find((option) => option.code === QUOTE_PENDING_CODE)
      ?.name?.trim();
    return {
      kind: "required",
      code: pending ? QUOTE_PENDING_CODE : null,
      label: pending || QUOTE_REQUIRED_DETAIL,
      detail: QUOTE_REQUIRED_DETAIL,
    };
  }

  return {
    kind: "not_required",
    code: QUOTE_NOT_REQUIRED_CODE,
    label: QUOTE_NOT_REQUIRED_LABEL,
  };
}

/** Plain-text form used where a single string is needed. */
export function formatOrderQuoteSituation(situation: OrderQuoteSituation) {
  switch (situation.kind) {
    case "source":
    case "restricted":
      return `${situation.label} · ${situation.detail}`;
    case "required":
      return situation.label === situation.detail
        ? situation.label
        : `${situation.label} · ${situation.detail}`;
    default:
      return situation.label;
  }
}

/** A value that comes from the quote link must not be edited by hand. */
export function isDerivedQuoteSituation(situation: OrderQuoteSituation) {
  return situation.kind === "source" || situation.kind === "restricted";
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
