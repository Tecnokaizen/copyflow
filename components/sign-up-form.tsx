"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  PASSWORDS_DO_NOT_MATCH,
  authErrorMessage,
} from "@/lib/auth/auth-messages";
import {
  authHrefWithNext,
  buildAuthConfirmUrl,
  getSafeNextPath,
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

type SignUpFormProps = React.ComponentPropsWithoutRef<"div"> & {
  nextPath?: string;
  /** Apex host may create a new organization via /onboarding. */
  allowOwnerSignup?: boolean;
};

export function SignUpForm({
  className,
  nextPath,
  allowOwnerSignup = false,
  ...props
}: SignUpFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const invitationNext = isInvitationAcceptNext(nextPath)
    ? getSafeNextPath(nextPath)
    : null;
  const safeNext = invitationNext
    ? invitationNext
    : allowOwnerSignup
      ? "/onboarding"
      : "/";

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    setIsLoading(true);
    setError(null);

    if (password !== repeatPassword) {
      setError(PASSWORDS_DO_NOT_MATCH);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: buildAuthConfirmUrl(
            window.location.origin,
            safeNext
          ),
        },
      });
      if (error) throw error;
      if (data.session) {
        window.location.assign(safeNext);
        return;
      }
      window.location.assign(authHrefWithNext("/auth/sign-up-success", safeNext));
    } catch (error: unknown) {
      setError(authErrorMessage(error, "sign_up"));
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Crear cuenta</CardTitle>
          <CardDescription>
            {invitationNext
              ? "Usa el mismo correo de la invitación para continuar."
              : "Crea tu cuenta para empezar a usar Gestcopy."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignUp}>
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
                </div>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <div className="flex items-center">
                  <Label htmlFor="repeat-password">Repite la contraseña</Label>
                </div>
                <Input
                  id="repeat-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={repeatPassword}
                  onChange={(e) => setRepeatPassword(e.target.value)}
                />
              </div>
              {error && (
                <p className="text-sm text-[hsl(var(--gc-danger))]" role="alert">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "Creando la cuenta…" : "Crear cuenta"}
              </Button>
            </div>
            <div className="mt-4 text-center text-sm">
              ¿Ya tienes cuenta?{" "}
              <Link
                href={authHrefWithNext(
                  "/auth/login",
                  invitationNext ?? undefined
                )}
                className="underline underline-offset-4"
              >
                Iniciar sesión
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
