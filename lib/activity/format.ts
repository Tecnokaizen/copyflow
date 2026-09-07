import { formatLeadTimeMinutes } from "@/lib/services/types";
import {
  ACTION_OPTIONS,
  type ActivityEvent,
  type FormattedActivity,
  type FormattedChange,
  type JsonValue,
} from "@/lib/activity/types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELD_LABELS: Record<string, string> = {
  title: "Título",
  description: "Descripción",
  notes: "Notas",
  due_at: "Fecha de entrega",
  service_id: "Servicio",
  assigned_team_member_id: "Responsable",
  entry_channel_id: "Canal de entrada",
  order_context_id: "Contexto",
  status: "Estado",
  status_id: "Estado",
  status_name: "Estado",
  client: "Cliente",
  client_id: "Cliente",
  client_name: "Cliente",
  priority: "Prioridad",
  name: "Nombre",
  contact_name: "Contacto",
  company_name: "Empresa",
  tax_id: "NIF / CIF",
  email: "Email",
  phone: "Teléfono",
  customer_type_name: "Tipo de cliente",
  customer_type_id: "Tipo de cliente",
  category_name: "Categoría",
  category_id: "Categoría",
  standard_lead_time_minutes: "Plazo estándar",
  requires_file: "Requiere archivo",
  requires_design: "Requiere diseño",
  requires_quote: "Requiere presupuesto",
  active: "Activo",
  sort_order: "Orden",
  job_title: "Puesto / función",
  department: "Área",
  can_receive_orders: "Disponible para pedidos",
  file_status_id: "Archivos",
  quote_status_id: "Presupuesto",
  payment_status_id: "Pago",
  delivery_method_id: "Entrega",
  option_name: "Valor",
  value: "Valor",
  value_name: "Valor",
  customer_notification_status: "Aviso al cliente",
};

const SENSITIVE_FIELDS = new Set([
  "email",
  "phone",
  "tax_id",
  "notes",
  "description",
  "contact_name",
]);

const SKIP_KEYS = new Set([
  "id",
  "tenant_id",
  "user_id",
  "team_member_id",
  "created_at",
  "updated_at",
  "metadata",
]);

function isUuid(value: string) {
  return UUID_PATTERN.test(value.trim());
}

