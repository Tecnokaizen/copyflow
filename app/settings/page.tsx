import Link from "next/link";
import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import { canManageBilling } from "@/lib/billing/access";
import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import { canOpenKioskDemo } from "@/lib/kiosk/demo-access";
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
  const showBilling = canManageBilling(context.membership.role);
  const showKioskDemo = canOpenKioskDemo(context.membership.role);

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Configuración"
        description="Configura los catálogos operativos de tu organización. Los cambios se aplican únicamente al tenant actual."
        className="mb-5 sm:mb-6"
      />

      <div className="grid gap-4 md:grid-cols-2">
        {showBilling ? (
          <SectionCard
            title="Facturación"
            description="Consulta el plan comercial y gestiona la suscripción Gestcopy Basic a través de Stripe."
            bodyClassName="p-5 sm:p-6"
          >
            <Button asChild>
              <Link href="/settings/billing">Ver facturación</Link>
            </Button>
          </SectionCard>
        ) : null}

        <SectionCard
          title="Estados de pedido"
          description="Define el flujo operativo: estado inicial, estados intermedios, listo, entregado y cancelado."
          bodyClassName="p-5 sm:p-6"
        >
          <Button asChild>
            <Link href="/settings/order-statuses">Gestionar estados</Link>
          </Button>
        </SectionCard>

        <SectionCard
          title="Catálogos operativos"
          description="Tipos de cliente, canales de entrada, contextos y opciones de archivo, presupuesto, pago y entrega."
          bodyClassName="p-5 sm:p-6"
        >
          <Button asChild>
            <Link href="/settings/catalogs">Gestionar catálogos</Link>
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
          description="Configura los servicios, categorías, requisitos y plazos estándar que utiliza el flujo de pedidos."
          bodyClassName="p-5 sm:p-6"
        >
          <Button asChild variant="outline">
            <Link href="/services">Gestionar servicios</Link>
          </Button>
        </SectionCard>

        <SectionCard
          title="Archivos y almacenamiento"
          description="Consulta el uso de almacenamiento y el tamaño máximo por archivo. La cuota comercial la define el plan."
          bodyClassName="p-5 sm:p-6"
        >
          <Button asChild variant="outline">
            <Link href="/settings/files">Gestionar archivos</Link>
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

        {showKioskDemo ? (
          <SectionCard
            title="Kiosk · Demo"
            description="Abre el Kiosk público de esta organización en una pestaña nueva, en el mismo dominio."
            bodyClassName="p-5 sm:p-6"
          >
            <Button asChild variant="outline">
              <a href="/kiosk" target="_blank" rel="noopener noreferrer">
                Kiosk · Demo
              </a>
            </Button>
          </SectionCard>
        ) : null}
      </div>
    </AppShell>
  );
}
