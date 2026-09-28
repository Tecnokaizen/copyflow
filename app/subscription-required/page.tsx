import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { Button } from "@/components/ui/button";
import { canAccessBillingScreen, canManageBilling } from "@/lib/billing/access";
import { loadTenantEntitlement } from "@/lib/billing/entitlement-access";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function SubscriptionRequiredPage() {
  const context = await getCurrentContext();
  if (!context) {
    notFound();
  }

  try {
    const entitlement = await loadTenantEntitlement(context.tenant.id);
    if (entitlement.allowed) {
      redirect("/");
    }
  } catch (error) {
    console.error("[subscription-required] entitlement lookup failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    redirect("/entitlement-unavailable");
  }

  const isOwner = canManageBilling(context.membership.role);
  const canReadBilling = canAccessBillingScreen(context.membership.role);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Suscripción necesaria</h1>
        <p className="mt-3 text-muted-foreground">
          Tu organización necesita una suscripción activa para continuar.
        </p>
        {isOwner ? (
          <div className="mt-6 flex flex-col items-center gap-3">
            <Button asChild>
              <Link href="/settings/billing">Gestionar facturación</Link>
            </Button>
            <LogoutButton variant="outline" />
          </div>
        ) : canReadBilling ? (
          <div className="mt-6 flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Puedes consultar el estado de la suscripción. Contratar o abrir
              el portal de Stripe corresponde al propietario de la organización.
            </p>
            <Button asChild variant="outline">
              <Link href="/settings/billing">Ver facturación</Link>
            </Button>
            <LogoutButton variant="outline" />
          </div>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Contacta con el propietario de la organización.
            </p>
            <LogoutButton variant="outline" />
          </div>
        )}
      </div>
    </main>
  );
}
