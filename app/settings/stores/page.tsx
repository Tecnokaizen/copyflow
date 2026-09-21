import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { StoreSettings } from "@/components/settings/store-settings";
import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function StoreSettingsPage() {
  const context = await getCurrentContext();

  if (
    !context ||
    !canManageSettingsCatalogs(context.membership.role)
  ) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Tiendas"
        description="Gestiona las sedes del tenant actual. Los pedidos históricos conservan su tienda aunque la desactives."
        className="mb-5 sm:mb-6"
      />

      <StoreSettings />
    </AppShell>
  );
}
