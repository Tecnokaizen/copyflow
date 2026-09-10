import { canWriteServices } from "@/lib/auth/membership-roles";

export type ServiceItem = {
  id: string;
  category_id: string | null;
  category_name: string | null;
  name: string;
  description: string | null;
  standard_lead_time_minutes: number | null;
  requires_file: boolean;
  requires_design: boolean;
  requires_quote: boolean;
  active: boolean;
  sort_order: number;
  orders_count: number;
  created_at: string;
  updated_at: string;
};

export type ServiceListResponse = {
  tenant: string;
  services: ServiceItem[];
  total: number;
  average_standard_lead_time_minutes: number | null;
};

export type ServiceCategory = {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
};

export type LeadTimeUnit = "minutes" | "hours" | "days";

export type ServiceFormData = {
  category_id: string;
  name: string;
  description: string;
  lead_time_value: string;
  lead_time_unit: LeadTimeUnit;
  requires_file: boolean;
  requires_design: boolean;
  requires_quote: boolean;
  active: boolean;
  sort_order: string;
};

export type ServicePayload = {
  category_id: string | null;
  name: string;
  description: string | null;
  standard_lead_time_minutes: number | null;
  requires_file: boolean;
  requires_design: boolean;
  requires_quote: boolean;
  active: boolean;
  sort_order: number;
};

export const EMPTY_SERVICE_FORM: ServiceFormData = {
  category_id: "",
  name: "",
  description: "",
  lead_time_value: "",
  lead_time_unit: "days",
  requires_file: false,
  requires_design: false,
  requires_quote: false,
  active: true,
  sort_order: "0",
};

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asBoolean(value: unknown, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  return value === true || value === "t" || value === "true" || value === 1;
}

function asNumber(value: unknown, fallback: number | null = null) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

export { canWriteServices };

export function unwrapRpcPayload(data: unknown): Record<string, unknown> {
  const payload = Array.isArray(data) ? data[0] : data;
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }

  return {};
}

export function mapServiceItem(row: unknown): ServiceItem | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const name = typeof record.name === "string" ? record.name : null;

  if (!id || !name) {
    return null;
  }

  const nestedCategoryRaw = Array.isArray(record.category)
    ? record.category[0]
    : record.category;
  const nestedCategory =
    nestedCategoryRaw && typeof nestedCategoryRaw === "object"
      ? (nestedCategoryRaw as Record<string, unknown>)
      : null;

  return {
    id,
    category_id: asNullableString(record.category_id),
    category_name:
      asNullableString(record.category_name) ??
      asNullableString(nestedCategory?.name),
    name,
    description: asNullableString(record.description),
    standard_lead_time_minutes: asNumber(
      record.standard_lead_time_minutes,
      null
    ),
    requires_file: asBoolean(record.requires_file),
    requires_design: asBoolean(record.requires_design),
    requires_quote: asBoolean(record.requires_quote),
    active: record.active === undefined ? true : asBoolean(record.active, true),
    sort_order: asNumber(record.sort_order, 0) ?? 0,
    orders_count: asNumber(record.orders_count, 0) ?? 0,
    created_at:
      typeof record.created_at === "string" ? record.created_at : "",
    updated_at:
      typeof record.updated_at === "string" ? record.updated_at : "",
  };
}

export function formatLeadTimeMinutes(minutes: number | null | undefined) {
  if (minutes == null || !Number.isFinite(minutes)) {
    return "—";
  }

  const value = Math.round(minutes);

  if (value === 0) {
    return "0 min";
  }

  if (value % 1440 === 0) {
    const days = value / 1440;
    return days === 1 ? "1 día" : `${days} días`;
  }

  if (value % 60 === 0) {
    const hours = value / 60;
    return hours === 1 ? "1 h" : `${hours} h`;
  }

  if (value >= 1440) {
    const days = value / 1440;
    const formatted = days.toLocaleString("es-ES", {
      maximumFractionDigits: 1,
    });
    return `${formatted} días`;
  }

  if (value >= 60) {
    const hours = value / 60;
    const formatted = hours.toLocaleString("es-ES", {
      maximumFractionDigits: 1,
    });
    return `${formatted} h`;
  }

  return value === 1 ? "1 min" : `${value} min`;
}

export function minutesToLeadTime(minutes: number | null): {
  value: string;
  unit: LeadTimeUnit;
} {
  if (minutes == null || !Number.isFinite(minutes)) {
    return { value: "", unit: "days" };
  }

  const value = Math.round(minutes);

  if (value !== 0 && value % 1440 === 0) {
    return { value: String(value / 1440), unit: "days" };
  }

  if (value !== 0 && value % 60 === 0) {
    return { value: String(value / 60), unit: "hours" };
  }

  return { value: String(value), unit: "minutes" };
}

export function leadTimeToMinutes(
  value: string,
  unit: LeadTimeUnit
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, value: null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false };
  }

  const factor = unit === "days" ? 1440 : unit === "hours" ? 60 : 1;
  const minutes = Math.round(parsed * factor);

  if (!Number.isInteger(minutes) || minutes < 0) {
    return { ok: false };
  }

  return { ok: true, value: minutes };
}

export function serviceToForm(service: ServiceItem): ServiceFormData {
  const leadTime = minutesToLeadTime(service.standard_lead_time_minutes);

  return {
    category_id: service.category_id ?? "",
    name: service.name,
    description: service.description ?? "",
    lead_time_value: leadTime.value,
    lead_time_unit: leadTime.unit,
    requires_file: service.requires_file,
    requires_design: service.requires_design,
    requires_quote: service.requires_quote,
    active: service.active,
    sort_order: String(service.sort_order),
  };
}

export function formToServicePayload(
  form: ServiceFormData
): { ok: true; data: ServicePayload } | { ok: false } {
  const name = form.name.trim();
  if (!name) {
    return { ok: false };
  }

  const leadTime = leadTimeToMinutes(form.lead_time_value, form.lead_time_unit);
  if (!leadTime.ok) {
    return { ok: false };
  }

  const sortOrderRaw = form.sort_order.trim();
  const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    return { ok: false };
  }

  return {
    ok: true,
    data: {
      category_id: form.category_id.trim() || null,
      name,
      description: form.description.trim() || null,
      standard_lead_time_minutes: leadTime.value,
      requires_file: form.requires_file,
      requires_design: form.requires_design,
      requires_quote: form.requires_quote,
      active: form.active,
      sort_order: sortOrder,
    },
  };
}
