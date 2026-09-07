export type ClientSummary = {
  id: string;
  customer_type_id: string | null;
  customer_type_name: string | null;
  name: string;
  contact_name: string | null;
  company_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

export type ClientFormData = {
  customer_type_id: string;
  name: string;
  contact_name: string;
  company_name: string;
  tax_id: string;
  email: string;
  phone: string;
  notes: string;
};

export type ClientDuplicate = {
  client_id: string;
  client_name: string | null;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  email_match: boolean;
  phone_match: boolean;
  tax_id_match: boolean;
};

export const EMPTY_CLIENT_FORM: ClientFormData = {
  customer_type_id: "",
  name: "",
  contact_name: "",
  company_name: "",
  tax_id: "",
  email: "",
  phone: "",
  notes: "",
};

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return value == null ? null : null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

export function mapClientSummary(row: unknown): ClientSummary | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name : null;

  if (!id || !name) {
    return null;
  }

  const nestedType =
    record.customer_type && typeof record.customer_type === "object"
      ? (record.customer_type as Record<string, unknown>)
      : null;

  return {
    id,
    customer_type_id: asNullableString(record.customer_type_id),
    customer_type_name:
      asNullableString(record.customer_type_name) ??
      asNullableString(nestedType?.name),
    name,
    contact_name: asNullableString(record.contact_name),
    company_name: asNullableString(record.company_name),
    tax_id: asNullableString(record.tax_id),
    email: asNullableString(record.email),
    phone: asNullableString(record.phone),
    notes: asNullableString(record.notes),
  };
}

export function mapClientSummaries(data: unknown): ClientSummary[] {
  const rows = Array.isArray(data)
    ? data
    : data &&
        typeof data === "object" &&
        Array.isArray((data as { clients?: unknown }).clients)
      ? ((data as { clients: unknown[] }).clients ?? [])
      : [];

  return rows
    .map((row) => mapClientSummary(row))
    .filter((row): row is ClientSummary => row !== null);
}

export function parseClientDuplicate(raw: unknown): ClientDuplicate | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown = raw;

  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const clientId =
    typeof record.client_id === "string" ? record.client_id : null;

  if (!clientId) {
    return null;
  }

  return {
    client_id: clientId,
    client_name: asNullableString(record.client_name),
    email: asNullableString(record.email),
    phone: asNullableString(record.phone),
    tax_id: asNullableString(record.tax_id),
    email_match: asBoolean(record.email_match),
    phone_match: asBoolean(record.phone_match),
    tax_id_match: asBoolean(record.tax_id_match),
  };
}

export function toClientPayload(form: ClientFormData) {
  return {
    customer_type_id: form.customer_type_id.trim() || null,
    name: form.name.trim(),
    contact_name: form.contact_name.trim() || null,
    company_name: form.company_name.trim() || null,
    tax_id: form.tax_id.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    notes: form.notes.trim() || null,
  };
}

export function summaryFromForm(
  form: ClientFormData,
  customerTypeName: string | null
): ClientSummary {
  return {
    id: "pending",
    customer_type_id: form.customer_type_id.trim() || null,
    customer_type_name: customerTypeName,
    name: form.name.trim(),
    contact_name: form.contact_name.trim() || null,
    company_name: form.company_name.trim() || null,
    tax_id: form.tax_id.trim() || null,
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    notes: form.notes.trim() || null,
  };
}

export function clientToForm(client: {
  customer_type_id: string | null;
  name: string;
  contact_name: string | null;
  company_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
}): ClientFormData {
  return {
    customer_type_id: client.customer_type_id ?? "",
    name: client.name,
    contact_name: client.contact_name ?? "",
    company_name: client.company_name ?? "",
    tax_id: client.tax_id ?? "",
    email: client.email ?? "",
    phone: client.phone ?? "",
    notes: client.notes ?? "",
  };
}

export function duplicateMatchLabels(duplicate: ClientDuplicate): string[] {
  const labels: string[] = [];

  if (duplicate.email_match) {
    labels.push("email");
  }

  if (duplicate.phone_match) {
    labels.push("teléfono");
  }

  if (duplicate.tax_id_match) {
    labels.push("NIF/CIF");
  }

  return labels;
}

export function formatCreateDuplicateMessage(duplicate: ClientDuplicate): string {
  const name = duplicate.client_name?.trim() || "un cliente";

  if (duplicate.email_match) {
    return `Ya existe ${name} con este email.`;
  }

  if (duplicate.phone_match) {
    return `Ya existe ${name} con este teléfono.`;
  }

  if (duplicate.tax_id_match) {
    return `Ya existe ${name} con este NIF/CIF.`;
  }

  return `Ya existe ${name} con estos datos.`;
}
