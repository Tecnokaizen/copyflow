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
import {
  STATUS_POLL_INTERVAL_MS,
  nextOnboardingPollStep,
  type OnboardingSuccessView,
} from "@/lib/onboarding/success-polling";

type StatusPayload = {
  state?: "awaiting_payment" | "processing" | "active" | "failed" | "disabled";
  tenant?: {
    slug?: string;
    name?: string;
    active?: boolean;
    entry_url?: string | null;
  };
};

export function OnboardingSuccessStatus({
  sessionId,
  signedInEmail = null,
}: {
  sessionId: string;
  signedInEmail?: string | null;
}) {
  const [state, setState] = useState<OnboardingSuccessView>("processing");
  const [slug, setSlug] = useState<string | null>(null);
  const [entryUrl, setEntryUrl] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [lastHttpStatus, setLastHttpStatus] = useState<number | null>(null);
  // Bumped by «Volver a comprobar» to start a new polling round.
  const [round, setRound] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll(attempt: number) {
      if (cancelled) {
        return;
      }
      setAttempts(attempt);
      let httpStatus: number | null = null;
      let body: StatusPayload | null = null;
      try {
        const response = await fetch(
          `/api/onboarding/status?session_id=${encodeURIComponent(sessionId)}`,
          {
            headers: { Accept: "application/json" },
            cache: "no-store",
            credentials: "include",
          }
        );
        httpStatus = response.status;
        if (response.ok) {
          body = (await response.json().catch(() => null)) as StatusPayload | null;
        }
      } catch {
        httpStatus = null; // network failure: retried below
      }
      if (cancelled) {
        return;
      }
      setLastHttpStatus(httpStatus);

      if (body && typeof body.tenant?.slug === "string") {
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

      // Never hide an error: stop on a non-retryable answer and always end on
      // a visible state after the last attempt.
      const step = nextOnboardingPollStep({
        httpStatus,
        bodyState: body?.state,
        attempt,
      });
      if (step.view) {
        setState(step.view);
      }
      if (!step.pollAgain) {
        return;
      }

      timer = setTimeout(() => {
        void poll(attempt + 1);
      }, STATUS_POLL_INTERVAL_MS);
    }

    void poll(1);

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [sessionId, round]);

  function checkAgain() {
    setState("processing");
    setAttempts(0);
    setLastHttpStatus(null);
    setRound((current) => current + 1);
  }

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

  if (state === "forbidden") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Esta cuenta no puede confirmar el pago</CardTitle>
          <CardDescription>
            {signedInEmail
              ? `Has iniciado sesión como ${signedInEmail}, que no es la cuenta propietaria de la organización de este pago.`
              : "Has iniciado sesión con una cuenta que no es la propietaria de la organización de este pago."}{" "}
            Cierra sesión, entra con la cuenta con la que hiciste el alta y vuelve a abrir este enlace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LogoutButton variant="outline" className="w-full" />
        </CardContent>
      </Card>
    );
  }

  if (state === "unauthenticated") {
    const next = `/onboarding/success?session_id=${encodeURIComponent(sessionId)}`;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Tu sesión ha terminado</CardTitle>
          <CardDescription>
            Vuelve a iniciar sesión con la cuenta con la que hiciste el alta para
            terminar de confirmar el pago.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <Link href={`/auth/login?next=${encodeURIComponent(next)}`}>Iniciar sesión</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "invalid") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">No podemos validar este pago</CardTitle>
          <CardDescription>
            El enlace de confirmación no corresponde a un pago reconocido
            {lastHttpStatus ? ` (código ${lastHttpStatus})` : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button type="button" className="w-full" onClick={checkAgain}>
            Volver a comprobar
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href="/onboarding">Volver al onboarding</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state === "timeout") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Todavía no podemos confirmar tu suscripción</CardTitle>
          <CardDescription>
            La comprobación ha tardado más de lo esperado. Puedes volver a
            comprobarlo: no se repite el pago.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {lastHttpStatus === null
              ? "Última respuesta: sin conexión con el servidor."
              : `Última respuesta: código ${lastHttpStatus}.`}
          </p>
          <Button type="button" className="w-full" onClick={checkAgain}>
            Volver a comprobar
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