function asRecord(value: JsonValue | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function formatActivityDateTime(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPriority(value: string) {
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

function formatNotificationStatus(value: string) {
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

function fieldLabel(field: string | null | undefined) {
  if (!field) {
    return "Campo";
  }

  return FIELD_LABELS[field] ?? field.replace(/_/g, " ");
}

function companionNameKey(key: string) {
  const mapped: Record<string, string> = {
    status_id: "status_name",
    value_id: "value_name",
    client_id: "client_name",
    customer_type_id: "customer_type_name",
    category_id: "category_name",
    service_id: "service_name",
    assigned_team_member_id: "assigned_team_member_name",
    option_id: "option_name",
  };

  if (mapped[key]) {
    return mapped[key];
  }

  if (key.endsWith("_id")) {
    return `${key.slice(0, -3)}_name`;
  }

  return null;
}

function shouldSkipKey(
  key: string,
  prev: Record<string, unknown>,
  next: Record<string, unknown>
) {
  if (SKIP_KEYS.has(key) || key.endsWith("_code")) {
    return true;
  }

  const companion = companionNameKey(key);
  if (companion && (prev[companion] != null || next[companion] != null)) {
    return true;
  }

  return false;
}

function formatScalar(field: string, value: unknown): string {
  if (value == null || value === "") {
    return "—";
  }

  if (typeof value === "boolean") {
    return value ? "Sí" : "No";
  }

  if (field === "priority" && typeof value === "string") {
    return formatPriority(value);
  }

  if (field === "customer_notification_status" && typeof value === "string") {
    return formatNotificationStatus(value);
  }

  if (field === "standard_lead_time_minutes") {
    const minutes = typeof value === "number" ? value : Number(value);
    return formatLeadTimeMinutes(Number.isFinite(minutes) ? minutes : null);
  }

  if (
    (field === "due_at" || field.endsWith("_at")) &&
    typeof value === "string"
  ) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return formatActivityDateTime(value);
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "string") {
    if (isUuid(value)) {
      return "—";
    }

    return value.trim() || "—";
  }

  return "—";
}

function humanValue(
  field: string,
  record: Record<string, unknown>,
  fallbackField?: string
) {
  const companion = companionNameKey(field);
  const named =
    (companion ? asString(record[companion]) : null) ??
    asString(record.status_name) ??
    asString(record.value_name) ??
    asString(record.client_name) ??
    asString(record.option_name) ??
    asString(record.service_name) ??
    asString(record.category_name) ??
    asString(record.customer_type_name);

  if (named) {
    return named;
  }

  const raw = record[field] ?? (fallbackField ? record[fallbackField] : undefined);
  return formatScalar(field, raw);
}

function quote(value: string) {
  if (value === "—" || value === "Sin definir" || value === "Sin cliente") {
    return value;
  }

  return `"${value}"`;
}

function changedField(event: ActivityEvent) {
  const metadata = asRecord(event.metadata);
  return (
    event.changed_field ??
    asString(metadata.field) ??
    asString(metadata.changed_field)
  );
}

function entityName(event: ActivityEvent) {
  const label = event.entity_label?.trim() ?? "";
  const metadata = asRecord(event.metadata);

  if (
    !label ||
    label === event.entity_type ||
    label === "service" ||
    label === "team_member"
  ) {
    if (event.entity_type === "service") {
      return asString(metadata.service_name) ?? "un servicio";
    }

    if (event.entity_type === "team_member") {
      return asString(metadata.team_member_name) ?? "un miembro del equipo";
    }

    if (event.entity_type === "order") {
      return asString(metadata.reference) ?? "un pedido";
    }

    if (event.entity_type === "client") {
      return asString(metadata.client_name) ?? "un cliente";
    }

    return "un registro";
  }

  return label;
}

function entityHref(event: ActivityEvent) {
  const id = event.entity_id;

  switch (event.entity_type) {
    case "order":
      return id ? `/orders/${id}` : "/orders";
    case "client":
      return id ? `/clients/${id}` : "/clients";
    case "service":
      return "/services";
    case "team_member":
      return "/team";
    default:
      return null;
  }
}

function actorName(event: ActivityEvent) {
  return event.actor_name?.trim() || "Sistema";
}

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function genericChanges(event: ActivityEvent): FormattedChange[] {
  const prev = asRecord(event.previous_values);
  const next = asRecord(event.new_values);
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])];
  const changes: FormattedChange[] = [];

  for (const key of keys) {
    if (shouldSkipKey(key, prev, next)) {
      continue;
    }

    if (valuesEqual(prev[key], next[key])) {
      continue;
    }

    const from = humanValue(key, prev, key);
    const to = humanValue(key, next, key);

    if (from === to) {
      continue;
    }

    changes.push({
      label: fieldLabel(key),
      from,
      to,
    });
  }

  return changes;
}

function singleChange(
  label: string,
  from: string,
  to: string
): FormattedChange[] {
  return [{ label, from, to }];
}

function extractChanges(event: ActivityEvent): FormattedChange[] {
  const prev = asRecord(event.previous_values);
  const next = asRecord(event.new_values);
  const field = changedField(event);

  switch (event.action) {
    case "order.status_changed":
      return singleChange(
        "Estado",
        humanValue("status_name", prev, "status_id"),
        humanValue("status_name", next, "status_id")
      );

    case "order.client_changed":
      return singleChange(
        "Cliente",
        asString(prev.client_name) || "Sin cliente",
        asString(next.client_name) || "Sin cliente"
      );

    case "order.notification_changed":
      return singleChange(
        "Aviso al cliente",
        formatNotificationStatus(
          asString(prev.customer_notification_status) ?? "not_notified"
        ),
        formatNotificationStatus(
          asString(next.customer_notification_status) ?? "not_notified"
        )
      );

    case "order.management_changed":
      return singleChange(
        fieldLabel(field),
        asString(prev.option_name) || "Sin definir",
        asString(next.option_name) || "Sin definir"
      );

    case "order.details_changed": {
      if (field === "priority") {
        return singleChange(
          "Prioridad",
          formatPriority(asString(prev.value) ?? ""),
          formatPriority(asString(next.value) ?? "")
        );
      }

      if (field === "due_at") {
        return singleChange(
          "Fecha de entrega",
          prev.value ? formatScalar("due_at", prev.value) : "Sin definir",
          next.value ? formatScalar("due_at", next.value) : "Sin definir"
        );
      }

      const label = fieldLabel(field);
      return singleChange(
        label,
        humanValue(field ?? "value", prev, "value"),
        humanValue(field ?? "value", next, "value")
      );
    }

    case "order.content_changed": {
      const label = fieldLabel(field ?? "title");
      const from = formatScalar("value", prev.value);
      const to = formatScalar("value", next.value);
      const quoted = field === "title";

      return singleChange(
        label,
        quoted ? quote(from === "—" ? "Sin definir" : from) : from === "—" ? "Sin definir" : from,
        quoted ? quote(to === "—" ? "Sin definir" : to) : to === "—" ? "Sin definir" : to
      );
    }

    case "client.created":
    case "client.updated":
    case "service.created":
    case "service.updated":
    case "team_member.created":
    case "team_member.updated":
      return genericChanges(event);

    default:
      return genericChanges(event);
  }
}

