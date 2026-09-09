"use client";

/**
 * Temporary invitation acceptance surface for Phase 2C-A.
 *
 * Risk: invitation token travels in the query string (referrer/history exposure).
 * Future alternative: opaque one-time id / short code exchanged server-side,
 * never placing the raw invitation token in URLs or client storage.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { authHrefWithNext } from "@/lib/auth/safe-next-path";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type AcceptState =
  | { kind: "loading" }
  | { kind: "need_auth"; returnTo: string }
  | { kind: "accepting" }
  | { kind: "success"; tenantOrigin: string; tenantName: string }
  | { kind: "error"; message: string };

function publicAcceptError(status: number | undefined, fallback?: string) {
  if (status === 401) {
    return "Debes iniciar sesión para aceptar la invitación.";
  }
  if (status === 403) {
    return "No tienes acceso a esta invitación.";
  }
  if (status === 404 || status === 410) {
    return "La invitación no es válida o ya no está disponible.";
  }
  if (status === 409) {
    return "Ya formas parte de esta organización.";
  }
  if (status === 400) {
    return "La invitación no es válida.";
  }
  return fallback ?? "No se pudo aceptar la invitación.";
}

export function AcceptInvitationClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = (searchParams.get("token") ?? "").trim();
  const attempted = useRef(false);
  const [state, setState] = useState<AcceptState>({ kind: "loading" });

  useEffect(() => {
    if (attempted.current) {
      return;
    }
    attempted.current = true;

    async function run() {
      if (!token || token.length !== 64 || !/^[0-9a-f]+$/i.test(token)) {
        setState({
          kind: "error",
          message: "La invitación no es válida.",
        });
        return;
      }

      const returnTo = `/invitations/accept?token=${encodeURIComponent(token)}`;
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setState({ kind: "need_auth", returnTo });
        return;
      }

      setState({ kind: "accepting" });

      const response = await fetch("/api/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      let payload: {
        error?: string;
        tenant_origin?: string;
        tenant?: { name?: string; slug?: string };
      } = {};

      try {
        payload = await response.json();
      } catch {
        payload = {};
      }

      if (!response.ok) {
        setState({
          kind: "error",
          message: publicAcceptError(response.status, payload.error),
        });
        return;
      }

      const tenantOrigin =
        typeof payload.tenant_origin === "string"
          ? payload.tenant_origin
          : null;

      if (!tenantOrigin) {
        setState({
          kind: "error",
          message: "No se pudo completar la invitación.",
        });
        return;
      }

      setState({
        kind: "success",
        tenantOrigin,
        tenantName:
          typeof payload.tenant?.name === "string"
            ? payload.tenant.name
            : "tu organización",
      });

      window.location.assign(tenantOrigin);
    }

    void run();
  }, [token, router]);

  if (state.kind === "loading" || state.kind === "accepting") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Aceptando invitación</CardTitle>
          <CardDescription>Un momento…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (state.kind === "need_auth") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Aceptar invitación</CardTitle>
          <CardDescription>
            Inicia sesión o crea una cuenta con el email invitado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Button asChild className="w-full">
            <Link href={authHrefWithNext("/auth/login", state.returnTo)}>
              Iniciar sesión
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link href={authHrefWithNext("/auth/sign-up", state.returnTo)}>
              Crear cuenta
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (state.kind === "success") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Invitación aceptada</CardTitle>
          <CardDescription>
            Redirigiendo a {state.tenantName}…
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <a href={state.tenantOrigin}>Ir ahora</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">No se pudo aceptar</CardTitle>
        <CardDescription>{state.message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full">
          <Link href="/auth/login">Ir al login</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
