import { randomUUID } from "node:crypto";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { KioskOrderForm } from "@/components/kiosk/kiosk-order-form";
import { loadKioskBootstrap } from "@/lib/kiosk/server";
import { trustedKioskRequestContext } from "@/lib/kiosk/trusted-request";

export const metadata: Metadata = {
  title: "Solicitar un pedido",
  description: "Envía una solicitud de trabajo a tu copistería.",
  robots: { index: false, follow: false },
};

async function KioskContent() {
  await connection();
  const context = trustedKioskRequestContext(
    new Headers(await headers()),
    process.env
  );
  let bootstrap = null;

  try {
    bootstrap = context ? await loadKioskBootstrap(context) : null;
  } catch (error) {
    console.error("[GET /kiosk] Could not load public Kiosk", { error });
  }

  if (!bootstrap) {
    notFound();
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
