import type { Metadata } from "next";
import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";

export const metadata: Metadata = {
  title: "Revisa tu correo",
};

async function SuccessContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = getSafeNextPath(params.next);
  const continuesToInvitation = nextPath.startsWith("/invitations/accept");

  return (
    <p className="text-sm text-muted-foreground">
      Hemos creado tu cuenta. Abre el enlace que te hemos enviado por correo
      para confirmarla
      {continuesToInvitation
        ? " y seguir con la invitación."
        : " antes de iniciar sesión."}
    </p>
  );
}

export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                Gracias por registrarte
              </CardTitle>
              <CardDescription>Confirma tu correo para continuar</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense
                fallback={
                  <p className="text-sm text-muted-foreground">
                    Hemos creado tu cuenta. Abre el enlace que te hemos enviado
                    por correo para confirmarla antes de iniciar sesión.
                  </p>
                }
              >
                <SuccessContent searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
