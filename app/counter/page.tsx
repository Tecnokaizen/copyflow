"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LayoutGrid, List } from "lucide-react";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { CounterBoard } from "@/components/orders/counter-board";
import { OperationalCreateActions } from "@/components/quotes/operational-create-actions";
import {
  COUNTER_VIEW_STORAGE_KEY,
  hasActiveCounterFilters,
  parseCounterViewMode,
  readStoredCounterView,
  type CounterBucket,
  type CounterViewMode,
} from "@/lib/orders/counter";
import { isAbortError, nextLoadSignal } from "@/lib/refresh/abort";
import { fetchLive, type SilentLoadOptions } from "@/lib/refresh/fetch-live";
import { useLiveRefresh } from "@/lib/refresh/use-live-refresh";
import { cn } from "@/lib/utils";

type NamedOption = { id: string; name: string };

type CounterResponse = {
  timezone?: string;
  today?: string;
  can_write?: boolean;
  count?: number;
  buckets?: CounterBucket[];
  error?: string;
};

type OptionsResponse = {
  stores?: NamedOption[];
  team_members?: NamedOption[];
  services?: NamedOption[];
  current_team_member?: { id: string; name: string } | null;
  error?: string;
};

const emptySubscribe = () => () => {};

function useCounterViewMode(): [
  CounterViewMode,
  (next: CounterViewMode) => void,
] {
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [, bump] = useState(0);
  const view = isClient
    ? readStoredCounterView(window.localStorage)
    : "list";

  function changeView(next: CounterViewMode) {
    window.localStorage.setItem(
      COUNTER_VIEW_STORAGE_KEY,
      parseCounterViewMode(next)
    );
    bump((value) => value + 1);
  }

  return [view, changeView];
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="grid w-full min-w-0 gap-1 text-xs font-medium text-muted-foreground sm:min-w-[9.5rem] sm:flex-1 sm:text-[0.8125rem]">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium text-foreground"
      >
        {children}
      </select>
    </label>
  );
}

function segmentClass(active: boolean) {
  return cn(
    "inline-flex min-h-11 flex-1 items-center justify-center px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:flex-none sm:px-4",
    active
      ? "bg-background text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground"
  );
}

function viewToggleClass(active: boolean) {
  return cn(
    "inline-flex size-11 shrink-0 items-center justify-center rounded-[calc(var(--radius)-2px)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
    active
      ? "bg-background text-foreground shadow-sm"
      : "text-muted-foreground hover:text-foreground"
  );
}

