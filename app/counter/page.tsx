"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { CounterBoard } from "@/components/orders/counter-board";
import type { CounterBucket } from "@/lib/orders/counter";
import { isAbortError, nextLoadSignal } from "@/lib/refresh/abort";
import { fetchLive, type SilentLoadOptions } from "@/lib/refresh/fetch-live";
import { useLiveRefresh } from "@/lib/refresh/use-live-refresh";

type CounterResponse = {
  timezone?: string;
  today?: string;
  can_write?: boolean;
  buckets?: CounterBucket[];
  error?: string;
};

function CounterContent() {
  const [data, setData] = useState<CounterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

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
    [debouncedQuery]
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

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Mostrador"
        description="Entregas, avisos y urgencias de la tienda. Abre el pedido para trabajarlo."
        className="mb-5 sm:mb-6"
        actions={
          canWrite ? (
            <Link
              href="/orders/quick?from=counter"
              className="gc-cta min-h-11 w-full sm:w-auto"
            >
              Pedido rápido
            </Link>
          ) : null
        }
      />

      <label className="mb-6 grid gap-2 text-sm font-medium text-foreground">
        Buscar
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Referencia, título o cliente"
          className="min-h-12 w-full rounded-md border border-border bg-background px-3 py-2 text-base"
        />
      </label>

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
