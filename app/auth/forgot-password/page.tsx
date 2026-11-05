import type { Metadata } from "next";
import { Suspense } from "react";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { parseRecoveryFailure } from "@/lib/auth/auth-messages";
import { getPostAuthRedirectPath } from "@/lib/auth/safe-next-path";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
};

type SearchParams = Promise<{ next?: string; error?: string }>;

async function ForgotPasswordContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  return (
    <ForgotPasswordForm
      nextPath={getPostAuthRedirectPath(params.next)}
      linkFailure={parseRecoveryFailure(params.error)}
    />
  );
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={null}>
          <ForgotPasswordContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
