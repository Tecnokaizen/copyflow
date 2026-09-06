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
  loadActivity();
}, [params.id]);

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

          <h1 className="mt-1 text-3xl font-bold">{order.title}</h1>

          {order.description && (
            <p className="mt-2 text-muted-foreground">{order.description}</p>
          )}
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
            <DetailRow
              label="Prioridad"
              value={formatPriority(order.priority)}
            />
            <DetailRow label="Servicio" value={order.service?.name} />
            <DetailRow label="Canal de entrada" value={order.entry_channel?.name} />
            <DetailRow label="Responsable" value={order.assigned_team_member?.name} />
            <DetailRow label="Contexto" value={order.order_context?.name} />
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

            <DetailRow
              label="Entrega prevista"
              value={formatDate(order.due_at)}
            />

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

        {order.notes && (
          <section className="mt-6 rounded-lg border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Notas</h2>
            <p className="text-sm">{order.notes}</p>
          </section>
        )}

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
    