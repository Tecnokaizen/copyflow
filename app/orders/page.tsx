"use client";

import { Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppNav } from "@/components/app-nav";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { CreateOrderForm } from "@/components/orders/create-order-form";
import { canWriteOrders } from "@/lib/auth/membership-roles";
import { isUuid } from "@/lib/team/payload";
import {
  addCivilDays,
  formatZonedCivilDate,
  formatZonedDayLabel,
  formatZonedTime,
} from "@/lib/time/zoned-day";

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
  all_total?: number;
  page: number;
  page_size: number;
  orders: Order[];
  timezone?: string;
  week_start?: string;
  week_days?: string[];
  from?: string | null;
  to?: string | null;
};

type CalendarScope = "active" | "all";

type TeamMemberOption = {
  id: string;
  name: string;
};

type OrderStatusOption = {
  id: string;
  name: string;
  is_closed: boolean;
  is_cancelled: boolean;
  sort_order: number;
};

type ViewMode = "list" | "calendar" | "service";
type ListFilter =
  | "active"
  | "urgent"
  | "overdue"
  | "all"
  | "attention"
  | "upcoming";
type PrimaryListFilter = "active" | "urgent" | "overdue" | "all";
type SortField =
  | "reference"
  | "client"
  | "channel"
  | "assignee"
  | "status"
  | "due_at";
type SortDir = "asc" | "desc";

const SORT_FIELDS: SortField[] = [
  "reference",
  "client",
  "channel",
  "assignee",
  "status",
  "due_at",
];

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
    raw === "all" ||
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

function parseStatusId(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  const value = raw.trim();
  return isUuid(value) ? value : null;
}

function parseSortField(raw: string | null): SortField | null {
  if (!raw) {
    return null;
  }

  return SORT_FIELDS.includes(raw as SortField) ? (raw as SortField) : null;
}

function parseSortDir(raw: string | null): SortDir | null {
  if (raw === "asc" || raw === "desc") {
    return raw;
  }

  return null;
}

function parseCalendarScope(raw: string | null): CalendarScope {
  return raw === "all" ? "all" : "active";
}

function resolveListFilter(
  raw: ListFilter | null,
  assignedId: string | null
): ListFilter {
  if (raw) {
    return raw;
  }

  // Dashboard member deep link without filter → activos.
  if (assignedId) {
    return "active";
  }

  return "active";
}

function primaryFilterFrom(filter: ListFilter): PrimaryListFilter | null {
  if (
    filter === "active" ||
    filter === "urgent" ||
    filter === "overdue" ||
    filter === "all"
  ) {
    return filter;
  }

  return null;
}

function isTerminalStatus(status: OrderStatusOption | null | undefined) {
  return Boolean(status?.is_closed || status?.is_cancelled);
}

function emptyTitleForFilter(
  filter: ListFilter,
  hasAssignee: boolean,
  hasStatus: boolean,
  allTotal: number
) {
  if (hasAssignee || hasStatus) {
    return "No hay pedidos con estos filtros";
  }

  if (filter === "urgent") {
    return "No hay pedidos urgentes";
  }

  if (filter === "overdue") {
    return "No hay pedidos retrasados";
  }

  if (filter === "all") {
    return allTotal === 0 ? "No hay pedidos todavía" : "No hay pedidos";
  }

  if (filter === "attention" || filter === "upcoming") {
    return "No hay pedidos con estos filtros";
  }

  return "No hay pedidos activos";
}

function summaryForFilter(
  filter: ListFilter,
  total: number,
  allTotal: number,
  hasAssignee: boolean,
  hasStatus: boolean
) {
  if (hasAssignee || hasStatus) {
    return `${total} pedidos · ${allTotal} pedidos totales`;
  }

  if (filter === "urgent") {
    return `${total} pedidos urgentes · ${allTotal} pedidos totales`;
  }

  if (filter === "overdue") {
    return `${total} pedidos retrasados · ${allTotal} pedidos totales`;
  }

  if (filter === "all") {
    return `${total} pedidos totales`;
  }

  if (filter === "attention" || filter === "upcoming") {
    return `${total} pedidos · ${allTotal} pedidos totales`;
  }

  return `${total} pedidos activos · ${allTotal} pedidos totales`;
}

