import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { OnboardingSuccessStatus } from "@/components/onboarding/onboarding-success-status";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { isTenantHostRequest } from "@/lib/tenant/request-host";
import Link from "next/link";

export const instant = false;

export default async function OnboardingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  if (await isTenantHostRequest()) {
    redirect("/");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  const params = await searchParams;
  const sessionId = params.session_id?.trim() ?? "";

  return (
    <main className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col items-end gap-4">
        <LogoutButton variant="outline" />
        <div className="w-full">
          {sessionId.startsWith("cs_") ? (
            <OnboardingSuccessStatus sessionId={sessionId} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Falta la sesión de pago</CardTitle>
                <CardDescription>
                  No podemos confirmar el alta sin una sesión de Checkout válida.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="w-full">
                  <Link href="/onboarding">Volver al onboarding</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </main>
  );
}
