import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { OrderStatusSettings } from "@/components/settings/order-status-settings";
import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function OrderStatusSettingsPage() {
  const context = await getCurrentContext();

  if (!context || !canManageSettingsCatalogs(context.membership.role)) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Estados de pedido"
        description="Configura el flujo operativo del tenant. Siempre debe existir exactamente un estado Inicial activo."
        className="mb-5 sm:mb-6"
      />

      <OrderStatusSettings />
    </AppShell>
  );
}
