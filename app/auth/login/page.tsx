import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import {
  getSafeNextPath,
  isInvitationAcceptNext,
} from "@/lib/auth/safe-next-path";
import { isTenantHostRequest } from "@/lib/tenant/request-host";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = getSafeNextPath(params.next);
  if (isInvitationAcceptNext(params.next)) {
    redirect(nextPath);
  }
  const isTenantHost = await isTenantHostRequest();
  return <LoginForm nextPath={nextPath} isTenantHost={isTenantHost} />;
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
          <LoginContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
