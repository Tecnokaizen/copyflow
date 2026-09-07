const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ClientPayload = {
  customer_type_id: string | null;
  name: string;
  contact_name: string | null;
  company_name: string | null;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
};

function normalizeOptionalText(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed ? trimmed : null };
}

function normalizeCustomerTypeId(
  value: unknown
): { ok: true; value: string | null } | { ok: false } {
  if (value == null) {
    return { ok: true, value: null };
  }

  if (typeof value !== "string") {
    return { ok: false };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  if (!UUID_PATTERN.test(trimmed)) {
    return { ok: false };
  }

  return { ok: true, value: trimmed };
}

export function parseClientPayload(
  payload: Record<string, unknown>
): { ok: true; data: ClientPayload } | { ok: false } {
  if (typeof payload.name !== "string") {
    return { ok: false };
  }

  const name = payload.name.trim();
  if (!name) {
    return { ok: false };
  }

  const customerTypeId = normalizeCustomerTypeId(payload.customer_type_id);
  const contactName = normalizeOptionalText(payload.contact_name);
  const companyName = normalizeOptionalText(payload.company_name);
  const taxId = normalizeOptionalText(payload.tax_id);
  const email = normalizeOptionalText(payload.email);
  const phone = normalizeOptionalText(payload.phone);
  const notes = normalizeOptionalText(payload.notes);

  if (
    !customerTypeId.ok ||
    !contactName.ok ||
    !companyName.ok ||
    !taxId.ok ||
    !email.ok ||
    !phone.ok ||
    !notes.ok
  ) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      customer_type_id: customerTypeId.value,
      name,
      contact_name: contactName.value,
      company_name: companyName.value,
      tax_id: taxId.value,
      email: email.value,
      phone: phone.value,
      notes: notes.value,
    },
  };
}

export { UUID_PATTERN };
