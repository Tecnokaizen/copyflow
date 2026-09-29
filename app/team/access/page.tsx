"use client";

import { useEffect, useState } from "react";
import { AccessPermissionsPanel } from "@/components/access/access-permissions-panel";
import { canManageTenantAccess } from "@/lib/auth/membership-roles";

export default function TeamAccessPage() {
  const [actorRole, setActorRole] = useState<string | null>(null);
  const [actorUserId, setActorUserId] = useState<string | null>(null);
  const [actorName, setActorName] = useState("Tú");
  const [organizationName, setOrganizationName] = useState("esta organización");
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
      const name =
        (typeof context?.user?.full_name === "string" &&
          context.user.full_name.trim()) ||
        (typeof context?.user?.email === "string" && context.user.email.trim()) ||
        "Tú";
      const organization =
        (typeof context?.tenant?.display_name === "string" &&
          context.tenant.display_name.trim()) ||
        (typeof context?.tenant?.name === "string" && context.tenant.name.trim()) ||
        "esta organización";
      setActorRole(role);
      setActorUserId(typeof context?.user?.id === "string" ? context.user.id : null);
      setActorName(name);
      setOrganizationName(organization);
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

  if (!allowed || !actorRole || !actorUserId) {
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

  return (
    <AccessPermissionsPanel
      actorRole={actorRole}
      actorUserId={actorUserId}
      actorName={actorName}
      organizationName={organizationName}
      onActorRoleChange={setActorRole}
    />
  );
}
