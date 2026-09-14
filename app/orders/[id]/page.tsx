"use client";

import { Suspense } from "react";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { OrderWorkspace } from "@/components/orders/detail/order-workspace";

export default function OrderDetailPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <AppNav />
          <LoadingState label="Cargando pedido…" />
        </AppShell>
      }
    >
      <OrderWorkspace />
    </Suspense>
  );
}
