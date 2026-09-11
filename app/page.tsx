import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { TenantDashboard } from "@/components/dashboard/tenant-dashboard";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

export const instant = false;

export default async function Home() {
  const tenantSlug = await resolveRequestTenantSlug();

  // Apex / Preview without explicit tenant: marketing + onboarding entry.
  if (!tenantSlug) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-4xl font-bold">Copyflow</h1>
          <p className="mt-3 text-muted-foreground">
            Plataforma de gestión para copisterías
          </p>
          {user ? (
            <div className="mt-8 flex flex-col items-center gap-3">
              <p className="text-sm text-muted-foreground">
                Crea tu organización para empezar a trabajar.
              </p>
              <Button asChild>
                <Link href="/onboarding">Crear organización</Link>
              </Button>
              <LogoutButton variant="outline" />
            </div>
          ) : (
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button asChild variant="outline">
                <Link href="/auth/login">Iniciar sesión</Link>
              </Button>
              <Button asChild>
                <Link href="/auth/sign-up">Crear cuenta</Link>
              </Button>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Tenant context (hostname subdomain or Preview/local override).
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const context = await getCurrentContext();

  if (!context) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Acceso no autorizado</h1>
          <p className="mt-3 text-muted-foreground">
            Tu usuario no tiene acceso a este espacio de Copyflow.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <Button asChild>
              <Link href="/onboarding">Crear mi organización</Link>
            </Button>
            <LogoutButton variant="outline" />
          </div>
        </div>
      </main>
    );
  }

  return <TenantDashboard />;
}
