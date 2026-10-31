"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  RECOVERY_FAILURE_MESSAGES,
  authErrorMessage,
  type RecoveryFailure,
} from "@/lib/auth/auth-messages";
import {
  recoveryFailurePath,
  recoveryStateFromHash,
} from "@/lib/auth/recovery-callback";
import {
  authHrefWithNext,
  buildAuthRecoveryUrl,
  getPostAuthRedirectPath,
} from "@/lib/auth/safe-next-path";
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
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type ForgotPasswordFormProps = React.ComponentPropsWithoutRef<"div"> & {
  /** Internal page to open after the new password is saved. */
  nextPath?: string;
  /** Why the previous recovery link did not work, if the user came from one. */
  linkFailure?: RecoveryFailure | null;
};

export function ForgotPasswordForm({
  className,
  nextPath,
  linkFailure = null,
  ...props
}: ForgotPasswordFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const safeNext = getPostAuthRedirectPath(nextPath);
  const loginHref = authHrefWithNext("/auth/login", safeNext);

  // Supabase errors in the fragment never reach the server. Turn them into
  // `?error=` (the page then shows the message) and drop the fragment, so no
  // token or error stays in the address bar.
  useEffect(() => {
    const { failure, shouldClear } = recoveryStateFromHash(window.location.hash);
    if (failure && failure !== linkFailure) {
      router.replace(recoveryFailurePath(failure, safeNext), { scroll: false });
      return;
    }
    if (shouldClear) {
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`
      );
    }
  }, [linkFailure, router, safeNext]);

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      // The link opens /auth/recovery on this same host (tenant subdomain
      // included). Supabase must allow it in Auth → URL Configuration.
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: buildAuthRecoveryUrl(window.location.origin, safeNext),
      });
      if (error) throw error;
      setSuccess(true);
    } catch (error: unknown) {
      setError(authErrorMessage(error, "forgot_password"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      {success ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Revisa tu correo</CardTitle>
            <CardDescription>
              Te hemos enviado las instrucciones
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
            <p>
              Si existe una cuenta con ese correo, recibirás un enlace para
              elegir una contraseña nueva.
            </p>
            <p>
              Ábrelo en este mismo navegador. Por seguridad, el enlace caduca a
              los pocos minutos.
            </p>
            <Link
              href={loginHref}
              className="text-foreground underline underline-offset-4"
            >
              Volver a iniciar sesión
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">Recupera tu contraseña</CardTitle>
            <CardDescription>
              Escribe tu correo y te enviaremos un enlace para elegir una
              contraseña nueva.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {linkFailure && (
              <p
                className="mb-6 rounded-md border border-[hsl(var(--gc-danger)/0.35)] bg-[hsl(var(--gc-danger)/0.12)] p-3 text-sm text-[hsl(var(--gc-danger))]"
                role="alert"
                data-testid="recovery-link-failure"
              >
                {RECOVERY_FAILURE_MESSAGES[linkFailure]}
              </p>
            )}
            <form onSubmit={handleForgotPassword}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="email">Correo electrónico</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    placeholder="nombre@empresa.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                {error && (
                  <p className="text-sm text-[hsl(var(--gc-danger))]" role="alert">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Enviando…" : "Enviar enlace"}
                </Button>
              </div>
              <div className="mt-4 text-center text-sm">
                ¿Ya la recuerdas?{" "}
                <Link href={loginHref} className="underline underline-offset-4">
                  Iniciar sesión
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
