"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { MyOrdersQueue } from "@/components/orders/my-orders-queue";
import {
  canManageTenantAccess,
  canWriteTeam,
} from "@/lib/auth/membership-roles";
import type { MineQueueSection } from "@/lib/orders/mine";
import {
  MINE_ORDERS_PAGE_DESCRIPTION,
  unlinkedMineOrdersCopy,
} from "@/lib/orders/mine-unlinked-copy";
import { isAbortError, nextLoadSignal } from "@/lib/refresh/abort";
import { fetchLive, type SilentLoadOptions } from "@/lib/refresh/fetch-live";
import { useLiveRefresh } from "@/lib/refresh/use-live-refresh";

type MineResponse = {
  linked: boolean;
  timezone?: string;
  today?: string;
  sections?: MineQueueSection[];
  error?: string;
};

function MyOrdersContent() {
  const [data, setData] = useState<MineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [actorRole, setActorRole] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const loadOrders = useCallback(async (opts?: SilentLoadOptions) => {
    const silent = opts?.silent === true;
    const { controller, signal } = nextLoadSignal(abortRef.current, opts?.signal);
    abortRef.current = controller;

    try {
      const response = await fetchLive("/api/orders/mine", { signal });
      const payload = (await response.json().catch(() => null)) as
        | MineResponse
        | null;

      if (!response.ok) {
        throw new Error(
          payload?.error === "Unauthorized or tenant access denied"
            ? "No tienes acceso a esta organización."
            : "No se pudieron cargar tus pedidos."
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
          : "No se pudieron cargar tus pedidos."
      );
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOrders();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadOrders, reloadToken]);

  useEffect(() => {
    async function loadContext() {
      try {
        const response = await fetch("/api/context");
        if (!response.ok) {
          return;
        }
        const context = (await response.json()) as {
          membership?: { role?: unknown };
        };
        setActorRole(
          typeof context.membership?.role === "string"
            ? context.membership.role
            : null
        );
      } catch {
        setActorRole(null);
      }
    }

    void loadContext();
  }, []);

  useLiveRefresh({
    onRefresh: (signal) => loadOrders({ silent: true, signal }),
  });

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Mis pedidos"
        description={MINE_ORDERS_PAGE_DESCRIPTION}
        className="mb-5 sm:mb-6"
      />
      {loading && !data ? (
        <LoadingState label="Cargando tus pedidos…" />
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
        <MyOrdersQueue
          linked={data?.linked === true}
          sections={data?.sections ?? []}
          today={data?.today ?? ""}
          timezone={data?.timezone ?? "Europe/Madrid"}
          unlinkedCopy={unlinkedMineOrdersCopy({
            canWriteTeam: canWriteTeam(actorRole),
            canManageTenantAccess: canManageTenantAccess(actorRole),
          })}
        />
      )}
    </AppShell>
  );
}

export default function MyOrdersPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <AppNav />
          <LoadingState label="Cargando tus pedidos…" />
        </AppShell>
      }
    >
      <MyOrdersContent />
    </Suspense>
  );
}
