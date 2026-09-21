import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { CatalogSettings } from "@/components/settings/catalog-settings";
import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function CatalogSettingsPage() {
  const context = await getCurrentContext();

  if (!context || !canManageSettingsCatalogs(context.membership.role)) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Catálogos operativos"
        description="Configura las opciones que utiliza el tenant en clientes, recepción, producción, cobro y entrega."
        className="mb-5 sm:mb-6"
      />

      <CatalogSettings />
    </AppShell>
  );
}
