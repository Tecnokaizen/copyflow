import {
  MANAGEMENT_ROLES,
  hasMembershipRole,
} from "@/lib/auth/membership-roles";

export const ACTIVITY_ENTITY_TYPES = [
  "order",
  "client",
  "service",
  "team_member",
] as const;

export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number];

export const ACTIVITY_ACTIONS = [
  "client.created",
  "client.updated",
  "order.created",
  "order.status_changed",
  "order.client_changed",
  "order.content_changed",
  "order.details_changed",
  "order.management_changed",
  "order.notification_changed",
  "service.created",
  "service.updated",
  "team_member.created",
  "team_member.updated",
] as const;

export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ActivityEvent = {
  id: string;
  created_at: string;
  actor_type: string | null;
  actor_name: string | null;
  user_id: string | null;
  team_member_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  entity_label: string | null;
  changed_field: string | null;
  previous_values: JsonValue | null;
  new_values: JsonValue | null;
  metadata: JsonValue | null;
};

export type ActivityResponse = {
  tenant: string;
  events: ActivityEvent[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  has_more: boolean;
};

export type FormattedChange = {
  label: string;
  from: string;
  to: string;
};

export type FormattedActivity = {
  actor: string;
  headline: string;
  entityLabel: string;
  summary: string | null;
  changes: FormattedChange[];
  href: string | null;
};

export const ENTITY_TYPE_OPTIONS: { value: ActivityEntityType; label: string }[] =
  [
    { value: "order", label: "Pedidos" },
    { value: "client", label: "Clientes" },
    { value: "service", label: "Servicios" },
    { value: "team_member", label: "Equipo" },
  ];

export const ACTION_OPTIONS: { value: ActivityAction; label: string }[] = [
  { value: "order.created", label: "Pedido creado" },
  { value: "order.status_changed", label: "Cambio de estado" },
  { value: "order.client_changed", label: "Cambio de cliente" },
  { value: "order.content_changed", label: "Cambio de contenido" },
  { value: "order.details_changed", label: "Cambio de detalles" },
  { value: "order.management_changed", label: "Cambio de gestión" },
  { value: "order.notification_changed", label: "Aviso al cliente" },
  { value: "client.created", label: "Cliente creado" },
  { value: "client.updated", label: "Cliente actualizado" },
  { value: "service.created", label: "Servicio creado" },
  { value: "service.updated", label: "Servicio actualizado" },
  { value: "team_member.created", label: "Miembro creado" },
  { value: "team_member.updated", label: "Miembro actualizado" },
];

export function canViewActivity(role: string | null | undefined) {
  return hasMembershipRole(role, MANAGEMENT_ROLES);
}

function asNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseJsonValue(value: unknown): JsonValue | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    try {
      return parseJsonValue(JSON.parse(value));
    } catch {
      return value;
    }
  }

  return value as JsonValue;
}

export function unwrapRpcPayload(data: unknown): Record<string, unknown> {
  const payload = Array.isArray(data) ? data[0] : data;
  if (payload && typeof payload === "object") {
    return payload as Record<string, unknown>;
  }

  return {};
}

export function mapActivityEvent(row: unknown): ActivityEvent | null {
  if (!row || typeof row !== "object") {
    return null;
  }

  const record = row as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : null;
  const createdAt =
    typeof record.created_at === "string" ? record.created_at : null;
  const action = typeof record.action === "string" ? record.action : null;
  const entityType =
    typeof record.entity_type === "string" ? record.entity_type : null;

  if (!id || !createdAt || !action || !entityType) {
    return null;
  }

  return {
    id,
    created_at: createdAt,
    actor_type: asNullableString(record.actor_type),
    actor_name: asNullableString(record.actor_name),
    user_id: asNullableString(record.user_id),
    team_member_id: asNullableString(record.team_member_id),
    action,
    entity_type: entityType,
    entity_id: asNullableString(record.entity_id),
    entity_label: asNullableString(record.entity_label),
    changed_field: asNullableString(record.changed_field),
    previous_values: parseJsonValue(record.previous_values),
    new_values: parseJsonValue(record.new_values),
    metadata: parseJsonValue(record.metadata),
  };
}
