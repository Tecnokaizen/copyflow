"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { authErrorMessage } from "@/lib/auth/auth-messages";
import {
  authHrefWithNext,
  getPostAuthRedirectPath,
  isInvitationAcceptNext,
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
import { useState } from "react";

type LoginFormProps = React.ComponentPropsWithoutRef<"div"> & {
  nextPath?: string;
  /** Tenant hosts only offer account creation when continuing an invitation. */
  isTenantHost?: boolean;
};

export function LoginForm({
  className,
  nextPath,
  isTenantHost = false,
  ...props
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const safeNext = getPostAuthRedirectPath(nextPath);
  const invitationNext = isInvitationAcceptNext(nextPath) ? safeNext : null;
  const showSignUp = Boolean(invitationNext) || !isTenantHost;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // Full navigation so the next SSR/proxy request reads the new session cookies.
      // Soft SPA navigation can race and hit the destination without auth cookies.
      window.location.assign(safeNext);
    } catch (error: unknown) {
      setError(authErrorMessage(error, "login"));
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
          <CardDescription>
            Escribe tu correo y tu contraseña para entrar en Gestcopy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin}>
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
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="password">Contraseña</Label>
                  <Link
                    href={authHrefWithNext("/auth/forgot-password", safeNext)}
                    className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                  >
                    ¿Has olvidado tu contraseña?
                  </Link>
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {error && (
                <p className="text-sm text-[hsl(var(--gc-danger))]" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Entrando…" : "Iniciar sesión"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm text-muted-foreground">
              {showSignUp ? (
                <>
                  ¿No tienes cuenta?{" "}
                  <Link
                    href={authHrefWithNext(
                      "/auth/sign-up",
                      invitationNext ?? undefined
                    )}
                    className="text-foreground underline underline-offset-4"
                  >
                    Crear cuenta
                  </Link>
                </>
              ) : (
                <>
                  ¿No tienes acceso? Solicita una invitación al administrador.
                </>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
