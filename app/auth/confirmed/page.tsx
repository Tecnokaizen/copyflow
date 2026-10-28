import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  CONFIRMED_COOKIE,
  confirmedLoginPath,
} from "@/lib/auth/confirm-callback";

// Neutral title: it is sent before the cookie check below.
export const metadata: Metadata = {
  title: "Confirmación de correo",
};

// `/auth/confirm` sends users here, with CONFIRMED_COOKIE, only when Supabase
// Auth has confirmed the email but no session could be opened (another
// device, or the link was used after the sign-up flow expired). Without the
// cookie (page opened directly or a shared link) nothing is shown: the visitor
// goes to the login page.
async function ConfirmedCard({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [params, cookieStore] = await Promise.all([searchParams, cookies()]);
  const loginPath = confirmedLoginPath(params.next);

  if (!cookieStore.has(CONFIRMED_COOKIE)) {
    redirect(loginPath);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Correo confirmado</CardTitle>
        <CardDescription>Ya puedes iniciar sesión.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild className="w-full">
          <Link href={loginPath}>Iniciar sesión</Link>
        </Button>
      </CardContent>
    </Card>
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
          <Suspense fallback={null}>
            <ConfirmedCard searchParams={searchParams} />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
