"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { CreateOrderForm } from "@/components/orders/create-order-form";
import { canUseQuickOrder } from "@/lib/nav/items";

function QuickOrderContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromCounter = searchParams.get("from") === "counter";
  const [roleReady, setRoleReady] = useState(false);

  useEffect(() => {
    async function loadContext() {
      try {
        const response = await fetch("/api/context");
        if (!response.ok) {
          router.replace("/orders/mine");
          return;
        }
        const context = (await response.json()) as {
          membership?: { role?: unknown };
        };
        const role =
          typeof context.membership?.role === "string"
            ? context.membership.role
            : null;
        if (!canUseQuickOrder(role)) {
          router.replace("/counter");
          return;
        }
        setRoleReady(true);
      } catch {
        router.replace("/orders/mine");
      }
    }

    void loadContext();
  }, [router]);

  if (!roleReady) {
    return (
      <AppShell>
        <AppNav />
        <LoadingState label="Cargando pedido rápido…" />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Pedido rápido"
        description="Alta corta para el mostrador. El resto se completa en la ficha."
        className="mb-5 sm:mb-6"
      />
      <CreateOrderForm
        mode="quick"
        fromCounter={fromCounter}
        onCancel={() =>
          router.push(fromCounter ? "/counter" : "/orders/mine")
        }
      />
    </AppShell>
  );
}

export default function QuickOrderPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <AppNav />
          <LoadingState label="Cargando pedido rápido…" />
        </AppShell>
      }
    >
      <QuickOrderContent />
    </Suspense>
  );
}
