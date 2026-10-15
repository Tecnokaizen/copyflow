import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { EarlyAccessInfo } from "@/components/pro/early-access-info";
import {
  proEarlyAccessGate,
  resolveProEarlyAccess,
} from "@/lib/features/early-access-server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export const metadata: Metadata = {
  title: "Gestcopy Pro",
};

export default async function ProEarlyAccessPage() {
  const supabase = await createClient();
  const gate = await proEarlyAccessGate({
    getContext: getCurrentContext,
    hasProEarlyAccess: (tenantId) => resolveProEarlyAccess(supabase, tenantId),
  });

  // Not enrolled, no session, inactive tenant/membership or any error.
  if (!gate.ok) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Gestcopy Pro · Acceso anticipado"
        description="Tu copistería participa en el acceso anticipado a nuevas funcionalidades Pro."
        className="mb-5 sm:mb-6"
      />

      <EarlyAccessInfo />
    </AppShell>
  );
}