function sortIndicator(active: boolean, dir: SortDir | null) {
  if (!active || !dir) {
    return "↕";
  }

  return dir === "asc" ? "↑" : "↓";
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
        <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-7xl">
            <AppNav />
            <div className="mb-8">
              <h1 className="text-3xl font-bold">Pedidos</h1>
            </div>
            <LoadingState label="Cargando pedidos..." />
          </div>
        </main>
      }
    >
      <OrdersPageContent />
    </Suspense>
  );
}

function OrdersPageContent() {
  const pathname = usePathname();
  const router = useRouter();
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
  const rawListFilter = parseListFilter(searchParams.get("filter"));
  const assignedMemberId = parseAssignedTeamMemberId(
    searchParams.get("assigned_team_member_id")
  );
  const statusId = parseStatusId(searchParams.get("status_id"));
  const sortField = parseSortField(searchParams.get("sort"));
  const sortDir = parseSortDir(searchParams.get("dir"));
  const listFilter = resolveListFilter(rawListFilter, assignedMemberId);
  const primaryFilter = primaryFilterFrom(listFilter);
  const scopeToday = searchParams.get("scope") === "today";
  const [view, setView] = useState<ViewMode>(urlView ?? "list");
  const [prevUrlView, setPrevUrlView] = useState(urlView);
  const [weekStartCivil, setWeekStartCivil] = useState<string | null>(null);
  const [calendarTimezone, setCalendarTimezone] = useState<string | null>(null);
  const [calendarDays, setCalendarDays] = useState<string[]>([]);
  const [now, setNow] = useState<Date | null>(null);
  const [prevScopeToday, setPrevScopeToday] = useState(scopeToday);
  const [prevNow, setPrevNow] = useState<Date | null>(null);
  const calendarScope = parseCalendarScope(searchParams.get("calendar_scope"));
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
  const [listReloadToken, setListReloadToken] = useState(0);
  const [calendarReloadToken, setCalendarReloadToken] = useState(0);
  const [byServiceReloadToken, setByServiceReloadToken] = useState(0);
  const [teamMembers, setTeamMembers] = useState<TeamMemberOption[]>([]);
  const [orderStatuses, setOrderStatuses] = useState<OrderStatusOption[]>([]);
  const [prevListQuery, setPrevListQuery] = useState(
    `${listFilter}|${assignedMemberId ?? ""}|${statusId ?? ""}|${sortField ?? ""}|${sortDir ?? ""}`
  );
  const pageSize = 50;
  const listQueryKey = `${listFilter}|${assignedMemberId ?? ""}|${statusId ?? ""}|${sortField ?? ""}|${sortDir ?? ""}`;
  const selectedStatus =
    orderStatuses.find((status) => status.id === statusId) ?? null;

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

  useEffect(() => {
    async function loadTeam() {
      try {
        const response = await fetch("/api/team?active=true");
        if (!response.ok) {
          return;
        }

        const result = (await response.json()) as {
          members?: Array<{ id?: unknown; name?: unknown }>;
        };

        const members = (result.members ?? [])
          .map((row) => {
            const id = typeof row.id === "string" ? row.id : null;
            const name = typeof row.name === "string" ? row.name : null;
            if (!id || !name) {
              return null;
            }
            return { id, name };
          })
          .filter((row): row is TeamMemberOption => row !== null);

        setTeamMembers(members);
      } catch {
        setTeamMembers([]);
      }
    }

    async function loadStatuses() {
      try {
        const response = await fetch("/api/order-statuses");
        if (!response.ok) {
          return;
        }

        const result = (await response.json()) as {
          statuses?: Array<Record<string, unknown>>;
        };

        const statuses = (result.statuses ?? [])
          .map((row) => {
            const id = typeof row.id === "string" ? row.id : null;
            const name = typeof row.name === "string" ? row.name : null;
            if (!id || !name) {
              return null;
            }

            return {
              id,
              name,
              is_closed: row.is_closed === true,
              is_cancelled: row.is_cancelled === true,
              sort_order:
                typeof row.sort_order === "number" ? row.sort_order : 0,
            };
          })
          .filter((row): row is OrderStatusOption => row !== null);

        setOrderStatuses(statuses);
      } catch {
        setOrderStatuses([]);
      }
    }

    void loadTeam();
    void loadStatuses();
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

  if (listQueryKey !== prevListQuery) {
    setPrevListQuery(listQueryKey);
    setPage(1);
  }

  // Closed/cancelled status is incompatible with operative scopes.
  useEffect(() => {
    if (!selectedStatus || !isTerminalStatus(selectedStatus)) {
      return;
    }

    if (
      listFilter === "active" ||
      listFilter === "urgent" ||
      listFilter === "overdue"
    ) {
      replaceListParams({
        filter: "all",
        statusId,
      });
    }
    // replaceListParams is stable enough for this sync; intentionally omit it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStatus, listFilter, statusId]);

  if (isClient && now === null) {
    setNow(new Date());
  }

  if (scopeToday !== prevScopeToday || now !== prevNow) {
    setPrevScopeToday(scopeToday);
    setPrevNow(now);
    if (scopeToday && now && view === "calendar") {
      setWeekStartCivil(null);
      setCalendarReloadToken((token) => token + 1);
    }
  }

  function replaceListParams(next: {
    filter?: PrimaryListFilter | ListFilter;
    assignedTeamMemberId?: string | null;
    statusId?: string | null;
    sort?: SortField | null;
    dir?: SortDir | null;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "list");

    if (next.filter) {
      params.set("filter", next.filter);
    }

    if (next.assignedTeamMemberId === null) {
      params.delete("assigned_team_member_id");
    } else if (typeof next.assignedTeamMemberId === "string") {
      params.set("assigned_team_member_id", next.assignedTeamMemberId);
    }

    if (next.statusId === null) {
      params.delete("status_id");
    } else if (typeof next.statusId === "string") {
      params.set("status_id", next.statusId);
    }

    if (next.sort === null) {
      params.delete("sort");
      params.delete("dir");
    } else if (typeof next.sort === "string") {
      params.set("sort", next.sort);
      params.set("dir", next.dir === "desc" ? "desc" : "asc");
    }

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
    setPage(1);
  }

  function applyPrimaryFilter(nextFilter: PrimaryListFilter) {
    const clearTerminalStatus =
      nextFilter !== "all" && isTerminalStatus(selectedStatus);

    replaceListParams({
      filter: nextFilter,
      statusId: clearTerminalStatus ? null : undefined,
    });
  }

  function applyStatusFilter(nextStatusId: string | null) {
    if (!nextStatusId) {
      replaceListParams({
        filter: listFilter,
        statusId: null,
      });
      return;
    }

    const status = orderStatuses.find((row) => row.id === nextStatusId) ?? null;
    const nextFilter = isTerminalStatus(status) ? "all" : listFilter;

    replaceListParams({
      filter: nextFilter,
      statusId: nextStatusId,
    });
  }

  function toggleSort(field: SortField) {
    if (sortField === field) {
      replaceListParams({
        filter: listFilter,
        sort: field,
        dir: sortDir === "asc" ? "desc" : "asc",
      });
      return;
    }

    replaceListParams({
      filter: listFilter,
      sort: field,
      dir: "asc",
    });
  }

  useEffect(() => {
    async function loadOrders() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: String(pageSize),
          filter: listFilter,
        });

        if (assignedMemberId) {
          params.set("assigned_team_member_id", assignedMemberId);
        }

        if (statusId) {
          params.set("status_id", statusId);
        }

        if (sortField && sortDir) {
          params.set("sort", sortField);
          params.set("dir", sortDir);
        }

        const response = await fetch(`/api/orders?${params.toString()}`);

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
      } catch {
        setError("No se pudieron cargar los pedidos");
      } finally {
        setLoading(false);
      }
    }

    loadOrders();
  }, [page, listFilter, assignedMemberId, statusId, sortField, sortDir, listReloadToken]);

  function replaceCalendarParams(next: {
    scope?: CalendarScope;
    assignedTeamMemberId?: string | null;
  }) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "calendar");
    params.set("calendar_scope", next.scope ?? calendarScope);

    if (next.assignedTeamMemberId === null) {
      params.delete("assigned_team_member_id");
    } else if (typeof next.assignedTeamMemberId === "string") {
      params.set("assigned_team_member_id", next.assignedTeamMemberId);
    }

    // Calendar must not consume list-only params.
    params.delete("status_id");
    params.delete("sort");
    params.delete("dir");
    params.delete("filter");

    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  useEffect(() => {
    if (view !== "calendar") {
      return;
    }

    async function loadWeek() {
      setCalendarLoading(true);
      setCalendarError(null);

      try {
        const params = new URLSearchParams({
          week_start: weekStartCivil ?? "current",
          filter: calendarScope,
        });

        if (assignedMemberId) {
          params.set("assigned_team_member_id", assignedMemberId);
        }

        const response = await fetch(`/api/orders?${params.toString()}`);

        if (!response.ok) {
          throw new Error("No se pudieron cargar los pedidos");
        }

        const result = (await response.json()) as OrdersResponse;
        setCalendarData(result);

        if (result.week_start && result.week_start !== weekStartCivil) {
          setWeekStartCivil(result.week_start);
        }
        if (result.timezone) {
          setCalendarTimezone(result.timezone);
        }
        if (Array.isArray(result.week_days) && result.week_days.length === 7) {
          setCalendarDays(result.week_days);
        }
      } catch {
        setCalendarData(null);
        setCalendarError("No se pudieron cargar los pedidos");
      } finally {
        setCalendarLoading(false);
      }
    }

    void loadWeek();
  }, [
    view,
    weekStartCivil,
    calendarScope,
    assignedMemberId,
    calendarReloadToken,
  ]);

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
      } catch {
        setByServiceData(null);
        setByServiceError("No se pudieron cargar los pedidos");
      } finally {
        setByServiceLoading(false);
      }
    }

    loadByService();
  }, [view, byServiceReloadToken]);

  const listOrders = data?.orders ?? [];
  const filteredTotal = data?.total ?? 0;
  const allTotal = data?.all_total ?? filteredTotal;
  const totalPages = data
    ? Math.max(1, Math.ceil(filteredTotal / (data.page_size || pageSize)))
    : 1;
  const showPagination = filteredTotal > (data?.page_size || pageSize);

  const weekDays = calendarDays.length === 7 ? calendarDays : [];
  const todayKey =
    now && calendarTimezone
      ? formatZonedCivilDate(now, calendarTimezone)
      : null;
  const weekLabel =
    weekDays.length === 7 && calendarTimezone
      ? `${formatZonedDayLabel(weekDays[0], calendarTimezone)} – ${formatZonedDayLabel(weekDays[6], calendarTimezone)}`
      : "";
  const ordersByDay = new Map<string, Order[]>();

  for (const order of calendarData?.orders ?? []) {
    if (!order.due_at || !calendarTimezone) {
      continue;
    }

    const key = formatZonedCivilDate(new Date(order.due_at), calendarTimezone);
    const current = ordersByDay.get(key) ?? [];
    current.push(order);
    ordersByDay.set(key, current);
  }

  const serviceColumns = groupOrdersByService(byServiceData?.orders ?? []);
  const calendarOrderCount = calendarData?.orders?.length ?? 0;

  const primaryFilters: Array<{ id: PrimaryListFilter; label: string }> = [
    { id: "active", label: "Activos" },
    { id: "urgent", label: "Urgentes" },
    { id: "overdue", label: "Retrasados" },
    { id: "all", label: "Todos" },
  ];

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <AppNav />

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Pedidos</h1>

            <p className="mt-2 text-sm text-muted-foreground">
              {view === "list" ? (
                <>
                  {summaryForFilter(
                    listFilter,
                    filteredTotal,
                    allTotal,
                    Boolean(assignedMemberId),
                    Boolean(statusId)
                  )}
                </>
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
            onClick={() => {
              setView("calendar");
              replaceCalendarParams({ scope: calendarScope });
            }}
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

        {view === "list" ? (
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {primaryFilters.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => applyPrimaryFilter(item.id)}
                  className={
                    primaryFilter === item.id
                      ? "rounded-md border bg-foreground px-3 py-2 text-sm text-background"
                      : "rounded-md border bg-background px-3 py-2 text-sm"
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <label className="flex flex-col gap-1 text-sm sm:min-w-[200px]">
                <span className="text-muted-foreground">Estado</span>
                <select
                  className="rounded-md border bg-background px-3 py-2"
                  value={statusId ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    applyStatusFilter(value ? value : null);
                  }}
                >
                  <option value="">Todos los estados</option>
                  {orderStatuses.map((status) => (
                    <option key={status.id} value={status.id}>
                      {status.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm sm:min-w-[220px]">
                <span className="text-muted-foreground">Responsable</span>
                <select
                  className="rounded-md border bg-background px-3 py-2"
                  value={assignedMemberId ?? ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    replaceListParams({
                      filter: listFilter,
                      assignedTeamMemberId: value ? value : null,
                    });
                  }}
                >
                  <option value="">Todos los responsables</option>
                  {teamMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        ) : null}

        {canWrite && showCreateForm && (
          <CreateOrderForm onCancel={() => setShowCreateForm(false)} />
        )}

        {view === "list" && (
          <>
            {loading && !data ? (
              <LoadingState label="Cargando pedidos..." />
            ) : error && !data ? (
              <ErrorState
                title="No se pudieron cargar los pedidos"
                onRetry={() => setListReloadToken((token) => token + 1)}
              />
            ) : (
              <>
                {!loading && listOrders.length === 0 ? (
                  <div
                    ref={listRef}
                    className="overflow-hidden rounded-lg border bg-card"
                  >
                    <EmptyState
                      title={emptyTitleForFilter(
                        listFilter,
                        Boolean(assignedMemberId),
                        Boolean(statusId),
                        allTotal
                      )}
                      description={
                        assignedMemberId ||
                        statusId ||
                        listFilter === "attention" ||
                        listFilter === "upcoming"
                          ? "Prueba a cambiar los filtros."
                          : undefined
                      }
                    />
                  </div>
                ) : (
                  <div
                    ref={listRef}
                    className="overflow-hidden rounded-lg border bg-card"
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-b bg-muted/50">
                          <tr>
                            {(
                              [
                                ["reference", "Pedido"],
                                ["client", "Cliente"],
                                ["channel", "Canal"],
                                ["assignee", "Responsable"],
                                ["status", "Estado"],
                                ["due_at", "Entrega"],
                              ] as const
                            ).map(([field, label]) => {
                              const active = sortField === field;
                              return (
                                <th
                                  key={field}
                                  className="px-4 py-3 text-left font-medium"
                                >
                                  <button
                                    type="button"
                                    onClick={() => toggleSort(field)}
                                    className="inline-flex items-center gap-1 hover:underline"
                                  >
                                    <span>{label}</span>
                                    <span
                                      className="text-xs text-muted-foreground"
                                      aria-hidden
                                    >
                                      {sortIndicator(active, sortDir)}
                                    </span>
                                  </button>
                                </th>
                              );
                            })}
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
                            listOrders.map((order) => (
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
                                  {order.assigned_team_member?.name ??
                                    "Sin asignar"}
                                </td>

                                <td className="px-4 py-4">
                                  <span
                                    className={statusClassName(order.status)}
                                  >
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
                )}

                {error ? (
                  <ErrorState
                    className="mt-3"
                    title="No se pudieron cargar los pedidos"
                    onRetry={() => setListReloadToken((token) => token + 1)}
                  />
                ) : null}

                {showPagination ? (
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
                ) : null}
              </>
            )}
          </>
        )}

        {view === "calendar" && (
          <div className="grid gap-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!weekStartCivil) return;
                    const prev = addCivilDays(weekStartCivil, -7);
                    if (prev) setWeekStartCivil(prev);
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  Semana anterior
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWeekStartCivil(null);
                    setCalendarReloadToken((token) => token + 1);
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  Hoy
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!weekStartCivil) return;
                    const next = addCivilDays(weekStartCivil, 7);
                    if (next) setWeekStartCivil(next);
                  }}
                  className="rounded-md border bg-background px-3 py-2 text-sm"
                >
                  Semana siguiente
                </button>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => replaceCalendarParams({ scope: "active" })}
                    className={
                      calendarScope === "active"
                        ? "rounded-md border bg-foreground px-3 py-2 text-sm text-background"
                        : "rounded-md border bg-background px-3 py-2 text-sm"
                    }
                  >
                    Activos
                  </button>
                  <button
                    type="button"
                    onClick={() => replaceCalendarParams({ scope: "all" })}
                    className={
                      calendarScope === "all"
                        ? "rounded-md border bg-foreground px-3 py-2 text-sm text-background"
                        : "rounded-md border bg-background px-3 py-2 text-sm"
                    }
                  >
                    Todos
                  </button>
                </div>

                <label className="flex flex-col gap-1 text-sm sm:min-w-[220px]">
                  <span className="text-muted-foreground">Responsable</span>
                  <select
                    className="rounded-md border bg-background px-3 py-2"
                    value={assignedMemberId ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      replaceCalendarParams({
                        scope: calendarScope,
                        assignedTeamMemberId: value ? value : null,
                      });
                    }}
                  >
                    <option value="">Todos los responsables</option>
                    {teamMembers.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {calendarLoading || weekDays.length !== 7 || !calendarTimezone ? (
              <LoadingState label="Cargando calendario..." />
            ) : calendarError ? (
              <ErrorState
                title="No se pudieron cargar los pedidos"
                onRetry={() => setCalendarReloadToken((token) => token + 1)}
              />
            ) : calendarOrderCount === 0 ? (
              <div className="overflow-hidden rounded-lg border bg-card">
                <EmptyState title="No hay entregas esta semana" />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="grid min-w-[840px] grid-cols-7 gap-2">
                  {weekDays.map((day) => {
                    const dayOrders = ordersByDay.get(day) ?? [];
                    const isToday = day === todayKey;

                    return (
                      <section
                        key={day}
                        className={
                          isToday
                            ? "rounded-lg border border-foreground/30 bg-card p-3"
                            : "rounded-lg border bg-card p-3"
                        }
                      >
                        <h2 className="mb-3 text-sm font-medium">
                          {formatZonedDayLabel(day, calendarTimezone)} ·{" "}
                          {dayOrders.length}
                        </h2>
                        <div className="grid gap-2">
                          {dayOrders.length === 0 ? (
                            <p className="text-xs text-muted-foreground">
                              Sin entregas
                            </p>
                          ) : (
                            dayOrders.map((order) => (
                              <Link
                                key={order.id}
                                href={`/orders/${order.id}`}
                                className="block rounded-md border bg-background p-2 text-xs hover:bg-muted/40"
                              >
                                <div className="font-medium">
                                  {formatZonedTime(
                                    new Date(order.due_at ?? ""),
                                    calendarTimezone
                                  )}
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
                                <div className="mt-1 text-muted-foreground">
                                  {order.assigned_team_member?.name ??
                                    "Sin asignar"}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1">
                                  {order.priority === "urgent" ||
                                  order.priority === "high" ? (
                                    <span
                                      className={priorityClassName(
                                        order.priority
                                      )}
                                    >
                                      {priorityLabel(order.priority)}
                                    </span>
                                  ) : null}
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
            {byServiceLoading ? (
              <LoadingState label="Cargando pedidos por servicio..." />
            ) : byServiceError ? (
              <ErrorState
                title="No se pudieron cargar los pedidos"
                onRetry={() => setByServiceReloadToken((token) => token + 1)}
              />
            ) : serviceColumns.length === 0 ? (
              <div className="overflow-hidden rounded-lg border bg-card">
                <EmptyState title="No hay pedidos activos" />
              </div>
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