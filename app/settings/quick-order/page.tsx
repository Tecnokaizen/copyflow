import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { QuickOrderLayoutSettings } from "@/components/settings/quick-order-layout-settings";
import { canManageQuickOrderLayout } from "@/lib/settings/quick-order-layout";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function QuickOrderSettingsPage() {
  const context = await getCurrentContext();

  if (
    !context ||
    !canManageQuickOrderLayout(context.membership.role)
  ) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Pedido rápido"
        description="Elige Principal, Más opciones u Oculto para cada campo. Oculto solo afecta al pedido rápido; el campo sigue disponible en la ficha del pedido."
        className="mb-5 sm:mb-6"
      />
      <QuickOrderLayoutSettings />
    </AppShell>
  );
}
