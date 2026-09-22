import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { BillingSettings } from "@/components/settings/billing-settings";
import { canManageBilling } from "@/lib/billing/access";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function BillingSettingsPage() {
  const context = await getCurrentContext();

  if (!context || !canManageBilling(context.membership.role)) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Facturación"
        description="Consulta el plan comercial de tu organización y gestiona la suscripción a través de Stripe."
        className="mb-5 sm:mb-6"
      />

      <BillingSettings />
    </AppShell>
  );
}
