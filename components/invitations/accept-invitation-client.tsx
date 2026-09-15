"use client";

/**
 * Invitation acceptance stays on this page.
 * The token is the secret; email always comes from the server preview.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ACTIVATE_ACCESS_AND_CONTINUE,
  ACTIVATE_ACCESS_TITLE,
  EMAIL_LABEL,
  INVITATION_INVALID,
  PASSWORD_LABEL,
  PASSWORDS_DO_NOT_MATCH,
  REPEAT_PASSWORD_LABEL,
  SIGN_IN_TITLE,
  invitationActivateDescription,
  invitationWrongAccountCopy,
} from "@/lib/invitations/copy";
import {
  mapInvitationPreview,
  type InvitationPreview,
} from "@/lib/invitations/preview";
import {
  invitationAcceptPath,
  parseInvitationToken,
} from "@/lib/invitations/token";
import {
  invitationAcceptFailureView,
  invitationAcceptView,
} from "@/lib/invitations/view-state";

type Screen =
  | { kind: "loading" }
  | { kind: "accepting" }
  | ReturnType<typeof invitationAcceptView>
  | { kind: "success"; tenantOrigin: string; tenantName: string };

async function postAcceptInvitation(
  currentToken: string,
  currentPreview: InvitationPreview | null,
  currentSessionEmail: string | null
): Promise<Screen> {
  const returnTo = invitationAcceptPath(currentToken);
  const response = await fetch("/api/invitations/accept", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: currentToken }),
  });

  let payload: {
    error?: string;
    code?: string;
    tenant_origin?: string;
    tenant?: { name?: string };
  } = {};

  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    return invitationAcceptFailureView({
      status: response.status,
      payload,
      sessionEmail: currentSessionEmail,
      invitedEmail: currentPreview?.email ?? null,
      returnTo,
    });
  }

  const tenantOrigin =
    typeof payload.tenant_origin === "string" ? payload.tenant_origin : null;
  if (!tenantOrigin) {
    return {
      kind: "error",
      message: "No se pudo completar la invitación.",
    };
  }

  return {
    kind: "success",
    tenantOrigin,
    tenantName:
      typeof payload.tenant?.name === "string"
        ? payload.tenant.name
        : "tu organización",
  };
}

export function AcceptInvitationClient() {
  const searchParams = useSearchParams();
  const token = parseInvitationToken(searchParams.get("token"));
  const attempted = useRef(false);
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (attempted.current) {
      return;
    }
    attempted.current = true;

    async function bootstrap() {
      if (!token) {
        setScreen({ kind: "error", message: INVITATION_INVALID });
        return;
      }

      const supabase = createClient();
      const [{ data: userData }, previewResponse] = await Promise.all([
        supabase.auth.getUser(),
        fetch("/api/invitations/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        }),
      ]);

      let previewPayload: unknown = null;
      try {
        previewPayload = await previewResponse.json();
      } catch {
        previewPayload = null;
      }

      const nextPreview = previewResponse.ok
        ? mapInvitationPreview(previewPayload)
        : null;
      const email = userData.user?.email ?? null;
      setPreview(nextPreview);

      const view = invitationAcceptView({
        token,
        preview: nextPreview,
        sessionEmail: email,
      });

      if (view.kind === "auto_accept") {
        setScreen({ kind: "accepting" });
        const nextScreen = await postAcceptInvitation(
          token,
          nextPreview,
          email
        );
        setScreen(nextScreen);
        if (nextScreen.kind === "success") {
          window.location.assign(nextScreen.tenantOrigin);
        }
        return;
      }

      setScreen(view);
    }

    void bootstrap();
  }, [token]);

  async function signOutAndContinue(returnTo: string) {
    if (busy) return;
    setBusy(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign(returnTo);
  }

  async function handleSignup(event: React.FormEvent) {
    event.preventDefault();
    if (!token || busy) return;
    if (password !== repeatPassword) {
      setFormError(PASSWORDS_DO_NOT_MATCH);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch("/api/invitations/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
        tenant_origin?: string;
      } | null;

      if (!response.ok) {
        if (payload?.code === "ACCOUNT_EXISTS" && preview) {
          setScreen(
            invitationAcceptView({
              token,
              preview: {
                ...preview,
                requires_login: true,
              },
              sessionEmail: null,
            })
          );
          setFormError(
            payload.error ?? "Ya tienes una cuenta. Inicia sesión para continuar."
          );
          return;
        }
        setFormError(payload?.error ?? "No se pudo activar el acceso.");
        return;
      }

      const tenantOrigin =
        typeof payload?.tenant_origin === "string"
          ? payload.tenant_origin
          : null;
      if (!tenantOrigin) {
        setFormError("No se pudo completar la invitación.");
        return;
      }

      window.location.assign(tenantOrigin);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    if (!token || !preview?.email || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithPassword({
        email: preview.email,
        password,
      });
      if (error) {
        setFormError("No se pudo iniciar sesión. Revisa la contraseña.");
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      setScreen({ kind: "accepting" });
      const nextScreen = await postAcceptInvitation(
        token,
        preview,
        user?.email ?? preview.email
      );
      setScreen(nextScreen);
      if (nextScreen.kind === "success") {
        window.location.assign(nextScreen.tenantOrigin);
      }
    } finally {
      setBusy(false);
    }
  }

  if (screen.kind === "loading" || screen.kind === "accepting") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {screen.kind === "accepting"
              ? "Aceptando invitación"
              : "Comprobando invitación"}
          </CardTitle>
          <CardDescription>Un momento…</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (screen.kind === "activate") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{ACTIVATE_ACCESS_TITLE}</CardTitle>
          <CardDescription>
            {invitationActivateDescription(screen.tenantName)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => void handleSignup(event)}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="invitation-email">{EMAIL_LABEL}</Label>
              <Input
                id="invitation-email"
                type="email"
                value={screen.email}
                readOnly
                autoComplete="username"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invitation-password">{PASSWORD_LABEL}</Label>
              <Input
                id="invitation-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invitation-repeat-password">
                {REPEAT_PASSWORD_LABEL}
              </Label>
              <Input
                id="invitation-repeat-password"
                type="password"
                required
                minLength={8}
                value={repeatPassword}
                onChange={(event) => setRepeatPassword(event.target.value)}
                autoComplete="new-password"
              />
            </div>
            {formError ? (
              <p className="text-sm text-red-500">{formError}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Activando acceso…" : ACTIVATE_ACCESS_AND_CONTINUE}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (screen.kind === "login") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{SIGN_IN_TITLE}</CardTitle>
          <CardDescription>
            {screen.tenantName
              ? `Entra con tu cuenta para unirte a ${screen.tenantName}.`
              : "Entra con tu cuenta para aceptar la invitación."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => void handleLogin(event)}
            className="grid gap-4"
          >
            <div className="grid gap-2">
              <Label htmlFor="invitation-login-email">{EMAIL_LABEL}</Label>
              <Input
                id="invitation-login-email"
                type="email"
                value={screen.email}
                readOnly
                autoComplete="username"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invitation-login-password">{PASSWORD_LABEL}</Label>
              <Input
                id="invitation-login-password"
                type="password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </div>
            {formError ? (
              <p className="text-sm text-red-500">{formError}</p>
            ) : null}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Entrando…" : SIGN_IN_TITLE}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  if (screen.kind === "wrong_account") {
    const copy = invitationWrongAccountCopy(
      screen.invitedEmail,
      screen.sessionEmail
    );
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{copy.title}</CardTitle>
          <CardDescription>{copy.description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            type="button"
            className="w-full"
            disabled={busy}
            onClick={() => void signOutAndContinue(screen.returnTo)}
          >
            {busy ? "Cerrando sesión…" : copy.action}
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (screen.kind === "success") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Invitación aceptada</CardTitle>
          <CardDescription>Redirigiendo a {screen.tenantName}…</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full">
            <a href={screen.tenantOrigin}>Ir ahora</a>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (screen.kind !== "error") {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">No se pudo aceptar</CardTitle>
        <CardDescription>{screen.message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="w-full">
          <Link href="/auth/login">Iniciar sesión</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
