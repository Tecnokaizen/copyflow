"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppNav } from "@/components/app-nav";
import { CreateOrderForm } from "@/components/orders/create-order-form";

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
    is_ready: boolean;
    is_closed: boolean;
    is_cancelled: boolean;
  } | null;
};

type OrdersResponse = {
  tenant: string;
  count: number;
  total: number;
  page: number;
  page_size: number;
  orders: Order[];
};

type ViewMode = "list" | "calendar";

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

function formatTime(value: string) {
  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function startOfWeekMonday(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + offset);
  return start;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dayKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dueAtDayKey(value: string) {
  return dayKey(new Date(value));
}

function statusClassName(status: Order["status"]) {
  if (status?.is_closed) {
    return "rounded-full bg-green-100 px-2 py-1 font-medium text-green-700";
  }

  if (status?.is_ready || status?.code === "ready") {
    return "rounded-full bg-blue-100 px-2 py-1 font-medium text-blue-700";
  }

  if (status?.code === "in_progress") {
    return "rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-700";
  }

  return "rounded-full bg-gray-100 px-2 py-1 font-medium text-gray-700";
}

export default function OrdersPage() {
  const pathname = usePathname();
  const listRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<ViewMode>("list");
  const [weekStart, setWeekStart] = useState(() =>
    startOfWeekMonday(new Date())
  );
  const [calendarData, setCalendarData] = useState<OrdersResponse | null>(
    null
  );
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const pageSize = 50;

  useEffect(() => {
    async function loadOrders() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/orders?page=${page}&page_size=${pageSize}`
        );

        if (!response.ok) {
          throw new Error("No se pudieron cargar los pedidos");
        }

        const result = (await response.json()) as OrdersResponse;
        setData(result);

        const receivedSize = result.page_size || pageSize;
        const receivedTotal = result.total ?? 0;
        const lastPage = Math.max(
          1,
          Math.ceil(receivedTotal / receivedSize) || 1
        );

        if (page > lastPage) {
          setPage(lastPage);
        }

        if (page > 1) {
          listRef.current?.scrollIntoView({ block: "start" });
        }
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
  }, [page]);

  useEffect(() => {
    if (view !== "calendar") {
      return;
    }

    async function loadWeek() {
      setCalendarLoading(true);
      setCalendarError(null);

      const from = weekStart.toISOString();
      const to = addDays(weekStart, 7).toISOString();

      try {
        const response = await fetch(
          `/api/orders?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
        );

        if (!response.ok) {
          throw new Error("No se pudieron cargar los pedidos");
        }

        const result = (await response.json()) as OrdersResponse;
        setCalendarData(result);
      } catch (err) {
        setCalendarData(null);
        setCalendarError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los pedidos"
        );
      } finally {
        setCalendarLoading(false);
      }
    }

    loadWeek();
  }, [view, weekStart]);

  useEffect(() => {
    if (pathname === "/orders") {
      setShowCreateForm(false);
    }
  }, [pathname]);

  if (loading && !data) {
    return (
      <main className="p-8">
        <p>Cargando pedidos...</p>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="p-8">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  const activeOrders =
    data?.orders.filter(
      (order) =>
        order.status?.is_closed !== true &&
        order.status?.is_cancelled !== true
    ) ?? [];

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.page_size))
    : 1;

  const weekDays = Array.from({ length: 7 }, (_, index) =>
    addDays(weekStart, index)
  );
  const todayKey = dayKey(new Date());
  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${weekStart.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  })} – ${weekEnd.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;
  const ordersByDay = new Map<string, Order[]>();

  for (const order of calendarData?.orders ?? []) {
    if (!order.due_at) {
      continue;
    }

    const key = dueAtDayKey(order.due_at);
    const current = ordersByDay.get(key) ?? [];
    current.push(order);
    ordersByDay.set(key, current);
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl">
        <AppNav />

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Pedidos</h1>

            <p className="mt-2 text-sm text-muted-foreground">
              {view === "list" ? (
                <>
                  {activeOrders.length} pedidos activos en esta página ·{" "}
                  {data?.total ?? 0} pedidos totales
                </>
              ) : (
                <>Semana del {weekLabel}</>
              )}
            </p>
          </div>

          <Button
            type="button"
            onClick={() => setShowCreateForm(true)}
            disabled={showCreateForm}
          >
            Nuevo pedido
          </Button>
        </div>

        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setView("list")}
            className={
              view === "list"
                ? "rounded-md border bg-foreground px-3 py-2 text-sm text-background"
                : "rounded-md border bg-background px-3 py-2 text-sm"
            }
          >
            Lista
          </button>
          <button
            type="button"
            onClick={() => setView("calendar")}
            className={
              view === "calendar"
                ? "rounded-md border bg-foreground px-3 py-2 text-sm text-background"
                : "rounded-md border bg-background px-3 py-2 text-sm"
            }
          >
            Calendario
          </button>
        </div>

        {showCreateForm && (
          <CreateOrderForm onCancel={() => setShowCreateForm(false)} />
        )}

        {view === "list" && (
          <>
        <div
          ref={listRef}
          className="overflow-hidden rounded-lg border bg-card"
        >
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
                {loading ? (
                  <tr>
                    <td
                      className="px-4 py-4 text-muted-foreground"
                      colSpan={6}
                    >
                      Cargando pedidos...
                    </td>
                  </tr>
                ) : (
                  activeOrders.map((order) => (
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
                      <span className={statusClassName(order.status)}>
                        {order.status?.name ?? "—"}
                      </span>
                    </td>

                    <td className="px-4 py-4">
                      <div
                        className={
                          order.due_at &&
                          new Date(order.due_at) < new Date() &&
                          order.status?.is_closed !== true &&
                          order.status?.is_cancelled !== true
                            ? "font-medium text-red-600"
                            : ""
                        }
                      >
                        {formatDate(order.due_at)}
                      </div>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {error && (
          <p className="mt-3 text-sm text-red-600">{error}</p>
        )}

        {(data?.total ?? 0) > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">
              Página {page} de {totalPages}
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={loading || page <= 1}
                onClick={() => setPage(page - 1)}
                className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={loading || page >= totalPages}
                onClick={() => setPage(page + 1)}
                className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
              >
                Siguiente
              </button>
            </div>
          </div>
        )}
          </>
        )}

        {view === "calendar" && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setWeekStart(addDays(weekStart, -7))}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  Semana anterior
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(startOfWeekMonday(new Date()))}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => setWeekStart(addDays(weekStart, 7))}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  Semana siguiente
                </button>
              </div>
            </div>

            {calendarError && (
              <p className="text-sm text-red-600">{calendarError}</p>
            )}

            {calendarLoading ? (
              <p className="text-sm text-muted-foreground">
                Cargando calendario...
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="grid min-w-[840px] grid-cols-7 gap-2">
                  {weekDays.map((day) => {
                    const key = dayKey(day);
                    const dayOrders = ordersByDay.get(key) ?? [];
                    const isToday = key === todayKey;

                    return (
                      <section
                        key={key}
                        className={
                          isToday
                            ? "rounded-lg border border-foreground/30 bg-card p-3"
                            : "rounded-lg border bg-card p-3"
                        }
                      >
                        <h2 className="mb-3 text-sm font-medium">
                          {day.toLocaleDateString("es-ES", {
                            weekday: "short",
                            day: "numeric",
                          })}
                        </h2>
                        <div className="grid gap-2">
                          {dayOrders.length === 0 ? (
                            <p className="text-xs text-muted-foreground">—</p>
                          ) : (
                            dayOrders.map((order) => (
                              <Link
                                key={order.id}
                                href={`/orders/${order.id}`}
                                className="block rounded-md border bg-background p-2 text-xs hover:bg-muted/40"
                              >
                                <div className="font-medium">
                                  {formatTime(order.due_at ?? "")}
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {order.reference}
                                </div>
                                <div className="mt-1 font-medium">
                                  {order.title}
                                </div>
                                <div className="mt-1 text-muted-foreground">
                                  {order.client?.name ?? "Sin cliente"}
                                </div>
                                <div className="mt-2">
                                  <span className={statusClassName(order.status)}>
                                    {order.status?.name ?? "—"}
                                  </span>
                                </div>
                              </Link>
                            ))
                          )}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}