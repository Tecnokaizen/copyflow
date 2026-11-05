import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { billingSuspensionMessage } from "@/lib/billing/access-gate";
import { readMemberBillingAccess } from "@/lib/billing/access-gate-server";
import { canManageBilling } from "@/lib/billing/access";
import { createClient } from "@/lib/supabase/server";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

export const instant = false;

export default async function BillingSuspendedPage() {
  const slug = await resolveRequestTenantSlug();
  if (!slug) {
    redirect("/");
  }

  const supabase = await createClient();
  const access = await readMemberBillingAccess(supabase, slug);

  // Not suspended (or not a member): back to the app.
  if (!access || access.allowed || !access.enforced) {
    redirect("/");
  }

  const isOwner = canManageBilling(access.role);

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Operativa suspendida</h1>
        <p className="mt-3 text-muted-foreground">
          {billingSuspensionMessage(access.state)}
        </p>
        <p className="mt-3 text-muted-foreground">
          Los pedidos, clientes, archivos y ajustes se conservan. El acceso se
          reactiva automáticamente en cuanto se confirma el pago.
        </p>
        {isOwner ? null : (
          <p className="mt-3 text-muted-foreground">
            Solo el propietario del espacio puede regularizar la suscripción.
          </p>
        )}
        <div className="mt-6 flex flex-col items-center gap-3">
          {isOwner ? (
            <Button asChild>
              <Link href="/settings/billing">Ir a Facturación</Link>
            </Button>
          ) : null}
          <Button asChild variant="ghost">
            <Link href="/ayuda">Ayuda y soporte</Link>
          </Button>
          <LogoutButton variant="outline" />
        </div>
      </div>
    </main>
  );
}
