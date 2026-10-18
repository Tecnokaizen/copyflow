"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { AppNav } from "@/components/app-nav";
import { ClientImportWizard } from "@/components/clients/import/client-import-wizard";
import { AppShell } from "@/components/gestcopy/app-shell";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { Button } from "@/components/ui/button";

export default function ClientImportPage() {
  const [state, setState] = useState<"loading" | "allowed" | "denied">("loading");

  useEffect(() => {
    async function load() {
      const response = await fetch("/api/imports/clients/access", { cache: "no-store" });
      const result = response.ok ? await response.json() : null;
      setState(result?.allowed === true ? "allowed" : "denied");
    }
    void load();
  }, []);

  return (
    <AppShell>
      <AppNav />
      <PageHeader
        title="Importar clientes"
        description="Trae tu cartera desde otro programa, un CRM o una hoja de cálculo (CSV o Excel)."
        actions={
          <Button asChild variant="outline">
            <Link href="/clients">Volver a Clientes</Link>
          </Button>
        }
      />
      {state === "loading" ? <LoadingState label="Cargando…" /> : null}
      {state === "denied" ? (
        <EmptyState
          title="La importación de clientes no está disponible"
          description="Solo owner, admin y manager pueden importar, y la función debe estar activada para tu copistería."
        />
      ) : null}
      {state === "allowed" ? <ClientImportWizard /> : null}
    </AppShell>
  );
}
