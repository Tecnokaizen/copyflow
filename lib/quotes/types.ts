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

export type QuoteVersionState = "draft" | "prepared" | "sent";

export type QuoteCommercialSummary = {
  current_version_id: string | null;
  current_version_number: number | null;
  current_version_state: QuoteVersionState | null;
  accepted_version_id: string | null;
  subtotal: string;
  tax_total: string;
  total: string;
  currency: string;
  issue_date: string;
  valid_until: string | null;
};

export type QuoteItem = {
  id: string;
  position: number;
  concept: string;
  description: string | null;
  quantity: string;
  unit: string | null;
  unit_price: string;
  discount_percent: string;
  tax_rate: string;
  subtotal: string;
  tax_amount: string;
  total: string;
};

export type QuoteTaxBreakdown = {
  tax_rate: string;
  subtotal: string;
  tax_amount: string;
  total: string;
};

export type QuoteVersion = {
  id: string;
  quote_id: string;
  version_number: number;
  state: QuoteVersionState;
  title: string | null;
  description: string;
  terms: string | null;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  prices_include_tax: boolean;
  subtotal: string;
  tax_total: string;
  total: string;
  tax_breakdown: QuoteTaxBreakdown[];
  pdf_file_id: string | null;
  created_at: string;
  locked_at: string | null;
  sent_at: string | null;
  row_version: number;
};

export type QuoteVersionSummary = Pick<
  QuoteVersion,
  | "id"
  | "version_number"
  | "state"
  | "issue_date"
  | "valid_until"
  | "currency"
  | "subtotal"
  | "tax_total"
  | "total"
  | "created_at"
  | "locked_at"
  | "sent_at"
  | "row_version"
>;

export type QuoteRecord = QuoteCommercialSummary & {
  id: string;
  reference: string;
  title: string | null;
  description: string;
  notes: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_name: string | null;
  tax_id: string | null;
  billing_address: string | null;
  prices_include_tax: boolean;
  created_at: string;
  updated_at: string;
  row_version: number;
  converted_order_id: string | null;
  status: QuoteStatusRef | null;
  client: QuotePartyRef | null;
  service: QuotePartyRef | null;
  assignee: QuotePartyRef | null;
  converted_order: QuoteOrderRef | null;
};

export type QuoteCommercialDetail = {
  quote: QuoteRecord;
  current_version: QuoteVersion | null;
  items: QuoteItem[];
  versions: QuoteVersionSummary[];
};

export type QuoteDraftHeader = {
  title: string | null;
  description: string;
  terms: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  billing_name: string | null;
  tax_id: string | null;
  billing_address: string | null;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  prices_include_tax: boolean;
};

export type QuoteDraftItemInput = Pick<
  QuoteItem,
  | "concept"
  | "description"
  | "quantity"
  | "unit"
  | "unit_price"
  | "discount_percent"
  | "tax_rate"
>;

export type QuoteDraftPayload = {
  version_id: string;
  expected_row_version: number;
  header: QuoteDraftHeader;
  items: QuoteDraftItemInput[];
};

export type QuotePreparePayload = {
  version_id: string;
  expected_row_version: number;
};

export type QuoteCommercialTotals = Pick<QuoteVersion, "subtotal" | "tax_total" | "total" | "currency">;

export type QuoteSaveDraftResult = {
  ok: true;
  tenant: string;
  version: QuoteVersion;
  totals: QuoteCommercialTotals;
};

export type QuotePrepareResult = {
  ok: true;
  tenant: string;
  quote: QuoteRecord;
  prepared_version: QuoteVersion;
  totals: QuoteCommercialTotals;
};

export type QuoteCreateVersionResult = {
  ok: true;
  tenant: string;
  created: boolean;
  replayed: boolean;
  version: QuoteVersion;
};

export type QuoteConcurrencyConflict = {
  error: string;
  code: "stale_row_version";
  current_row_version?: number;
};

export const QUOTE_SELECT = `
  id,
  reference,
  title,
  description,
  notes,
  valid_until,
  contact_name,
  contact_email,
  contact_phone,
  billing_name,
  tax_id,
  billing_address,
  issue_date,
  currency,
  prices_include_tax,
  subtotal,
  tax_total,
  total,
  current_version_id,
  accepted_version_id,
  converted_order_id,
  created_at,
  updated_at,
  row_version,
  current_version:quote_versions!quotes_current_version_fk (
    version_number,
    state
  ),
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

function asInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function asDecimal(value: unknown) {
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return String(value);
  }

  return null;
}

function versionState(value: unknown): QuoteVersionState | null {
  return value === "draft" || value === "prepared" || value === "sent"
    ? value
    : null;
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
  const rowVersion = asInteger(row?.row_version);
  const currentVersion = asRecord(row?.current_version);
  const currentVersionNumber = currentVersion
    ? asInteger(currentVersion.version_number)
    : null;
  const currentVersionState = currentVersion
    ? versionState(currentVersion.state)
    : null;
  const subtotal = asDecimal(row?.subtotal);
  const taxTotal = asDecimal(row?.tax_total);
  const total = asDecimal(row?.total);
  const currency = asString(row?.currency);
  const issueDate = asString(row?.issue_date);

  if (
    !row ||
    !id ||
    !reference ||
    !description ||
    !createdAt ||
    !updatedAt ||
    rowVersion === null ||
    subtotal === null ||
    taxTotal === null ||
    total === null ||
    !currency ||
    !issueDate
  ) {
    return null;
  }

  return {
    id,
    reference,
    title: asString(row.title),
    description,
    notes: asString(row.notes),
    contact_name: asString(row.contact_name),
    contact_email: asString(row.contact_email),
    contact_phone: asString(row.contact_phone),
    billing_name: asString(row.billing_name),
    tax_id: asString(row.tax_id),
    billing_address: asString(row.billing_address),
    issue_date: issueDate,
    valid_until: asString(row.valid_until),
    currency,
    prices_include_tax: row.prices_include_tax === true,
    subtotal,
    tax_total: taxTotal,
    total,
    current_version_id: asString(row.current_version_id),
    current_version_number: currentVersionNumber,
    current_version_state: currentVersionState,
    accepted_version_id: asString(row.accepted_version_id),
    created_at: createdAt,
    updated_at: updatedAt,
    row_version: rowVersion,
    converted_order_id: asString(row.converted_order_id),
    status: status(row.status),
    client: party(row.client),
    service: party(row.service),
    assignee: party(row.assignee),
    converted_order: orderRef(row.converted_order),
  };
}

export const QUOTE_VERSION_SELECT = `
  id,
  quote_id,
  version_number,
  state,
  title,
  description,
  terms,
  issue_date,
  valid_until,
  currency,
  prices_include_tax,
  subtotal,
  tax_total,
  total,
  tax_breakdown,
  pdf_file_id,
  created_at,
  locked_at,
  sent_at,
  row_version
