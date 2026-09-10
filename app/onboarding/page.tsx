import { redirect } from "next/navigation";

import { LogoutButton } from "@/components/logout-button";
import { OnboardingForm } from "@/components/onboarding/onboarding-form";
import { createClient } from "@/lib/supabase/server";
import { isTenantHostRequest } from "@/lib/tenant/request-host";

export const instant = false;

export default async function OnboardingPage() {
  if (await isTenantHostRequest()) {
    redirect("/");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/auth/login");
  }

  return (
    <main className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col items-end gap-4">
        <LogoutButton variant="outline" />
        <div className="w-full">
          <OnboardingForm />
        </div>
      </div>
    </main>
  );
}
