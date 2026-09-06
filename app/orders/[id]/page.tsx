"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Order = {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  priority: string;
  due_at: string | null;
  received_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  customer_notification_status: string;
  notes: string | null;

  client: {
    name: string;
    company_name: string | null;
    contact_name: string | null;
    email: string | null;
    phone: string | null;
  } | null;

  service: {
    name: string;
  } | null;

  service_id: string | null;
  entry_channel_id: string | null;
  assigned_team_member_id: string | null;
  order_context_id: string | null;

  entry_channel: {
    name: string;
  } | null;

  assigned_team_member: {
    name: string;
  } | null;

  status: {
    name: string;
    code: string;
  } | null;

  order_context: {
    name: string;
  } | null;

  file_status_id: string | null;
  quote_status_id: string | null;
  payment_status_id: string | null;
  delivery_method_id: string | null;

  file_status: {
    id: string;
    code: string;
    name: string;
  } | null;

  quote_status: {
    id: string;
    code: string;
    name: string;
  } | null;

  payment_status: {
    id: string;
    code: string;
    name: string;
  } | null;

  delivery_method: {
    id: string;
    code: string;
    name: string;
  } | null;
};
type OrderStatus = {
  id: string;
  code: string;
  name: string;
};

type OrderResponse = {
  tenant: string;
  order: Order;
};

type ActivityItem = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  user_id: string | null;
  team_member_id: string | null;
  previous_values: {
    status_id?: string | null;
    status_code?: string | null;
    status_name?: string | null;
    customer_notification_status?: string | null;
    customer_notified_at?: string | null;
    customer_notified_by?: string | null;
    option_id?: string | null;
    option_code?: string | null;
    option_name?: string | null;
    value?: string | null;
    value_id?: string | null;
    value_code?: string | null;
    value_name?: string | null;
  } | null;
  new_values: {
    status_id?: string | null;
    status_code?: string | null;
    status_name?: string | null;
    customer_notification_status?: string | null;
    customer_notified_at?: string | null;
    customer_notified_by?: string | null;
    option_id?: string | null;
    option_code?: string | null;
    option_name?: string | null;
    value?: string | null;
    value_id?: string | null;
    value_code?: string | null;
    value_name?: string | null;
  } | null;
  metadata: {
    reference?: string;
    field?: string;
    [key: string]: unknown;
  };
  created_at: string;
  actor: {
    id: string;
    name: string;
  } | null;
};

type ManagementOption = {
  id: string;
  code: string;
  name: string;
};

type ManagementOptionsResponse = {
  tenant: string;
  file_statuses: ManagementOption[];
  quote_statuses: ManagementOption[];
  payment_statuses: ManagementOption[];
  delivery_methods: ManagementOption[];
};

type ManagementField =
  | "file_status_id"
  | "quote_status_id"
  | "payment_status_id"
  | "delivery_method_id";

type DetailField =
  | "priority"
  | "service_id"
  | "entry_channel_id"
  | "assigned_team_member_id"
  | "order_context_id"
  | "due_at";

type ContentField = "title" | "description" | "notes";

type OrderOption = {
  id: string;
  name: string;
};

type CodedOrderOption = {
  id: string;
  code: string;
  name: string;
};

type OrderOptionsResponse = {
  tenant: string;
  services: OrderOption[];
  entry_channels: CodedOrderOption[];
  order_contexts: CodedOrderOption[];
  team_members: OrderOption[];
};

type ActivityResponse = {
  tenant: string;
  order: {
    id: string;
    reference: string;
  };
  count: number;
  activity: ActivityItem[];
};

function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);

  return local.toISOString().slice(0, 16);
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

function formatActivityText(item: ActivityItem) {
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

  return item.action;
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
      return value;
  }
}

