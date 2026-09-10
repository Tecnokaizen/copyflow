import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";
import { isTenantHostRequest } from "@/lib/tenant/request-host";

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = getSafeNextPath(params.next);
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
