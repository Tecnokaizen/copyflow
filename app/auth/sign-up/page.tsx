import { Suspense } from "react";
import { SignUpForm } from "@/components/sign-up-form";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";

async function SignUpContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = getSafeNextPath(params.next);

  return (
    <SignUpForm nextPath={nextPath === "/" ? undefined : nextPath} />
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
