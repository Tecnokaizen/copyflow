"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import {
  PASSWORDS_DO_NOT_MATCH,
  authErrorMessage,
  isAuthSessionError,
} from "@/lib/auth/auth-messages";
import {
  authHrefWithNext,
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
import { useState } from "react";

type UpdatePasswordFormProps = React.ComponentPropsWithoutRef<"div"> & {
  /** Internal page to open once the password is saved. */
  nextPath?: string;
};

export function UpdatePasswordForm({
  className,
  nextPath,
  ...props
}: UpdatePasswordFormProps) {
  const [password, setPassword] = useState("");
  const [repeatPassword, setRepeatPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [sessionLost, setSessionLost] = useState(false);
  const destination = getPostAuthRedirectPath(nextPath);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSessionLost(false);

    if (password !== repeatPassword) {
      setError(PASSWORDS_DO_NOT_MATCH);
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setSaved(true);
      // Full navigation so the destination reads the session cookies on the
      // server. The recovery session stays open: the user is signed in.
      window.location.assign(destination);
    } catch (error: unknown) {
      setError(authErrorMessage(error, "update_password"));
      setSessionLost(isAuthSessionError(error));
      setIsLoading(false);
    }
  };

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Elige una contraseña nueva</CardTitle>
          <CardDescription>
            Escríbela dos veces. La usarás a partir de ahora para entrar en
            Gestcopy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {saved ? (
            <p className="text-sm text-muted-foreground" role="status">
              Contraseña actualizada. Entrando en Gestcopy…
            </p>
          ) : (
            <form onSubmit={handleUpdatePassword}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-2">
                  <Label htmlFor="password">Contraseña nueva</Label>
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
                  <Label htmlFor="repeat-password">Repite la contraseña</Label>
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
                    {sessionLost && (
                      <>
                        {" "}
                        <Link
                          href={authHrefWithNext(
                            "/auth/forgot-password",
                            destination
                          )}
                          className="underline underline-offset-4"
                        >
                          Pedir un enlace nuevo
                        </Link>
                      </>
                    )}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? "Guardando…" : "Guardar contraseña"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
