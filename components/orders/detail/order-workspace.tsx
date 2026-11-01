"use client";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { buildOrderDetailModules } from "@/components/orders/detail/order-detail-modules";
import { OrderViewPreviewBanner } from "@/components/orders/detail/order-view-preview-banner";
import { useOrderWorkspace } from "@/components/orders/detail/use-order-workspace";
import { orderDetailLayout } from "@/components/orders/detail/views";
import { OrderNotesProvider } from "@/components/orders/notes";
import {
  DEFAULT_ORDER_DETAIL_VIEW,
  isImplementedOrderDetailView,
  ORDER_DETAIL_VIEW_PREVIEW_PARAM,
  resolvePreviewOrderDetailView,
} from "@/lib/orders/detail-views";

// Order Detail Views V1: OrderWorkspace only orchestrates. useOrderWorkspace
// owns every load and save; buildOrderDetailModules builds each module once;
// the tenant's layout places them. Any unknown view renders the classic page.
export function OrderWorkspace() {
  const ctl = useOrderWorkspace();
  const { order, loading, error } = ctl;

  if (loading && !order) {
    return (
      <AppShell>
        <AppNav />
        <LoadingState label="Cargando pedido…" />
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell>
        <AppNav />
        <ErrorState
          title={error ?? "Pedido no encontrado"}
          onRetry={() => {
            ctl.setError(null);
            ctl.setLoading(true);
            ctl.setReloadToken((current) => current + 1);
          }}
        />
      </AppShell>
    );
  }

  const previewView = resolvePreviewOrderDetailView({
    requested: ctl.searchParams.get(ORDER_DETAIL_VIEW_PREVIEW_PARAM),
    role: ctl.role,
  });
  const view =
    previewView ??
    (isImplementedOrderDetailView(ctl.detailView)
      ? ctl.detailView
      : DEFAULT_ORDER_DETAIL_VIEW);
  const { Layout, frameClassName } = orderDetailLayout(view);
  const { modules, facts, dialogs } = buildOrderDetailModules(ctl, order);

  return (
    <AppShell innerClassName={frameClassName}>
      <AppNav />
      <OrderNotesProvider orderId={order.id} enabled={ctl.features.stickyNotes}>
        {previewView ? (
          <OrderViewPreviewBanner
            orderId={order.id}
            view={previewView}
            appliedView={ctl.detailView}
          />
        ) : null}
        <div data-order-detail-view={view}>
          <Layout modules={modules} facts={facts} />
        </div>
        {dialogs}
      </OrderNotesProvider>
    </AppShell>
  );
}
