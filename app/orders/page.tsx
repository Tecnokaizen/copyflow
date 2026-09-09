"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppNav } from "@/components/app-nav";
import { CreateOrderForm } from "@/components/orders/create-order-form";
import { canWriteOrders } from "@/lib/auth/membership-roles";
import { isUuid } from "@/lib/team/payload";

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
    id: string;
    name: string;
  } | null;

  service: {
    id: string;
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

type ViewMode = "list" | "calendar" | "service";
type ListFilter = "active" | "urgent" | "overdue" | "attention" | "upcoming";

function parseViewMode(raw: string | null): ViewMode | null {
  if (raw === "list" || raw === "calendar" || raw === "service") {
    return raw;
  }

  return null;
}

function parseListFilter(raw: string | null): ListFilter | null {
  if (
    raw === "active" ||
    raw === "urgent" ||
    raw === "overdue" ||
    raw === "attention" ||
    raw === "upcoming"
  ) {
    return raw;
  }

  return null;
}

function parseAssignedTeamMemberId(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const value = raw.trim();
  return isUuid(value) ? value : null;
}

function isOperativeActive(order: Order) {
  return (
    order.status?.is_closed !== true &&
    order.status?.is_cancelled !== true
  );
}

function matchesDashboardFilter(
  order: Order,
  filter: ListFilter | null,
  assignedId: string | null,
  now: Date | null
) {
  if (!isOperativeActive(order)) {
    return false;
  }

  if (assignedId && order.assigned_team_member?.id !== assignedId) {
    return false;
  }

  if (filter === "urgent") {
    return order.priority === "urgent";
  }

  if (filter === "overdue") {
    return Boolean(order.due_at && now && new Date(order.due_at) < now);
  }

  if (filter === "attention") {
    return order.status?.is_ready === true;
  }

  if (filter === "upcoming") {
    if (!order.due_at || !now) {
      return false;
    }

    const nextDay = new Date(now);
    nextDay.setHours(0, 0, 0, 0);
    nextDay.setDate(nextDay.getDate() + 1);

    return new Date(order.due_at) >= nextDay;
  }

  return true;
}

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

function priorityClassName(priority: string) {
  if (priority === "urgent") {
    return "rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700";
  }

  if (priority === "high") {
    return "rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700";
  }

  return "rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground";
}

function priorityLabel(priority: string) {
  if (priority === "urgent") return "Urgente";
  if (priority === "high") return "Alta";
  return "Normal";
}

type ServiceColumn = {
  key: string;
  name: string;
  orders: Order[];
};

function groupOrdersByService(orders: Order[]) {
  const columns = new Map<string, ServiceColumn>();
  const withoutService: Order[] = [];

  for (const order of orders) {
    if (!order.service?.id) {
      withoutService.push(order);
      continue;
    }

    const current = columns.get(order.service.id);

    if (current) {
      current.orders.push(order);
      continue;
    }

    columns.set(order.service.id, {
      key: order.service.id,
      name: order.service.name || "Servicio",
      orders: [order],
    });
  }

  const grouped = [...columns.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "es")
  );

  if (withoutService.length > 0) {
    grouped.push({
      key: "none",
      name: "Sin servicio",
      orders: withoutService,
    });
  }

  return grouped;
}

export default function OrdersPage() {
  return (
    <Suspense
      fallback={
        <main className="p-8">
          <p>Cargando pedidos...</p>
        </main>
      }
    >
      <OrdersPageContent />
    </Suspense>
  );
}

function OrdersPageContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const listRef = useRef<HTMLDivElement>(null);
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [data, setData] = useState<OrdersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [canWrite, setCanWrite] = useState(false);
  const [prevPathname, setPrevPathname] = useState(pathname);
  const [page, setPage] = useState(1);
  const urlView = parseViewMode(searchParams.get("view"));
  const listFilter = parseListFilter(searchParams.get("filter"));
  const assignedMemberId = parseAssignedTeamMemberId(
    searchParams.get("assigned_team_member_id")
  );
  const scopeToday = searchParams.get("scope") === "today";
  const hasDashboardListFilter = Boolean(listFilter || assignedMemberId);
  const [view, setView] = useState<ViewMode>(urlView ?? "list");
  const [prevUrlView, setPrevUrlView] = useState(urlView);
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [prevScopeToday, setPrevScopeToday] = useState(scopeToday);
  const [prevNow, setPrevNow] = useState<Date | null>(null);
  const [calendarData, setCalendarData] = useState<OrdersResponse | null>(
    null
  );
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [byServiceData, setByServiceData] = useState<OrdersResponse | null>(
    null
  );
  const [byServiceLoading, setByServiceLoading] = useState(false);
  const [byServiceError, setByServiceError] = useState<string | null>(null);
  const pageSize = 50;

  useEffect(() => {
    async function loadContext() {
      const response = await fetch("/api/context");
      if (response.ok) {
        const context = await response.json();
        setCanWrite(canWriteOrders(context?.membership?.role));
      }
    }
    void loadContext();
  }, []);

  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    if (pathname === "/orders") {
      setShowCreateForm(false);
    }
  }

  if (urlView !== prevUrlView) {
    setPrevUrlView(urlView);
    if (urlView) {
      setView(urlView);
    }
  }

  if (isClient && now === null) {
    const current = new Date();
    setNow(current);
    setWeekStart(startOfWeekMonday(current));
  }

  if (scopeToday !== prevScopeToday || now !== prevNow) {
    setPrevScopeToday(scopeToday);
    setPrevNow(now);
    if (scopeToday && now) {
      setWeekStart(startOfWeekMonday(now));
    }
  }

  useEffect(() => {
    async function loadOrders() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          hasDashboardListFilter
            ? "/api/orders?active=true"
            : `/api/orders?page=${page}&page_size=${pageSize}`
        );

        if (!response.ok) {
          throw new Error("No se pudieron cargar los pedidos");
        }

        const result = (await response.json()) as OrdersResponse;
        setData(result);

        if (hasDashboardListFilter) {
          return;
        }

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
  }, [page, hasDashboardListFilter]);

  useEffect(() => {
    if (view !== "calendar" || !weekStart) {
      return;
    }

    const rangeStart = weekStart;

    async function loadWeek() {
      setCalendarLoading(true);
      setCalendarError(null);

      const from = rangeStart.toISOString();
      const to = addDays(rangeStart, 7).toISOString();

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
    if (view !== "service") {
      return;
    }

    async function loadByService() {
      setByServiceLoading(true);
      setByServiceError(null);

      try {
        const response = await fetch("/api/orders?active=true");

        if (!response.ok) {
          throw new Error("No se pudieron cargar los pedidos");
        }

        const result = (await response.json()) as OrdersResponse;
        setByServiceData(result);
      } catch (err) {
        setByServiceData(null);
        setByServiceError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los pedidos"
        );
      } finally {
        setByServiceLoading(false);
      }
    }

    loadByService();
  }, [view]);

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
    data?.orders.filter((order) =>
      hasDashboardListFilter
        ? matchesDashboardFilter(
            order,
            listFilter,
            assignedMemberId,
            now
          )
        : isOperativeActive(order)
    ) ?? [];

  const totalPages = data
    ? Math.max(1, Math.ceil(data.total / data.page_size))
    : 1;

  const weekDays = weekStart
    ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
    : [];
  const todayKey = now ? dayKey(now) : null;
  const weekEnd = weekStart ? addDays(weekStart, 6) : null;
  const weekLabel =
    weekStart && weekEnd
      ? `${weekStart.toLocaleDateString("es-ES", {
          day: "numeric",
          month: "short",
        })} – ${weekEnd.toLocaleDateString("es-ES", {
          day: "numeric",
          month: "short",
          year: "numeric",
        })}`
      : "";
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

  const serviceColumns = groupOrdersByService(byServiceData?.orders ?? []);

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl">
        <AppNav />

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Pedidos</h1>

            <p className="mt-2 text-sm text-muted-foreground">
              {view === "list" ? (
                hasDashboardListFilter ? (
                  <>{activeOrders.length} pedidos</>
                ) : (
                  <>
                    {activeOrders.length} pedidos activos en esta página ·{" "}
                    {data?.total ?? 0} pedidos totales
                  </>
                )
              ) : view === "calendar" ? (
                <>Semana del {weekLabel}</>
              ) : (
                <>
                  {byServiceData?.total ?? 0} pedidos activos · agrupados por
                  servicio
                </>
              )}
            </p>
          </div>

          {canWrite ? (
            <Button
              type="button"
              onClick={() => setShowCreateForm(true)}
              disabled={showCreateForm}
            >
              Nuevo pedido
            </Button>
          ) : null}
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
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
          <button
            type="button"
            onClick={() => setView("service")}
            className={
              view === "service"
                ? "rounded-md border bg-foreground px-3 py-2 text-sm text-background"
                : "rounded-md border bg-background px-3 py-2 text-sm"
            }
          >
            Por Servicio
          </button>
        </div>

        {canWrite && showCreateForm && (
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
                          now &&
                          order.due_at &&
                          new Date(order.due_at) < now &&
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

        {(data?.total ?? 0) > 0 && !hasDashboardListFilter && (
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
                  onClick={() => {
                    if (!weekStart) return;
                    setWeekStart(addDays(weekStart, -7));
                  }}
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
                  onClick={() => {
                    if (!weekStart) return;
                    setWeekStart(addDays(weekStart, 7));
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  Semana siguiente
                </button>
              </div>
            </div>

            {calendarError && (
              <p className="text-sm text-red-600">{calendarError}</p>
            )}

            {calendarLoading || !weekStart ? (
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

        {view === "service" && (
          <div className="grid gap-4">
            {byServiceError && (
              <p className="text-sm text-red-600">{byServiceError}</p>
            )}

            {byServiceLoading ? (
              <p className="text-sm text-muted-foreground">
                Cargando pedidos por servicio...
              </p>
            ) : serviceColumns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay pedidos activos
              </p>
            ) : (
              <div className="overflow-x-auto">
                <div className="flex min-w-full gap-2">
                  {serviceColumns.map((column) => (
                    <section
                      key={column.key}
                      className="w-[240px] shrink-0 rounded-lg border bg-card p-3"
                    >
                      <h2 className="mb-3 text-sm font-medium">
                        {column.name}{" "}
                        <span className="text-muted-foreground">
                          ({column.orders.length})
                        </span>
                      </h2>
                      <div className="grid gap-2">
                        {column.orders.map((order) => (
                          <Link
                            key={order.id}
                            href={`/orders/${order.id}`}
                            className="block rounded-md border bg-background p-2 text-xs hover:bg-muted/40"
                          >
                            <div className="text-muted-foreground">
                              {order.reference}
                            </div>
                            <div className="mt-1 font-medium">{order.title}</div>
                            <div className="mt-2">
                              <span className={priorityClassName(order.priority)}>
                                {priorityLabel(order.priority)}
                              </span>
                            </div>
                            <div className="mt-2">
                              <span className={statusClassName(order.status)}>
                                {order.status?.name ?? "—"}
                              </span>
                            </div>
                            <div className="mt-2 text-muted-foreground">
                              {formatDate(order.due_at)}
                            </div>
                            <div className="mt-1 text-muted-foreground">
                              {order.assigned_team_member?.name ?? "Sin asignar"}
                            </div>
                          </Link>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}