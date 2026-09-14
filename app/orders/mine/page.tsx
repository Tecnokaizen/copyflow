"use client";

import { Suspense, useEffect, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { MyOrdersQueue } from "@/components/orders/my-orders-queue";
import type { MineQueueSection } from "@/lib/orders/mine";

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

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/orders/mine");
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
      } catch (err) {
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar tus pedidos."
        );
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [reloadToken]);

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Mis pedidos"
        description="Cola de trabajo asignada a tu perfil de equipo."
        className="mb-5 sm:mb-6"
      />
      {loading ? (
        <LoadingState label="Cargando tus pedidos…" />
      ) : error ? (
        <ErrorState
          title={error}
          onRetry={() => setReloadToken((token) => token + 1)}
        />
      ) : (
        <MyOrdersQueue
          linked={data?.linked === true}
          sections={data?.sections ?? []}
          today={data?.today ?? ""}
          timezone={data?.timezone ?? "Europe/Madrid"}
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
