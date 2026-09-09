"use client";

import { useEffect, useState } from "react";
import { AccessPermissionsPanel } from "@/components/access/access-permissions-panel";
import { canManageTenantAccess } from "@/lib/auth/membership-roles";

export default function TeamAccessPage() {
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    async function load() {
      const response = await fetch("/api/context");
      if (!response.ok) {
        setAllowed(false);
        return;
      }
      const context = await response.json();
      const role = context?.membership?.role ?? null;
      setActorRole(role);
      setAllowed(canManageTenantAccess(role));
    }
    void load();
  }, []);

  if (allowed === null) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-64 animate-pulse rounded-md bg-muted" />
        <div className="h-40 animate-pulse rounded-[var(--radius)] bg-muted" />
      </div>
    );
  }

  if (!allowed || !actorRole) {
    return (
      <div className="gc-card px-5 py-10 text-center">
        <h1 className="text-xl font-semibold">Acceso restringido</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Solo el propietario y los administradores pueden gestionar usuarios y
          permisos.
        </p>
      </div>
    );
  }

  return <AccessPermissionsPanel actorRole={actorRole} />;
}
