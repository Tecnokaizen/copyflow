"use client";

import { Suspense } from "react";
import { AppNav } from "@/components/app-nav";
import { OrderWorkspace } from "@/components/orders/detail/order-workspace";

export default function OrderDetailPage() {
  return (
    <Suspense
      fallback={
        <main className="gc-page">
          <div className="gc-page-inner">
            <AppNav />
            <p className="text-muted-foreground">Cargando pedido…</p>
          </div>
        </main>
      }
    >
      <OrderWorkspace />
    </Suspense>
  );
}
