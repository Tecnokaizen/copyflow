import { Suspense } from "react";
import { AcceptInvitationClient } from "@/components/invitations/accept-invitation-client";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Suspense
          fallback={
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl">Aceptando invitación</CardTitle>
                <CardDescription>Un momento…</CardDescription>
              </CardHeader>
            </Card>
          }
        >
          <AcceptInvitationClient />
        </Suspense>
      </div>
    </div>
  );
}
