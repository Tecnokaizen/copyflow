import type {
  ContentField,
  DetailField,
  ManagementField,
  Order,
  OrderDraft,
  OrderStatus,
} from "@/lib/orders/types";

export function resolveOrderStatusId(
  order: Order,
  statuses: OrderStatus[]
): string {
  if (order.status_id) return order.status_id;

  const byCode = statuses.find((item) => item.code === order.status?.code);
  return byCode?.id ?? "";
}

export function createOrderDraft(
  order: Order,
  statuses: OrderStatus[]
): OrderDraft {
  return {
    title: order.title,
    description: order.description ?? "",
    notes: order.notes ?? "",
    status_id: resolveOrderStatusId(order, statuses),
    priority: order.priority,
    service_id: order.service_id,
    entry_channel_id: order.entry_channel_id,
    assigned_team_member_id: order.assigned_team_member_id,
    order_context_id: order.order_context_id,
    due_at: order.due_at,
    file_status_id: order.file_status_id,
    quote_status_id: order.quote_status_id,
    payment_status_id: order.payment_status_id,
    delivery_method_id: order.delivery_method_id,
    customer_notification_status: order.customer_notification_status,
  };
}

function normalizeText(value: string) {
  return value.trim();
}

function nullableText(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export type DraftSaveStep =
  | { kind: "status"; status_id: string; label: string }
  | {
      kind: "content";
      field: ContentField;
      value: string | null;
      label: string;
    }
  | { kind: "detail"; field: DetailField; value: string | null; label: string }
  | {
      kind: "management";
      field: ManagementField;
      value_id: string | null;
      label: string;
    }
  | {
      kind: "notification";
      notification_status: string;
      label: string;
    };

export function buildDraftSaveSteps(
  order: Order,
  draft: OrderDraft,
  statuses: OrderStatus[]
): DraftSaveStep[] {
  const steps: DraftSaveStep[] = [];
  const baselineStatusId = resolveOrderStatusId(order, statuses);

  if (draft.status_id && draft.status_id !== baselineStatusId) {
    steps.push({
      kind: "status",
      status_id: draft.status_id,
      label: "Estado",
    });
  }

  if (normalizeText(draft.title) !== normalizeText(order.title)) {
    steps.push({
      kind: "content",
      field: "title",
      value: normalizeText(draft.title),
      label: "Título",
    });
  }

  if (
    nullableText(draft.description) !==
    nullableText(order.description ?? "")
  ) {
    steps.push({
      kind: "content",
      field: "description",
      value: nullableText(draft.description),
      label: "Descripción",
    });
  }

  if (nullableText(draft.notes) !== nullableText(order.notes ?? "")) {
    steps.push({
      kind: "content",
      field: "notes",
      value: nullableText(draft.notes),
      label: "Notas",
    });
  }

  if (draft.priority !== order.priority) {
    steps.push({
      kind: "detail",
      field: "priority",
      value: draft.priority,
      label: "Prioridad",
    });
  }

  const detailPairs: Array<{
    field: DetailField;
    next: string | null;
    prev: string | null;
    label: string;
  }> = [
    {
      field: "service_id",
      next: draft.service_id,
      prev: order.service_id,
      label: "Servicio",
    },
    {
      field: "entry_channel_id",
      next: draft.entry_channel_id,
      prev: order.entry_channel_id,
      label: "Canal de entrada",
    },
    {
      field: "assigned_team_member_id",
      next: draft.assigned_team_member_id,
      prev: order.assigned_team_member_id,
      label: "Responsable",
    },
    {
      field: "order_context_id",
      next: draft.order_context_id,
      prev: order.order_context_id,
      label: "Contexto",
    },
    {
      field: "due_at",
      next: draft.due_at,
      prev: order.due_at,
      label: "Fecha prevista",
    },
  ];

  for (const pair of detailPairs) {
    if (pair.next !== pair.prev) {
      steps.push({
        kind: "detail",
        field: pair.field,
        value: pair.next,
        label: pair.label,
      });
    }
  }

  const managementPairs: Array<{
    field: ManagementField;
    next: string | null;
    prev: string | null;
    label: string;
  }> = [
    {
      field: "file_status_id",
      next: draft.file_status_id,
      prev: order.file_status_id,
      label: "Archivos",
    },
    {
      field: "quote_status_id",
      next: draft.quote_status_id,
      prev: order.quote_status_id,
      label: "Presupuesto",
    },
    {
      field: "payment_status_id",
      next: draft.payment_status_id,
      prev: order.payment_status_id,
      label: "Pago",
    },
    {
      field: "delivery_method_id",
      next: draft.delivery_method_id,
      prev: order.delivery_method_id,
      label: "Método de entrega",
    },
  ];

  for (const pair of managementPairs) {
    if (pair.next !== pair.prev) {
      steps.push({
        kind: "management",
        field: pair.field,
        value_id: pair.next,
        label: pair.label,
      });
    }
  }

  if (
    draft.customer_notification_status !== order.customer_notification_status
  ) {
    steps.push({
      kind: "notification",
      notification_status: draft.customer_notification_status,
      label: "Aviso al cliente",
    });
  }

  return steps;
}

export function draftHasChanges(
  order: Order,
  draft: OrderDraft,
  statuses: OrderStatus[]
) {
  return buildDraftSaveSteps(order, draft, statuses).length > 0;
}

export function isDraftTitleValid(draft: OrderDraft) {
  return draft.title.trim().length > 0;
}
