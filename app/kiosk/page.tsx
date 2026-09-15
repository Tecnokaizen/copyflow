import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { KioskOrderForm } from "@/components/kiosk/kiosk-order-form";
import { loadKioskBootstrap } from "@/lib/kiosk/server";
import { resolveRequestTenantSlug } from "@/lib/tenant/request-host";

export const metadata: Metadata = {
  title: "Solicitar un pedido",
  description: "Envía una solicitud de trabajo a tu copistería.",
  robots: { index: false, follow: false },
};

function KioskUnavailable() {
  return (
    <main className="grid min-h-svh place-items-center bg-muted/25 px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border bg-card p-7 text-center shadow-sm">
        <h1 className="text-2xl font-bold">Kiosk no disponible</h1>
        <p className="mt-3 text-muted-foreground">
          Comprueba la dirección o contacta con la copistería.
        </p>
      </section>
    </main>
  );
}

async function KioskContent() {
  await connection();
  const tenantSlug = await resolveRequestTenantSlug();
  let bootstrap = null;

  try {
    bootstrap = await loadKioskBootstrap(tenantSlug);
  } catch (error) {
    console.error("[GET /kiosk] Could not load public Kiosk", { error });
  }

  if (!bootstrap) {
    return <KioskUnavailable />;
  }

  return (
    <main className="min-h-svh bg-muted/25 px-4 py-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl">
        <header className="mb-6 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
            {bootstrap.tenant.name}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">
            Solicita tu pedido
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm text-muted-foreground sm:text-base">
            Déjanos los detalles del trabajo y nos pondremos en contacto
            contigo.
          </p>
        </header>
        <KioskOrderForm
          bootstrap={bootstrap}
          submissionId={randomUUID()}
        />
        <p className="mt-5 text-center text-xs text-muted-foreground">
          Esta solicitud no crea una cuenta ni da acceso al sistema interno.
        </p>
      </div>
    </main>
  );
}

export default function KioskPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-svh place-items-center bg-muted/25 px-4 py-10">
          <p className="text-sm font-medium text-muted-foreground">
            Preparando el Kiosk…
          </p>
        </main>
      }
    >
      <KioskContent />
    </Suspense>
  );
}
