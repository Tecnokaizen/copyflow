import Link from "next/link";
import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import { canManageQuickOrderLayout } from "@/lib/settings/quick-order-layout";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function SettingsPage() {
  const context = await getCurrentContext();

  if (!context || !canManageSettingsCatalogs(context.membership.role)) {
    notFound();
  }

  const canManageQuickOrder = canManageQuickOrderLayout(
    context.membership.role
  );

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Configuración"
        description="Configura los catálogos operativos de tu organización. Los cambios se aplican únicamente al tenant actual."
        className="mb-5 sm:mb-6"
      />

      <div className="grid gap-4 md:grid-cols-2">
        <SectionCard
          title="Estados de pedido"
          description="Define el flujo operativo: estado inicial, estados intermedios, listo, entregado y cancelado."
          bodyClassName="p-5 sm:p-6"
        >
          <Button asChild>
            <Link href="/settings/statuses">Gestionar estados</Link>
          </Button>
        </SectionCard>

        <SectionCard
          title="Tiendas"
          description="Gestiona las sedes disponibles para asignar pedidos. Desactiva una tienda cuando deje de utilizarse para conservar el histórico."
          bodyClassName="p-5 sm:p-6"
        >
          <Button asChild variant="outline">
            <Link href="/settings/stores">Gestionar tiendas</Link>
          </Button>
        </SectionCard>

        <SectionCard
          title="Servicios"
          description="Configura los servicios, requisitos y plazos estándar que utiliza el flujo de pedidos."
          bodyClassName="p-5 sm:p-6"
        >
          <Button asChild variant="outline">
            <Link href="/services">Gestionar servicios</Link>
          </Button>
        </SectionCard>

        {canManageQuickOrder ? (
          <SectionCard
            title="Pedido rápido"
            description="Decide qué campos aparecen siempre en la creación rápida de pedidos."
            bodyClassName="p-5 sm:p-6"
          >
            <Button asChild variant="outline">
              <Link href="/settings/quick-order">Configurar pedido rápido</Link>
            </Button>
          </SectionCard>
        ) : null}
      </div>
    </AppShell>
  );
}