function formatCustomerNotificationStatus(value: string) {
  switch (value) {
    case "not_notified":
      return "No avisado";
    case "notified":
      return "Avisado";
    case "notified_no_pickup":
      return "Avisado pero no viene";
    default:
      return value;
  }
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="grid gap-1 border-b py-4 last:border-b-0 md:grid-cols-[220px_1fr]">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

function OrderDetailContent() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingNotification, setUpdatingNotification] = useState(false);
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [managementOptions, setManagementOptions] =
    useState<ManagementOptionsResponse | null>(null);
  const [managementOptionsLoading, setManagementOptionsLoading] =
    useState(true);
  const [updatingManagement, setUpdatingManagement] =
    useState<ManagementField | null>(null);
  const [orderOptions, setOrderOptions] =
    useState<OrderOptionsResponse | null>(null);
  const [orderOptionsLoading, setOrderOptionsLoading] = useState(true);
  const [updatingDetail, setUpdatingDetail] = useState<DetailField | null>(
    null
  );
  const [updatingContent, setUpdatingContent] = useState<ContentField | null>(
    null
  );
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftNotes, setDraftNotes] = useState("");

  async function loadActivity() {
    try {
      const response = await fetch(`/api/orders/${params.id}/activity`);

      if (!response.ok) {
        setActivity([]);
        return;
      }

      const result: ActivityResponse = await response.json();
      setActivity(result.activity ?? []);
    } catch {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }

  useEffect(() => {
  async function loadOrder() {
    try {
      const response = await fetch(`/api/orders/${params.id}`);
      const result: OrderResponse = await response.json();

      if (!response.ok) {
        throw new Error("No se pudo cargar el pedido");
      }

      if (!result.order) {
        throw new Error("Pedido no encontrado");
      }

      setOrder(result.order);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al cargar el pedido"
      );
    } finally {
      setLoading(false);
    }
  }

  loadOrder();
}, [params.id]);

useEffect(() => {
  async function loadStatuses() {
    try {
      const response = await fetch("/api/order-statuses");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudieron cargar los estados"
        );
      }

      setStatuses(result.statuses ?? []);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al cargar los estados"
      );
    }
  }

  loadStatuses();
}, []);

useEffect(() => {
  async function loadManagementOptions() {
    try {
      const response = await fetch("/api/orders/management-options");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudieron cargar las opciones de gestión"
        );
      }

      setManagementOptions(result);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al cargar las opciones de gestión"
      );
    } finally {
      setManagementOptionsLoading(false);
    }
  }

  loadManagementOptions();
}, []);

useEffect(() => {
  async function loadOrderOptions() {
    try {
      const response = await fetch("/api/orders/options");
      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudieron cargar las opciones del pedido"
        );
      }

      setOrderOptions({
        tenant: result.tenant,
        services: result.services ?? [],
        entry_channels: result.entry_channels ?? [],
        order_contexts: result.order_contexts ?? [],
        team_members: result.team_members ?? [],
      });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al cargar las opciones del pedido"
      );
    } finally {
      setOrderOptionsLoading(false);
    }
  }

  loadOrderOptions();
}, []);

useEffect(() => {
  loadActivity();
}, [params.id]);

