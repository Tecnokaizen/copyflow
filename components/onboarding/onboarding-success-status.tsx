"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  resolveTenantOrigin,
  tenantRequestContextFromLocation,
} from "@/lib/tenant/domains";

type StatusPayload = {
  state?: "awaiting_payment" | "processing" | "active" | "failed";
  tenant?: { slug?: string; name?: string; active?: boolean };
};

export function OnboardingSuccessStatus({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<string>("processing");
  const [slug, setSlug] = useState<string | null>(null);
  const [tenantOrigin, setTenantOrigin] = useState<string | null>(null);
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
        const response = await fetch(
          `/api/onboarding/status?session_id=${encodeURIComponent(sessionId)}`,
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
            credentials: "include",
          }
        );
        if (response.ok) {
          const body = (await response.json()) as StatusPayload;
          if (body.state) {
            setState(body.state);
          }
          if (typeof body.tenant?.slug === "string") {
            setSlug(body.tenant.slug);
            const origin = resolveTenantOrigin(
              body.tenant.slug,
              tenantRequestContextFromLocation(window.location)
            );
            setTenantOrigin(`${origin}/auth/login`);
          }
          if (body.state === "active") {
            return;
          }
          if (body.state === "failed") {
            return;
          }
        }
      } catch {
        // keep processing
      }

      if (attempt >= 24) {
        setState((current) =>
          current === "processing" ? "processing" : current
        );
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
  }, [sessionId]);

  useEffect(() => {
    if (state !== "active" || !tenantOrigin) {
      return;
    }
    const timeout = window.setTimeout(() => {
      window.location.assign(tenantOrigin);
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [state, tenantOrigin]);

  if (state === "active") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Tu espacio Gestcopy está listo</CardTitle>
          <CardDescription>
            Te estamos llevando a iniciar sesión en tu copistería
            {slug ? ` (${slug})` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {tenantOrigin ? (
            <Button asChild className="w-full">
              <a href={tenantOrigin}>Entrar ahora</a>
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }

  if (state === "failed") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">No se pudo activar</CardTitle>
          <CardDescription>
            El pago no quedó confirmado. Puedes reintentarlo desde el onboarding.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/onboarding?canceled=1">Volver al onboarding</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "awaiting_payment") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Pago pendiente</CardTitle>
          <CardDescription>
            Todavía no hemos recibido la confirmación del pago.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href="/onboarding?canceled=1">Continuar con el pago</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Confirmando tu suscripción…</CardTitle>
        <CardDescription>
          Estamos sincronizando el pago con Gestcopy. Esto suele tardar unos
          segundos.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Comprobación {attempts}…
        </p>
      </CardContent>
    </Card>
  );
}
