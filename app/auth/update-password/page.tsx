import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { UpdatePasswordForm } from "@/components/update-password-form";
import {
  legacyRecoveryForwardPath,
  recoveryFailurePath,
} from "@/lib/auth/recovery-callback";
import { getPostAuthRedirectPath } from "@/lib/auth/safe-next-path";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Nueva contraseña",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function toSearchParams(
  params: Record<string, string | string[] | undefined>
): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") query.set(key, value);
  }
  return query;
}

async function UpdatePasswordContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const query = toSearchParams(await searchParams);

  // Recovery emails sent before /auth/recovery existed link here directly.
  const forward = legacyRecoveryForwardPath(query);
  if (forward) {
    redirect(forward);
  }

  const nextPath = getPostAuthRedirectPath(query.get("next"));
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) {
    redirect(recoveryFailurePath("session_missing", nextPath));
  }

  return <UpdatePasswordForm nextPath={nextPath} />;
}

export default function Page({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense fallback={null}>
          <UpdatePasswordContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}
