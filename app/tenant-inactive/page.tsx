import Link from "next/link";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { appOrigin } from "@/lib/tenant/app-origin";
import { parseInactiveTenantReason } from "@/lib/tenant/inactive-reason";

export const instant = false;

export default async function TenantInactivePage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  const reason = parseInactiveTenantReason(params.reason);
  const onboardingHref = `${appOrigin()}/onboarding`;

  if (reason === "administratively_disabled") {
    return (
      <main className="flex min-h-screen items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-bold">Espacio desactivado</h1>
          <p className="mt-3 text-muted-foreground">
            Este espacio Gestcopy está actualmente desactivado. Contacta con el
            administrador para recuperar el acceso.
          </p>
          <div className="mt-6 flex flex-col items-center gap-3">
            <LogoutButton variant="outline" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-bold">Espacio pendiente de activación</h1>
        <p className="mt-3 text-muted-foreground">
          Este espacio Gestcopy aún no está activo. Completa el pago de Gestcopy
          Basic desde el onboarding para continuar.
        </p>
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button asChild>
            <Link href={onboardingHref}>Continuar con el pago</Link>
          </Button>
          <LogoutButton variant="outline" />
        </div>
      </div>
    </main>
  );
}
