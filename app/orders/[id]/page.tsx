"use client";

import { Suspense } from "react";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { OrderWorkspace } from "@/components/orders/detail/order-workspace";

export default function OrderDetailPage() {
  return (
    <Suspense
      fallback={
        <AppShell>
          <AppNav />
          <p className="text-muted-foreground">Cargando pedido…</p>
        </AppShell>
      }
    >
      <OrderWorkspace />
    </Suspense>
  );
}
