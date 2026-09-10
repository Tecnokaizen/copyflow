import { Suspense } from "react";
import Link from "next/link";
import { SignUpForm } from "@/components/sign-up-form";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getSafeNextPath,
  isInvitationAcceptNext,
} from "@/lib/auth/safe-next-path";
import { isTenantHostRequest } from "@/lib/tenant/request-host";

async function SignUpContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const rawNext = typeof params.next === "string" ? params.next : undefined;
  const nextPath = getSafeNextPath(rawNext);
  const invitationNext = isInvitationAcceptNext(rawNext) ? nextPath : null;
  const onTenantHost = await isTenantHostRequest();

  if (onTenantHost && !invitationNext) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Invitación requerida</CardTitle>
          <CardDescription>
            Para acceder a esta organización necesitas una invitación. Si ya
            tienes una cuenta, inicia sesión.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/auth/login">Iniciar sesión</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <SignUpForm
      nextPath={invitationNext ?? undefined}
      allowOwnerSignup={!onTenantHost}
    />
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
        <Suspense fallback={null}>
          <SignUpContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
