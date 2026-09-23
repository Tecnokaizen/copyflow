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
    process.env,
  );
  let bootstrap = null;

  try {
    bootstrap = context ? await loadKioskBootstrap(context) : null;
  } catch (error) {
    console.error("[GET /kiosk] Could not load public Kiosk", { error });
  }

  if (!bootstrap) {
    // Defense in depth: proxy already returns HTTP 404 before streaming.
    notFound();
  }

  return (
    <main lang="es" className="min-h-svh bg-background">
      <header className="border-b border-border/70 bg-card px-5 py-5 sm:px-8 sm:py-6">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <p className="min-w-0 break-words text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            {bootstrap.tenant.name}
          </p>
          <p className="text-sm font-medium text-muted-foreground">
            Solicita tu pedido
          </p>
        </div>
      </header>
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-12">
        <KioskOrderForm bootstrap={bootstrap} submissionId={randomUUID()} />
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
            Preparando tu solicitud…
          </p>
        </main>
      }
    >
      <KioskContent />
    </Suspense>
  );
}
