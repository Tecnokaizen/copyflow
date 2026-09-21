import { notFound } from "next/navigation";

import { AppNav } from "@/components/app-nav";
import { AppShell } from "@/components/gestcopy/app-shell";
import { PageHeader } from "@/components/gestcopy/page-header";
import { FilesSettings } from "@/components/settings/files-settings";
import { canManageFilesSettings } from "@/lib/settings/files";
import { getCurrentContext } from "@/lib/tenant/current-context";

export const instant = false;

export default async function FilesSettingsPage() {
  const context = await getCurrentContext();

  if (!context || !canManageFilesSettings(context.membership.role)) {
    notFound();
  }

  return (
    <AppShell>
      <AppNav />

      <PageHeader
        title="Archivos y almacenamiento"
        description="Consulta el uso de almacenamiento y configura el tamaño máximo por archivo de tu organización."
        className="mb-5 sm:mb-6"
      />

      <FilesSettings />
    </AppShell>
  );
}