function CounterContent() {
  const [data, setData] = useState<CounterResponse | null>(null);
  const [options, setOptions] = useState<OptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [mine, setMine] = useState(false);
  const [storeId, setStoreId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [priority, setPriority] = useState("");
  const [view, changeView] = useCounterViewMode();
  const [reloadToken, setReloadToken] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    async function loadOptions() {
      try {
        const response = await fetchLive("/api/orders/options");
        const payload = (await response.json().catch(() => null)) as
          | OptionsResponse
          | null;
        if (!cancelled && response.ok && payload) {
          setOptions(payload);
        }
      } catch {
        // Catalogs are optional for the board itself.
      }
    }
    void loadOptions();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadOrders = useCallback(
    async (opts?: SilentLoadOptions) => {
      const silent = opts?.silent === true;
      const { controller, signal } = nextLoadSignal(
        abortRef.current,
        opts?.signal
      );
      abortRef.current = controller;

      const params = new URLSearchParams();
      if (debouncedQuery) {
        params.set("q", debouncedQuery);
      }
      if (mine) {
        params.set("mine", "1");
      }
      if (storeId) {
        params.set("store_id", storeId);
      }
      if (assigneeId) {
        params.set("assignee_id", assigneeId);
      }
      if (serviceId) {
        params.set("service_id", serviceId);
      }
      if (priority) {
        params.set("priority", priority);
      }
      const path = params.toString()
        ? `/api/orders/counter?${params.toString()}`
        : "/api/orders/counter";

      try {
        const response = await fetchLive(path, { signal });
        const payload = (await response.json().catch(() => null)) as
          | CounterResponse
          | null;

        if (!response.ok) {
          throw new Error(
            payload?.error === "Unauthorized or tenant access denied"
              ? "No tienes acceso a esta organización."
              : "No se pudieron cargar los pedidos del mostrador."
          );
        }

        setData(payload);
        setError(null);
        setLoading(false);
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        if (silent) {
          return;
        }
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los pedidos del mostrador."
        );
        setLoading(false);
      }
    },
    [assigneeId, debouncedQuery, mine, priority, serviceId, storeId]
  );

  useEffect(() => {
    void loadOrders();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadOrders, reloadToken]);

  useLiveRefresh({
    onRefresh: (signal) => loadOrders({ silent: true, signal }),
  });

  const canWrite = data?.can_write === true;
  const filtersActive = hasActiveCounterFilters({
    mine,
    storeId: storeId || null,
    assigneeId: assigneeId || null,
    serviceId: serviceId || null,
    priority: priority || null,
  });

  function clearFilters() {
    setMine(false);
    setStoreId("");
    setAssigneeId("");
    setServiceId("");
    setPriority("");
  }

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Mostrador"
        description="Entregas, avisos y urgencias de la tienda. Abre el pedido para trabajarlo."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
            <OperationalCreateActions />
            {canWrite ? (
              <Link
                href="/orders/quick?from=counter"
                className="gc-cta min-h-11 w-full sm:w-auto"
              >
                Pedido rápido
              </Link>
            ) : null}
          </div>
        }
      />

      <div className="gc-filter-bar mb-6">
        <div className="flex flex-col gap-3">
          <label className="grid gap-1 text-sm font-medium text-foreground">
            Buscar
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Referencia, título o cliente"
              className="min-h-11 w-full rounded-md border border-border bg-background px-3 py-2 text-base"
            />
          </label>

          <div
            className="flex w-full overflow-hidden rounded-md border border-border bg-muted/40 p-0.5 sm:w-auto"
            role="group"
            aria-label="Ámbito de pedidos"
          >
            <button
              type="button"
              onClick={() => setMine(false)}
              aria-pressed={!mine}
              className={segmentClass(!mine)}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setMine(true)}
              aria-pressed={mine}
              className={segmentClass(mine)}
            >
              Mis pedidos
            </button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="grid grid-cols-1 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:flex-wrap sm:items-end sm:gap-2">
              <FilterSelect
                label="Tienda"
                value={storeId}
                onChange={setStoreId}
              >
                <option value="">Todas</option>
                {(options?.stores ?? []).map((store) => (
                  <option key={store.id} value={store.id}>
                    {store.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Responsable"
                value={assigneeId}
                onChange={setAssigneeId}
              >
                <option value="">Todos</option>
                {(options?.team_members ?? []).map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Servicio"
                value={serviceId}
                onChange={setServiceId}
              >
                <option value="">Todos</option>
                {(options?.services ?? []).map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </FilterSelect>
              <FilterSelect
                label="Prioridad"
                value={priority}
                onChange={setPriority}
              >
                <option value="">Todas</option>
                <option value="normal">Normal</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </FilterSelect>
            </div>

            <div
              className="inline-flex shrink-0 self-start overflow-hidden rounded-md border border-border bg-muted/40 p-0.5 sm:self-end"
              role="group"
              aria-label="Vista del mostrador"
            >
              <button
                type="button"
                onClick={() => changeView("list")}
                aria-label="Vista de lista"
                aria-pressed={view === "list"}
                title="Vista de lista"
                className={viewToggleClass(view === "list")}
              >
                <List className="size-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => changeView("grid")}
                aria-label="Vista de rejilla"
                aria-pressed={view === "grid"}
                title="Vista de rejilla"
                className={viewToggleClass(view === "grid")}
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {filtersActive ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {typeof data?.count === "number"
                ? `${data.count} ${data.count === 1 ? "pedido" : "pedidos"}`
                : "Filtros activos"}
            </p>
            <button
              type="button"
              onClick={clearFilters}
              className="gc-action min-h-10"
            >
              Limpiar filtros
            </button>
          </div>
        ) : null}
      </div>

      {loading && !data ? (
        <LoadingState label="Cargando el mostrador…" />
      ) : error && !data ? (
        <ErrorState
          title={error}
          onRetry={() => {
            setError(null);
            setLoading(true);
            setReloadToken((token) => token + 1);
          }}
        />
      ) : (
        <CounterBoard
          buckets={data?.buckets ?? []}
          today={data?.today ?? ""}
          timezone={data?.timezone ?? "Europe/Madrid"}
          view={view}
          filtersActive={filtersActive}
          filteredCount={data?.count ?? 0}
        />
      )}
    </AppShell>
  );
}

export default function CounterPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <AppNav />
          <LoadingState label="Cargando el mostrador…" />
        </AppShell>
      }
    >
      <CounterContent />
    </Suspense>
  );
}
