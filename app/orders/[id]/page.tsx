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

  file_status: {
    name: string;
  } | null;

  quote_status: {
    name: string;
  } | null;

  payment_status: {
    name: string;
  } | null;

  delivery_method: {
    name: string;
  } | null;
};

type OrdersResponse = {
  orders: Order[];
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

  useEffect(() => {
    async function loadOrder() {
      try {
        const response = await fetch("/api/orders");

        if (!response.ok) {
          throw new Error("No se pudo cargar el pedido");
        }

        const data: OrdersResponse = await response.json();
        const foundOrder = data.orders.find((item) => item.id === params.id);

        if (!foundOrder) {
          throw new Error("Pedido no encontrado");
        }

        setOrder(foundOrder);
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

            <DetailRow label="Estado" value={order.status?.name} />
            <DetailRow label="Prioridad" value={order.priority} />
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

            <DetailRow label="Archivos" value={order.file_status?.name} />
            <DetailRow label="Presupuesto" value={order.quote_status?.name} />
            <DetailRow label="Pago" value={order.payment_status?.name} />
            <DetailRow label="Entrega" value={order.delivery_method?.name} />
            <DetailRow
              label="Aviso al cliente"
              value={formatCustomerNotificationStatus(
                order.customer_notification_status
              )}
            />
          </section>
        </div>

                {order.notes && (
          <section className="mt-6 rounded-lg border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Notas</h2>
            <p className="text-sm">{order.notes}</p>
          </section>
        )}
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
    