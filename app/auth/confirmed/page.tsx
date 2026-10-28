import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { confirmedLoginPath } from "@/lib/auth/confirm-callback";

export const metadata: Metadata = {
  title: "Correo confirmado",
};

// `/auth/confirm` only sends users here when Supabase Auth has confirmed the
// email but no session could be opened (another device, or the link was used
// after the sign-up flow expired).

async function LoginLink({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return (
    <Button asChild className="w-full">
      <Link href={confirmedLoginPath(params.next)}>Iniciar sesión</Link>
    </Button>
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
              <CardTitle className="text-2xl">Correo confirmado</CardTitle>
              <CardDescription>Ya puedes iniciar sesión.</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense
                fallback={
                  <Button asChild className="w-full">
                    <Link href="/auth/login">Iniciar sesión</Link>
                  </Button>
                }
              >
                <LoginLink searchParams={searchParams} />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
