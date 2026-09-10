import type { ActivityItem } from "@/lib/orders/types";

export function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function toDateTimeLocalValue(value: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);

  return local.toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatContentField(value: string | undefined) {
  switch (value) {
    case "title":
      return "Título";
    case "description":
      return "Descripción";
    case "notes":
      return "Notas";
    default:
      return "Contenido";
  }
}

function summarizeActivityValue(value: string | null | undefined) {
  if (!value) return "Sin definir";

  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 80) {
    return normalized;
  }

  return `${normalized.slice(0, 77)}...`;
}

function formatDetailField(value: string | undefined) {
  switch (value) {
    case "priority":
      return "Prioridad";
    case "service_id":
      return "Servicio";
    case "entry_channel_id":
      return "Canal de entrada";
    case "assigned_team_member_id":
      return "Responsable";
    case "order_context_id":
      return "Contexto";
    case "due_at":
      return "Fecha prevista";
    default:
      return "Pedido";
  }
}

function formatManagementField(value: string | undefined) {
  switch (value) {
    case "file_status_id":
      return "Archivos";
    case "quote_status_id":
      return "Presupuesto";
    case "payment_status_id":
      return "Pago";
    case "delivery_method_id":
      return "Entrega";
    default:
      return "Gestión";
  }
}

export function formatPriority(value: string) {
  switch (value) {
    case "normal":
      return "Normal";
    case "high":
      return "Alta";
    case "urgent":
      return "Urgente";
    default:
      return value || "—";
  }
}

export function formatCustomerNotificationStatus(value: string) {
  switch (value) {
    case "not_notified":
      return "No avisado";
    case "notified":
      return "Avisado";
    case "notified_no_pickup":
      return "Avisado pero no viene";
    default:
      return value || "—";
  }
}

export function formatActivityText(item: ActivityItem) {
  if (item.action === "order.status_changed") {
    const from = item.previous_values?.status_name ?? "—";
    const to = item.new_values?.status_name ?? "—";
    return `${from} → ${to}`;
  }

  if (item.action === "order.notification_changed") {
    const from = formatCustomerNotificationStatus(
      item.previous_values?.customer_notification_status ?? "not_notified"
    );

    const to = formatCustomerNotificationStatus(
      item.new_values?.customer_notification_status ?? "not_notified"
    );

    return `Aviso al cliente: ${from} → ${to}`;
  }

  if (item.action === "order.created") {
    return "Pedido creado";
  }

  if (item.action === "order.management_changed") {
    const field = formatManagementField(item.metadata.field);
    const from = item.previous_values?.option_name ?? "Sin definir";
    const to = item.new_values?.option_name ?? "Sin definir";

    return `${field}: ${from} → ${to}`;
  }

  if (item.action === "order.details_changed") {
    const field = item.metadata.field;

    if (field === "priority") {
      const from = formatPriority(item.previous_values?.value ?? "");
      const to = formatPriority(item.new_values?.value ?? "");

      return `Prioridad: ${from} → ${to}`;
    }

    if (field === "due_at") {
      const from = item.previous_values?.value
        ? formatDate(item.previous_values.value)
        : "Sin definir";

      const to = item.new_values?.value
        ? formatDate(item.new_values.value)
        : "Sin definir";

      return `Fecha prevista: ${from} → ${to}`;
    }

    const label = formatDetailField(field);
    const from = item.previous_values?.value_name ?? "Sin definir";
    const to = item.new_values?.value_name ?? "Sin definir";

    return `${label}: ${from} → ${to}`;
  }

  if (item.action === "order.content_changed") {
    const field = item.metadata.field;

    const from = summarizeActivityValue(item.previous_values?.value);
    const to = summarizeActivityValue(item.new_values?.value);

    return `${formatContentField(field)}: ${from} → ${to}`;
  }

  if (item.action === "order.client_changed") {
    const from = item.previous_values?.client_name ?? "Sin cliente";
    const to = item.new_values?.client_name ?? "Sin cliente";

    return `Cliente: ${from} → ${to}`;
  }

  return item.action;
}

export function displayValue(value: string | null | undefined) {
  if (!value || !value.trim()) return "—";
  return value;
}
