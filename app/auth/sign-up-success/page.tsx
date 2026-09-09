import { Suspense } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSafeNextPath } from "@/lib/auth/safe-next-path";

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
      You&apos;ve successfully signed up. Please check your email to confirm
      your account
      {continuesToInvitation
        ? " and you will continue with the invitation."
        : " before signing in."}
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
                Thank you for signing up!
              </CardTitle>
              <CardDescription>Check your email to confirm</CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense
                fallback={
                  <p className="text-sm text-muted-foreground">
                    You&apos;ve successfully signed up. Please check your email
                    to confirm your account before signing in.
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