function headlineFor(event: ActivityEvent, entity: string) {
  const field = changedField(event);

  switch (event.action) {
    case "order.created":
      return `Creó el pedido ${entity}`;
    case "order.status_changed":
      return `Cambió el estado de ${entity}`;
    case "order.client_changed": {
      const prev = asRecord(event.previous_values);
      const next = asRecord(event.new_values);
      const hadClient = Boolean(asString(prev.client_name));
      const hasClient = Boolean(asString(next.client_name));

      if (!hadClient && hasClient) {
        return `Asignó cliente a ${entity}`;
      }

      if (hadClient && !hasClient) {
        return `Quitó el cliente de ${entity}`;
      }

      return `Cambió el cliente de ${entity}`;
    }
    case "order.content_changed":
      if (field === "title") {
        return `Cambió el título de ${entity}`;
      }
      if (field === "description") {
        return `Cambió la descripción de ${entity}`;
      }
      if (field === "notes") {
        return `Cambió las notas de ${entity}`;
      }
      return `Actualizó el contenido de ${entity}`;
    case "order.details_changed":
      if (field === "service_id") {
        return `Cambió el servicio de ${entity}`;
      }
      if (field === "assigned_team_member_id") {
        return `Cambió el responsable de ${entity}`;
      }
      if (field === "due_at") {
        return `Cambió la fecha de entrega de ${entity}`;
      }
      if (field === "priority") {
        return `Cambió la prioridad de ${entity}`;
      }
      if (field === "entry_channel_id") {
        return `Cambió el canal de entrada de ${entity}`;
      }
      if (field === "order_context_id") {
        return `Cambió el contexto de ${entity}`;
      }
      return `Actualizó los detalles de ${entity}`;
    case "order.management_changed":
      return `Cambió ${fieldLabel(field).toLowerCase()} de ${entity}`;
    case "order.notification_changed":
      return `Cambió el aviso al cliente de ${entity}`;
    case "client.created":
      return `Creó el cliente ${entity}`;
    case "client.updated":
      return `Actualizó el cliente ${entity}`;
    case "service.created":
      return `Creó el servicio ${entity}`;
    case "service.updated":
      return `Actualizó el servicio ${entity}`;
    case "team_member.created":
      return `Creó a ${entity}`;
    case "team_member.updated":
      return `Actualizó a ${entity}`;
    default:
      return `Realizó una actualización en ${entity}`;
  }
}

function cardSummary(event: ActivityEvent, changes: FormattedChange[]) {
  if (
    event.action === "client.updated" ||
    event.action === "service.updated" ||
    event.action === "team_member.updated"
  ) {
    return null;
  }

  const visible = changes.filter((change) => {
    const key = Object.entries(FIELD_LABELS).find(
      ([, label]) => label === change.label
    )?.[0];

    return !key || !SENSITIVE_FIELDS.has(key);
  });

  if (visible.length === 1) {
    return `${visible[0].from} → ${visible[0].to}`;
  }

  return null;
}

export function formatActivityEvent(event: ActivityEvent): FormattedActivity {
  const actor = actorName(event);
  const entity = entityName(event);
  const known = [
    "order.created",
    "order.status_changed",
    "order.client_changed",
    "order.content_changed",
    "order.details_changed",
    "order.management_changed",
    "order.notification_changed",
    "client.created",
    "client.updated",
    "service.created",
    "service.updated",
    "team_member.created",
    "team_member.updated",
  ].includes(event.action);

  const changes = extractChanges(event);
  const headline = known
    ? headlineFor(event, entity)
    : `Realizó una actualización en ${entity}`;

  return {
    actor,
    headline,
    entityLabel: entity,
    summary: known ? cardSummary(event, changes) : null,
    changes,
    href: entityHref(event),
  };
}

export function actionsForEntity(entityType: string) {
  if (!entityType) {
    return ACTION_OPTIONS;
  }

  const prefix = `${entityType}.`;
  return ACTION_OPTIONS.filter((option) => option.value.startsWith(prefix));
}
