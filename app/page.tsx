import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

export const instant = false;

export default async function Home() {
  const headersList = await headers();

  const hostname =
    headersList.get("x-forwarded-host") ??
    headersList.get("host") ??
    "";

  const tenantSlug = getSubdomainFromHostname(hostname);

  // Dominio raíz de Copyflow: todavía no estamos dentro de un tenant.
  if (!tenantSlug) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold">Copyflow</h1>
          <p className="mt-3 text-muted-foreground">
            Plataforma de gestión para copisterías
          </p>
        </div>
      </main>
    );
  }

  // Estamos en un subdominio de tenant.
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // No autenticado → login en el mismo subdominio.
  if (!user) {
    redirect("/auth/login");
  }

  // Autenticado: comprobar que pertenece al tenant del hostname.
  const context = await getCurrentContext();

  if (!context) {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Acceso no autorizado</h1>
          <p className="mt-3 text-muted-foreground">
            Tu usuario no tiene acceso a este espacio de Copyflow.
          </p>
        </div>
      </main>
    );
  }

  redirect("/orders");
}
