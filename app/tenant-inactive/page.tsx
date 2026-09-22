import Link from "next/link";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import { appOrigin } from "@/lib/tenant/app-origin";

export const instant = false;

export default function TenantInactivePage() {
  const onboardingHref = `${appOrigin()}/onboarding`;

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
