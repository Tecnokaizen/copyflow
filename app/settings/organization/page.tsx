import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { OrganizationSettings } from "@/components/settings/organization-settings";
import { canManageOrganizationIdentity } from "@/lib/auth/membership-roles";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function OrganizationSettingsPage() {
  const context = await getCurrentContext();
  if (!context || !canManageOrganizationIdentity(context.membership.role)) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Identidad de empresa"
        description="Personaliza cómo aparece tu organización en Gestcopy."
        className="mb-5 sm:mb-6"
      />
      <OrganizationSettings />
    </AppShell>
  );
}
