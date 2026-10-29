import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { WorkStageSettings } from "@/components/settings/work-stages/work-stage-settings";
import { canManageWorkStages } from "@/lib/orders/work-sequence/access";
import { workSequenceEnabled } from "@/lib/orders/work-sequence/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

// SUR4 E8: «Fases de trabajo». Only for tenants with order_work_sequence;
// every member reads it, owner/admin/manager change it.
export default async function WorkStageSettingsPage() {
  const context = await getCurrentContext();
  if (!context) {
    notFound();
  }

  const supabase = await createClient();
  if (!(await workSequenceEnabled(supabase, context.tenant.id))) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Fases de trabajo"
        description="Las fases con las que se arma la secuencia de trabajo de un pedido: quién hace cada parte y a quién le toca ahora."
        className="mb-5 sm:mb-6"
      />

      <WorkStageSettings canManage={canManageWorkStages(context.membership.role)} />
    </AppShell>
  );
}