useEffect(() => {
  setDraftTitle(order?.title ?? "");
  setDraftDescription(order?.description ?? "");
  setDraftNotes(order?.notes ?? "");
}, [order?.title, order?.description, order?.notes]);

  async function updateStatus(statusId: string) {
  if (!order || updatingStatus) return;

  setUpdatingStatus(true);
  setError(null);

  try {
    const response = await fetch(`/api/orders/${order.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status_id: statusId,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error ?? "No se pudo actualizar el estado");
    }

    setOrder((current) =>
      current
        ? {
            ...current,
            status: result.status,
            ready_at: result.order?.ready_at ?? current.ready_at,
            delivered_at: result.order?.delivered_at ?? current.delivered_at,
          }
        : current
    );
    await loadActivity();
  } catch (err) {
    setError(
      err instanceof Error
        ? err.message
        : "Error al actualizar el estado"
    );
  } finally {
    setUpdatingStatus(false);
  }
}

  async function updateNotificationStatus(notificationStatus: string) {
    if (!order || updatingNotification) return;

    setUpdatingNotification(true);
    setError(null);

    try {
      const response = await fetch(`/api/orders/${order.id}/notification`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notification_status: notificationStatus,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudo actualizar el aviso al cliente"
        );
      }

      setOrder((current) =>
        current
          ? {
              ...current,
              customer_notification_status:
                result.order.customer_notification_status,
            }
          : current
      );
      await loadActivity();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al actualizar el aviso al cliente"
      );
    } finally {
      setUpdatingNotification(false);
    }
  }

  async function updateManagement(
    field: ManagementField,
    valueId: string | null
  ) {
    if (!order || updatingManagement !== null) return;

    setUpdatingManagement(field);
    setError(null);

    try {
      const response = await fetch(`/api/orders/${order.id}/management`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          field,
          value_id: valueId,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudo actualizar la gestión del pedido"
        );
      }

      setOrder((current) => {
        if (!current) {
          return current;
        }

        const nextValue = result.value ?? null;

        if (field === "file_status_id") {
          return {
            ...current,
            file_status_id: result.order.file_status_id,
            file_status: nextValue,
          };
        }

        if (field === "quote_status_id") {
          return {
            ...current,
            quote_status_id: result.order.quote_status_id,
            quote_status: nextValue,
          };
        }

        if (field === "payment_status_id") {
          return {
            ...current,
            payment_status_id: result.order.payment_status_id,
            payment_status: nextValue,
          };
        }

        return {
          ...current,
          delivery_method_id: result.order.delivery_method_id,
          delivery_method: nextValue,
        };
      });
      await loadActivity();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al actualizar la gestión del pedido"
      );
    } finally {
      setUpdatingManagement(null);
    }
  }

  async function updateDetail(field: DetailField, value: string | null) {
    if (!order || updatingDetail !== null) return;

    setUpdatingDetail(field);
    setError(null);

    try {
      const response = await fetch(`/api/orders/${order.id}/details`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          field,
          value,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudieron actualizar los datos del pedido"
        );
      }

      setOrder((current) => {
        if (!current) {
          return current;
        }

        const nextValue = result.value ?? null;

        if (field === "priority") {
          return {
            ...current,
            priority: result.order.priority,
          };
        }

        if (field === "service_id") {
          return {
            ...current,
            service_id: result.order.service_id,
            service: nextValue,
          };
        }

        if (field === "entry_channel_id") {
          return {
            ...current,
            entry_channel_id: result.order.entry_channel_id,
            entry_channel: nextValue,
          };
        }

        if (field === "assigned_team_member_id") {
          return {
            ...current,
            assigned_team_member_id: result.order.assigned_team_member_id,
            assigned_team_member: nextValue,
          };
        }

        if (field === "order_context_id") {
          return {
            ...current,
            order_context_id: result.order.order_context_id,
            order_context: nextValue,
          };
        }

        return {
          ...current,
          due_at: result.order.due_at,
        };
      });
      await loadActivity();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al actualizar los datos del pedido"
      );
    } finally {
      setUpdatingDetail(null);
    }
  }

  async function updateContent(field: ContentField, value: string | null) {
    if (!order || updatingContent !== null) return;

    setUpdatingContent(field);
    setError(null);

    try {
      const response = await fetch(`/api/orders/${order.id}/content`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          field,
          value,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudo actualizar el contenido del pedido"
        );
      }

      setOrder((current) => {
        if (!current) {
          return current;
        }

        if (field === "title") {
          return {
            ...current,
            title: result.order.title,
          };
        }

        if (field === "description") {
          return {
            ...current,
            description: result.order.description,
          };
        }

        return {
          ...current,
          notes: result.order.notes,
        };
      });

      if (field === "title") {
        setDraftTitle(result.order.title);
      } else if (field === "description") {
        setDraftDescription(result.order.description ?? "");
      } else {
        setDraftNotes(result.order.notes ?? "");
      }

      await loadActivity();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Error al actualizar el contenido del pedido"
      );
    } finally {
      setUpdatingContent(null);
    }
  }

  if (loading) {
    return (
      <main className="p-8">
        <p>Cargando pedido...</p>
      </main>
    );
  }

  if (error || !order) {
    return (
      <main className="p-8">
        <p className="text-red-600">{error ?? "Pedido no encontrado"}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8">
          <Link
            href="/orders"
            className="mb-4 inline-block text-sm text-muted-foreground hover:underline"
          >
            ← Volver a pedidos
          </Link>
          <div className="text-sm text-muted-foreground">
            {order.reference}
          </div>

          <input
            type="text"
            value={draftTitle}
            disabled={updatingContent !== null}
            onChange={(event) => {
              setDraftTitle(event.target.value);
            }}
            className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-3xl font-bold"
          />
          <button
            type="button"
            disabled={
              updatingContent !== null ||
              draftTitle.trim() === "" ||
              draftTitle.trim() === order.title
            }
            onClick={() => {
              updateContent("title", draftTitle);
            }}
            className="mt-2 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            Guardar
          </button>

          <textarea
            rows={3}
            value={draftDescription}
            disabled={updatingContent !== null}
            onChange={(event) => {
              setDraftDescription(event.target.value);
            }}
            className="mt-4 w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={
              updatingContent !== null ||
              draftDescription.trim() === (order.description ?? "").trim()
            }
            onClick={() => {
              updateContent(
                "description",
                draftDescription.trim() ? draftDescription : null
              );
            }}
            className="mt-2 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            Guardar
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Pedido</h2>

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
  <div className="text-sm font-medium text-muted-foreground">Estado</div>

  <div>
    <select
      value={order.status?.code ?? ""}
      disabled={updatingStatus}
      onChange={(event) => {
        const status = statuses.find(
          (item) => item.code === event.target.value
        );

        if (status) {
          updateStatus(status.id);
        }
      }}
      className="rounded-md border bg-background px-3 py-2 text-sm"
    >
      {statuses.map((status) => (
        <option key={status.id} value={status.code}>
          {status.name}
        </option>
      ))}
    </select>
  </div>
</div>
            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Prioridad
              </div>
              <div>
                <select
                  value={order.priority}
                  disabled={
                    orderOptionsLoading || updatingDetail !== null
                  }
                  onChange={(event) => {
                    updateDetail("priority", event.target.value);
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="normal">Normal</option>
                  <option value="high">Alta</option>
                  <option value="urgent">Urgente</option>
                </select>
              </div>
            </div>

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Servicio
              </div>
              <div>
                <select
                  value={order.service_id ?? ""}
                  disabled={
                    orderOptionsLoading || updatingDetail !== null
                  }
                  onChange={(event) => {
                    updateDetail(
                      "service_id",
                      event.target.value || null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {orderOptions?.services.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Canal de entrada
              </div>
              <div>
                <select
                  value={order.entry_channel_id ?? ""}
                  disabled={
                    orderOptionsLoading || updatingDetail !== null
                  }
                  onChange={(event) => {
                    updateDetail(
                      "entry_channel_id",
                      event.target.value || null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {orderOptions?.entry_channels.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Responsable
              </div>
              <div>
                <select
                  value={order.assigned_team_member_id ?? ""}
                  disabled={
                    orderOptionsLoading || updatingDetail !== null
                  }
                  onChange={(event) => {
                    updateDetail(
                      "assigned_team_member_id",
                      event.target.value || null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {orderOptions?.team_members.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1 py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Contexto
              </div>
              <div>
                <select
                  value={order.order_context_id ?? ""}
                  disabled={
                    orderOptionsLoading || updatingDetail !== null
                  }
                  onChange={(event) => {
                    updateDetail(
                      "order_context_id",
                      event.target.value || null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {orderOptions?.order_contexts.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Cliente</h2>

            <DetailRow label="Cliente" value={order.client?.name} />
            <DetailRow label="Empresa" value={order.client?.company_name} />
            <DetailRow label="Contacto" value={order.client?.contact_name} />
            <DetailRow label="Email" value={order.client?.email} />
            <DetailRow label="Teléfono" value={order.client?.phone} />
          </section>

          <section className="rounded-lg border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Fechas</h2>

            <DetailRow
              label="Recibido"
              value={formatDate(order.received_at)}
            />

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Entrega prevista
              </div>
              <div>
                <input
                  type="datetime-local"
                  value={toDateTimeLocalValue(order.due_at)}
                  disabled={
                    orderOptionsLoading || updatingDetail !== null
                  }
                  onChange={(event) => {
                    const value = event.target.value;
                    updateDetail(
                      "due_at",
                      value ? new Date(value).toISOString() : null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                />
              </div>
            </div>

            <DetailRow
              label="Terminado"
              value={formatDate(order.ready_at)}
            />

            <DetailRow
              label="Entregado"
              value={formatDate(order.delivered_at)}
            />
          </section>

          <section className="rounded-lg border bg-card p-6">
            <h2 className="mb-2 text-lg font-semibold">Gestión</h2>

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Archivos
              </div>
              <div>
                <select
                  value={order.file_status_id ?? ""}
                  disabled={
                    managementOptionsLoading || updatingManagement !== null
                  }
                  onChange={(event) => {
                    updateManagement(
                      "file_status_id",
                      event.target.value || null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {managementOptions?.file_statuses.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Presupuesto
              </div>
              <div>
                <select
                  value={order.quote_status_id ?? ""}
                  disabled={
                    managementOptionsLoading || updatingManagement !== null
                  }
                  onChange={(event) => {
                    updateManagement(
                      "quote_status_id",
                      event.target.value || null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {managementOptions?.quote_statuses.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Pago
              </div>
              <div>
                <select
                  value={order.payment_status_id ?? ""}
                  disabled={
                    managementOptionsLoading || updatingManagement !== null
                  }
                  onChange={(event) => {
                    updateManagement(
                      "payment_status_id",
                      event.target.value || null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {managementOptions?.payment_statuses.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1 border-b py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Entrega
              </div>
              <div>
                <select
                  value={order.delivery_method_id ?? ""}
                  disabled={
                    managementOptionsLoading || updatingManagement !== null
                  }
                  onChange={(event) => {
                    updateManagement(
                      "delivery_method_id",
                      event.target.value || null
                    );
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="">— Sin definir —</option>
                  {managementOptions?.delivery_methods.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-1 py-4 md:grid-cols-[220px_1fr]">
              <div className="text-sm font-medium text-muted-foreground">
                Aviso al cliente
              </div>

              <div>
                <select
                  value={order.customer_notification_status}
                  disabled={updatingNotification}
                  onChange={(event) => {
                    updateNotificationStatus(event.target.value);
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  <option value="not_notified">No avisado</option>
                  <option value="notified">Avisado</option>
                  <option value="notified_no_pickup">
                    Avisado pero no viene
                  </option>
                </select>
              </div>
            </div>
          </section>
        </div>

        <section className="mt-6 rounded-lg border bg-card p-6">
          <h2 className="mb-3 text-lg font-semibold">Notas</h2>
          <textarea
            rows={4}
            value={draftNotes}
            disabled={updatingContent !== null}
            onChange={(event) => {
              setDraftNotes(event.target.value);
            }}
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={
              updatingContent !== null ||
              draftNotes.trim() === (order.notes ?? "").trim()
            }
            onClick={() => {
              updateContent("notes", draftNotes.trim() ? draftNotes : null);
            }}
            className="mt-2 rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
          >
            Guardar
          </button>
        </section>

        <section className="mt-6 rounded-lg border bg-card p-6">
          <h2 className="mb-3 text-lg font-semibold">Historial de actividad</h2>

          {activityLoading ? (
            <p className="text-sm text-muted-foreground">
              Cargando historial...
            </p>
          ) : activity.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no hay actividad registrada.
            </p>
          ) : (
            <ul>
              {activity.map((item) => (
                <li
                  key={item.id}
                  className="border-b py-4 last:border-b-0"
                >
                  <div className="text-sm">{formatActivityText(item)}</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {item.actor?.name ?? "Usuario"} ·{" "}
                    {formatActivityDate(item.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

export default function OrderDetailPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8">
          <p>Cargando pedido...</p>
        </main>
      }
    >
      <OrderDetailContent />
    </Suspense>
  );
}
    