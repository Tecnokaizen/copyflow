import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { OrderDetailViewSettings } from "@/components/settings/order-detail-view-settings";
import { canManageOrderDetailView } from "@/lib/settings/order-detail-view";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function OrderDetailViewSettingsPage() {
  const context = await getCurrentContext();
  if (!context || !canManageOrderDetailView(context.membership.role)) {
    notFound();
  }

  // A real order of this tenant for the functional preview (read only).
  const supabase = await createClient();
  const { data: sample } = await supabase
    .from("orders")
    .select("id")
    .eq("tenant_id", context.tenant.id)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <AppShell innerClassName="max-w-6xl">
      <AppNav />
      <PageHeader
        title="Vista de pedidos"
        description="Elige cómo se organiza la ficha de pedido para todo tu equipo. Pruébala antes con «Vista previa»: no se guarda nada hasta que pulses «Aplicar esta vista»."
        className="mb-5 sm:mb-6"
      />
      <OrderDetailViewSettings sampleOrderId={sample?.id ?? null} />
    </AppShell>
  );
}
