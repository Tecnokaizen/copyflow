import { canWriteOrders } from "@/lib/auth/membership-roles";
import { canAccessQuotesModule } from "@/lib/quotes/access";

export const QUOTE_FLOW_CODES = [
  "draft",
  "pending",
  "sent",
  "accepted",
  "rejected",
] as const;

export type QuoteFlowCode = (typeof QUOTE_FLOW_CODES)[number];

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FILTER_LABELS: Partial<
  Record<QuoteFlowCode, { catalogName: string; label: string }>
> = {
  sent: { catalogName: "Enviado", label: "Enviados" },
  accepted: { catalogName: "Aceptado", label: "Aceptados" },
  rejected: { catalogName: "Rechazado", label: "Rechazados" },
};

export function quoteStatusFilters(
  statuses: Array<{ code: string; name: string }>
) {
  const byCode = new Map(statuses.map((status) => [status.code, status.name]));

  return QUOTE_FLOW_CODES.flatMap((code) => {
    const name = byCode.get(code);
    if (!name) {
      return [];
    }

    const plural = FILTER_LABELS[code];
    return [
      {
        code,
        name: plural && name === plural.catalogName ? plural.label : name,
      },
    ];
  });
}

export function parseQuoteListQuery(params: {
  get: (key: string) => string | null;
}) {
  const rawStatus = params.get("status") ?? "";
  const status = QUOTE_FLOW_CODES.includes(rawStatus as QuoteFlowCode)
    ? rawStatus
    : "";
  const q = params.get("q")?.trim() ?? "";
  const pageRaw = Number(params.get("page"));
  const page = Number.isInteger(pageRaw) && pageRaw > 0 ? pageRaw : 1;

  return { status, q, page };
}

export function quoteListQuery(input: {
  status?: string;
  q?: string;
  page?: number;
}) {
  const params = new URLSearchParams();
  if (
    input.status &&
    QUOTE_FLOW_CODES.includes(input.status as QuoteFlowCode)
  ) {
    params.set("status", input.status);
  }
  const q = input.q?.trim();
  if (q) {
    params.set("q", q);
  }
  if (input.page && input.page > 1) {
    params.set("page", String(input.page));
  }

  const query = params.toString();
  return query ? `/quotes?${query}` : "/quotes";
}

export function quoteCountLabel(total: number) {
  if (total === 1) {
    return "1 presupuesto";
  }

  return `${total} presupuestos`;
}

export function quotePageRange(
  page: number,
  pageSize: number,
  visibleCount: number,
  total: number
) {
  if (total <= 0 || visibleCount <= 0 || page < 1 || pageSize < 1) {
    return null;
  }

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(from + visibleCount - 1, total);

  return { from, to, total };
}

export function quoteSearchFilter(pattern: string, clientIds: string[]) {
  const parts = [
    `reference.ilike.${pattern}`,
    `title.ilike.${pattern}`,
    `description.ilike.${pattern}`,
    `notes.ilike.${pattern}`,
  ];
  const ids = clientIds.filter((id) => UUID_PATTERN.test(id));

  if (ids.length > 0) {
    parts.push(`client_id.in.(${ids.join(",")})`);
  }

  return parts.join(",");
}

export function operationalCreateVisibility(
  role: string | null | undefined,
  quotesEnabled: boolean
) {
  return {
    order: canWriteOrders(role),
    quote: canAccessQuotesModule(role, quotesEnabled),
  };
}
