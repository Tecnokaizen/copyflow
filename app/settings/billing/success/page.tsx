import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { BillingSuccessStatus } from "@/components/settings/billing-success-status";
import { canManageBilling } from "@/lib/billing/access";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function BillingSuccessPage() {
  const context = await getCurrentContext();

  if (!context || !canManageBilling(context.membership.role)) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Confirmando suscripción"
        description="Stripe nos avisará cuando el pago quede registrado. No uses esta pantalla como prueba de activación."
        className="mb-5 sm:mb-6"
      />

      <BillingSuccessStatus />
    </AppShell>
  );
}
