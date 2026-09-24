export type QuoteStatusRef = {
  id: string;
  name: string;
  code: string;
  color: string | null;
};

export type QuotePartyRef = {
  id: string;
  name: string;
};

export type QuoteOrderRef = {
  id: string;
  reference: string;
};

export type QuoteRecord = {
  id: string;
  reference: string;
  title: string | null;
  description: string;
  notes: string | null;
  valid_until: string | null;
  created_at: string;
  updated_at: string;
  row_version: number;
  status: QuoteStatusRef | null;
  client: QuotePartyRef | null;
  service: QuotePartyRef | null;
  assignee: QuotePartyRef | null;
  converted_order: QuoteOrderRef | null;
};

export const QUOTE_SELECT = `
  id,
  reference,
  title,
  description,
  notes,
  valid_until,
  created_at,
  updated_at,
  row_version,
  status:quote_statuses (
    id,
    name,
    code,
    color
  ),
  client:clients (
    id,
    name
  ),
  service:services (
    id,
    name
  ),
  assignee:team_members!quotes_assignee_fk (
    id,
    name
  ),
  converted_order:orders!quotes_converted_order_fk (
    id,
    reference
  )
`;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function party(value: unknown): QuotePartyRef | null {
  const row = asRecord(value);
  const id = asString(row?.id);
  const name = asString(row?.name);
  if (!row || !id || !name) {
    return null;
  }

  return { id, name };
}

function status(value: unknown): QuoteStatusRef | null {
  const row = asRecord(value);
  const id = asString(row?.id);
  const name = asString(row?.name);
  const code = asString(row?.code);
  if (!row || !id || !name || !code) {
    return null;
  }

  return {
    id,
    name,
    code,
    color: asString(row.color),
  };
}

function orderRef(value: unknown): QuoteOrderRef | null {
  const row = asRecord(value);
  const id = asString(row?.id);
  const reference = asString(row?.reference);
  if (!row || !id || !reference) {
    return null;
  }

  return { id, reference };
}

export function mapQuote(value: unknown): QuoteRecord | null {
  const row = asRecord(value);
  const id = asString(row?.id);
  const reference = asString(row?.reference);
  const description = asString(row?.description);
  const createdAt = asString(row?.created_at);
  const updatedAt = asString(row?.updated_at);
  const rowVersion =
    typeof row?.row_version === "number"
      ? row.row_version
      : typeof row?.row_version === "string"
        ? Number(row.row_version)
        : Number.NaN;

  if (
    !row ||
    !id ||
    !reference ||
    !description ||
    !createdAt ||
    !updatedAt ||
    !Number.isInteger(rowVersion)
  ) {
    return null;
  }

  return {
    id,
    reference,
    title: asString(row.title),
    description,
    notes: asString(row.notes),
    valid_until: asString(row.valid_until),
    created_at: createdAt,
    updated_at: updatedAt,
    row_version: rowVersion,
    status: status(row.status),
    client: party(row.client),
    service: party(row.service),
    assignee: party(row.assignee),
    converted_order: orderRef(row.converted_order),
  };
}

export function quoteStatusTone(code: string | null | undefined) {
  switch (code) {
    case "draft":
      return "neutral" as const;
    case "pending":
      return "warning" as const;
    case "sent":
      return "info" as const;
    case "accepted":
      return "success" as const;
    case "rejected":
      return "danger" as const;
    default:
      return "brand" as const;
  }
}
