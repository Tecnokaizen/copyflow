import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmErrorMessage } from "@/lib/auth/auth-messages";

export const metadata: Metadata = {
  title: "Enlace no válido",
};

type SearchParams = Promise<{ error?: string }>;

async function ErrorContent({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  // The query text is never shown as is: see confirmErrorMessage.
  return (
    <p className="text-sm text-muted-foreground" role="alert">
      {confirmErrorMessage(params?.error)}
    </p>
  );
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-2xl">
                No hemos podido completar la verificación
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <Suspense
                fallback={
                  <p className="text-sm text-muted-foreground">
                    Comprobando el enlace…
                  </p>
                }
              >
                <ErrorContent searchParams={searchParams} />
              </Suspense>
              <Button asChild className="w-full">
                <Link href="/auth/login">Ir a iniciar sesión</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
