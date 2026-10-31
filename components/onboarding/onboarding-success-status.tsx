"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { LogoutButton } from "@/components/logout-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { safeOnboardingEntryUrl } from "@/lib/onboarding/entry-destination";

type StatusPayload = {
  state?: "awaiting_payment" | "processing" | "active" | "failed" | "disabled";
  tenant?: {
    slug?: string;
    name?: string;
    active?: boolean;
    entry_url?: string | null;
  };
};

export function OnboardingSuccessStatus({ sessionId }: { sessionId: string }) {
  const [state, setState] = useState<string>("processing");
  const [slug, setSlug] = useState<string | null>(null);
  const [entryUrl, setEntryUrl] = useState<string | null>(null);
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
            // Server-built destination, re-checked here: same origin outside
            // Production, the real tenant host only on the Production app.
            setEntryUrl(
              safeOnboardingEntryUrl(
                body.tenant.entry_url,
                body.tenant.slug,
                window.location
              )
            );
          }
          if (body.state === "active") {
            return;
          }
          if (body.state === "failed" || body.state === "disabled") {
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
    if (state !== "active" || !entryUrl) {
      return;
    }
    const timeout = window.setTimeout(() => {
      window.location.assign(entryUrl);
    }, 1800);
    return () => window.clearTimeout(timeout);
  }, [state, entryUrl]);

  if (state === "active") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Tu espacio Gestcopy está listo</CardTitle>
          <CardDescription>
            {entryUrl
              ? `Te estamos llevando a iniciar sesión en tu copistería${slug ? ` (${slug})` : ""}.`
              : `Tu copistería${slug ? ` (${slug})` : ""} ya está activa, pero no hemos podido preparar el acceso automático desde esta dirección.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {entryUrl ? (
            <Button asChild className="w-full">
              <a href={entryUrl}>Entrar ahora</a>
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

  if (state === "disabled") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Este espacio está desactivado</CardTitle>
          <CardDescription>
            El espacio Gestcopy ya no está disponible para completar el
            onboarding. Contacta con el administrador si necesitas acceso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LogoutButton variant="outline" className="w-full" />
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
