"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { Button, type ButtonProps } from "@/components/ui/button";

export function LogoutButton({
  className,
  variant = "ghost",
  size = "sm",
  ...props
}: Omit<ButtonProps, "onClick" | "type">) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    if (isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signOutError } = await supabase.auth.signOut();

    if (signOutError) {
      setError("No se pudo cerrar la sesión.");
      setIsLoading(false);
      return;
    }

    router.push("/auth/login");
    router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        {...props}
        disabled={isLoading || props.disabled}
        onClick={logout}
      >
        {isLoading ? "Cerrando sesión..." : "Cerrar sesión"}
      </Button>
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
    </span>
  );
}
