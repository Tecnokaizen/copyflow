"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";

type SubscriptionPayload = {
  subscription: { status: string; provider: string | null } | null;
};

export function BillingSuccessStatus() {
  const [status, setStatus] = useState<string>("pending");
  const [provider, setProvider] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll(attempt: number) {
      if (cancelled) {
        return;
      }
      setAttempts(attempt);
      try {
        const response = await fetch("/api/billing/subscription", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (response.ok) {
          const body = (await response.json()) as SubscriptionPayload;
          const sub = body.subscription;
          if (sub && sub.provider === "stripe" && sub.status === "active") {
            setStatus("active");
            setProvider(sub.provider);
            return;
          }
          if (sub) {
            setStatus(sub.status);
            setProvider(sub.provider);
          }
        }
      } catch {
        // keep pending
      }

      if (attempt >= 12) {
        setStatus((current) => (current === "pending" ? "waiting" : current));
        return;
      }

      timer = setTimeout(() => {
        void poll(attempt + 1);
      }, 2500);
    }

    void poll(1);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, []);

  const confirmed = status === "active" && provider === "stripe";

  return (
    <SectionCard title="Confirmación" bodyClassName="p-5 sm:p-6">
      {confirmed ? (
        <>
          <p className="text-sm">
            Tu suscripción Gestcopy Basic ya está sincronizada.
          </p>
          <Button asChild className="mt-4">
            <Link href="/settings/billing">Ir a facturación</Link>
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm font-medium">
            Estamos confirmando tu suscripción
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            El pago se confirma cuando Stripe notifica a Gestcopy. Esta pantalla
            no declara la cuenta como activa solo por haber vuelto desde Checkout.
            {attempts > 0 ? ` Intento ${attempts}.` : null}
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/settings/billing">Volver a facturación</Link>
          </Button>
        </>
      )}
    </SectionCard>
  );
}