`;

export const QUOTE_ITEM_SELECT = `
  id,
  position,
  concept,
  description,
  quantity,
  unit,
  unit_price,
  discount_percent,
  tax_rate,
  subtotal,
  tax_amount,
  total
`;

export function mapQuoteItem(value: unknown): QuoteItem | null {
  const row = asRecord(value);
  const id = asString(row?.id);
  const position = asInteger(row?.position);
  const concept = asString(row?.concept);
  const quantity = asDecimal(row?.quantity);
  const unitPrice = asDecimal(row?.unit_price);
  const discountPercent = asDecimal(row?.discount_percent);
  const taxRate = asDecimal(row?.tax_rate);
  const subtotal = asDecimal(row?.subtotal);
  const taxAmount = asDecimal(row?.tax_amount);
  const total = asDecimal(row?.total);

  if (
    !row ||
    !id ||
    position === null ||
    position < 1 ||
    !concept ||
    quantity === null ||
    unitPrice === null ||
    discountPercent === null ||
    taxRate === null ||
    subtotal === null ||
    taxAmount === null ||
    total === null
  ) {
    return null;
  }

  return {
    id,
    position,
    concept,
    description: asString(row.description),
    quantity,
    unit: asString(row.unit),
    unit_price: unitPrice,
    discount_percent: discountPercent,
    tax_rate: taxRate,
    subtotal,
    tax_amount: taxAmount,
    total,
  };
}

function mapTaxBreakdown(value: unknown): QuoteTaxBreakdown[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const rows = value.map((entry) => {
    const row = asRecord(entry);
    const taxRate = asDecimal(row?.tax_rate);
    const subtotal = asDecimal(row?.subtotal);
    const taxAmount = asDecimal(row?.tax_amount);
    const total = asDecimal(row?.total);
    return row && taxRate !== null && subtotal !== null && taxAmount !== null && total !== null
      ? { tax_rate: taxRate, subtotal, tax_amount: taxAmount, total }
      : null;
  });

  return rows.every((row) => row !== null) ? rows : null;
}

export function mapQuoteVersion(value: unknown): QuoteVersion | null {
  const row = asRecord(value);
  const id = asString(row?.id);
  const quoteId = asString(row?.quote_id);
  const versionNumber = asInteger(row?.version_number);
  const state = versionState(row?.state);
  const description = asString(row?.description);
  const issueDate = asString(row?.issue_date);
  const currency = asString(row?.currency);
  const subtotal = asDecimal(row?.subtotal);
  const taxTotal = asDecimal(row?.tax_total);
  const total = asDecimal(row?.total);
  const taxBreakdown = mapTaxBreakdown(row?.tax_breakdown);
  const createdAt = asString(row?.created_at);
  const rowVersion = asInteger(row?.row_version);

  if (
    !row ||
    !id ||
    !quoteId ||
    versionNumber === null ||
    versionNumber < 1 ||
    !state ||
    description === null ||
    !issueDate ||
    !currency ||
    subtotal === null ||
    taxTotal === null ||
    total === null ||
    taxBreakdown === null ||
    !createdAt ||
    rowVersion === null
  ) {
    return null;
  }

  return {
    id,
    quote_id: quoteId,
    version_number: versionNumber,
    state,
    title: asString(row.title),
    description,
    terms: asString(row.terms),
    issue_date: issueDate,
    valid_until: asString(row.valid_until),
    currency,
    prices_include_tax: row.prices_include_tax === true,
    subtotal,
    tax_total: taxTotal,
    total,
    tax_breakdown: taxBreakdown,
    pdf_file_id: asString(row.pdf_file_id),
    created_at: createdAt,
    locked_at: asString(row.locked_at),
    sent_at: asString(row.sent_at),
    row_version: rowVersion,
  };
}

export function summarizeQuoteVersion(version: QuoteVersion): QuoteVersionSummary {
  return {
    id: version.id,
    version_number: version.version_number,
    state: version.state,
    issue_date: version.issue_date,
    valid_until: version.valid_until,
    currency: version.currency,
    subtotal: version.subtotal,
    tax_total: version.tax_total,
    total: version.total,
    created_at: version.created_at,
    locked_at: version.locked_at,
    sent_at: version.sent_at,
    row_version: version.row_version,
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
