"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Order = {
  id: string;
  reference: string;
  title: string;
  priority: string;
  due_at: string | null;

  client: {
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
};

type OrdersResponse = {
  tenant: string;
  count: number;
  orders: Order[];
};

function formatDate(value: string | null) {
  if (!value) return "Sin fecha";

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function OrdersPage() {
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadOrders() {
      try {
        const response = await fetch("/api/orders");

        if (!response.ok) {
          throw new Error("No se pudieron cargar los pedidos");
        }

        const result = await response.json();
        setData(result);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Error desconocido al cargar pedidos"
        );
      } finally {
        setLoading(false);
      }
    }

    loadOrders();
  }, []);

  if (loading) {
    return (
      <main className="p-8">
        <p>Cargando pedidos...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="p-8">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  const activeOrders =
  data?.orders.filter(
    (order) =>
      order.status?.code !== "delivered" &&
      order.status?.code !== "cancelled"
  ) ?? [];

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold">Pedidos</h1>

          <p className="mt-2 text-sm text-muted-foreground">
            {activeOrders.length} pedidos activos
          </p>
        </div>

        <div className="overflow-hidden rounded-lg border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Pedido</th>
                  <th className="px-4 py-3 text-left font-medium">Cliente</th>
                  <th className="px-4 py-3 text-left font-medium">Canal</th>
                  <th className="px-4 py-3 text-left font-medium">
                    Responsable
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Estado</th>
                  <th className="px-4 py-3 text-left font-medium">Entrega</th>
                </tr>
              </thead>

              <tbody>
                  {activeOrders.map((order) => (
                    <tr
                      key={order.id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-4 py-4">
                        <Link
                          href={`/orders/${order.id}`}
                          className="font-medium hover:underline"
                        >
                          {order.title}
                        </Link>

                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{order.reference}</span>

                          <span
                            className={
                              order.priority === "urgent"
                                ? "rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700"
                                : order.priority === "high"
                                  ? "rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700"
                                  : "rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground"
                            }
                          >
                            {order.priority === "urgent"
                              ? "Urgente"
                              : order.priority === "high"
                                ? "Alta"
                                : "Normal"}
                          </span>
                        </div>
                      </td>

                    <td className="px-4 py-4">
                      {order.client?.name ?? "Sin cliente"}
                    </td>

                    <td className="px-4 py-4">
                      {order.entry_channel?.name ?? "—"}
                    </td>

                    <td className="px-4 py-4">
                      {order.assigned_team_member?.name ?? "Sin asignar"}
                    </td>

                    <td className="px-4 py-4">
                      <span
                        className={
                          order.status?.code === "delivered"
                            ? "rounded-full bg-green-100 px-2 py-1 font-medium text-green-700"
                            : order.status?.code === "ready"
                              ? "rounded-full bg-blue-100 px-2 py-1 font-medium text-blue-700"
                              : order.status?.code === "in_progress"
                                ? "rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-700"
                                : "rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700"
                        }
                      >
                        {order.status?.name ?? "—"}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <div
                        className={
                          order.due_at &&
                          new Date(order.due_at) < new Date() &&
                          order.status?.code !== "delivered"
                            ? "font-medium text-red-600"
                            : ""
                        }
                      >
                        {formatDate(order.due_at)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}