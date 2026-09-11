"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { RoleBadge } from "@/components/gestcopy/role-badge";
import { SectionCard } from "@/components/gestcopy/section-card";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import type {
  AccessInvitation,
  AccessListResponse,
  AccessMembership,
} from "@/lib/access/types";
import {
  formatAccessDate,
  isInvitationVisuallyExpired,
  parseAccessListResponse,
  publicAccessUiError,
} from "@/lib/access/ui";
import {
  canManageMembershipTarget,
  invitableRolesForActor,
  membershipRoleDescription,
  membershipRoleLabel,
  membershipRoleRank,
  type InvitableRole,
} from "@/lib/auth/membership-roles";

type ModalState =
  | { kind: "closed" }
  | { kind: "invite" }
  | { kind: "change_role"; member: AccessMembership }
  | { kind: "revoke"; member: AccessMembership }
  | { kind: "reactivate"; member: AccessMembership }
  | { kind: "cancel_invite"; invitation: AccessInvitation };

export function AccessPermissionsPanel({ actorRole }: { actorRole: string }) {
  const [data, setData] = useState<AccessListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>({ kind: "closed" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<InvitableRole | "">("");
  const [changeRole, setChangeRole] = useState<InvitableRole | "">("");

  const assignableRoles = useMemo(
    () => invitableRolesForActor(actorRole),
    [actorRole]
  );

  const inviteEmailValid = isInviteEmailValid(inviteEmail);
  const canSubmitInvite =
    !busy && inviteEmailValid && Boolean(inviteRole);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) {
      setLoading(true);
    }
    setError(null);
    try {
      const response = await fetch("/api/team/access");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          publicAccessUiError(response.status, payload) ||
            "No se pudo cargar el acceso"
        );
      }
      const parsed = parseAccessListResponse(payload);
      if (!parsed) {
        throw new Error("Respuesta de acceso no válida");
      }
      setData(parsed);
    } catch (err) {
      setData(null);
      setError(
        err instanceof Error ? err.message : "No se pudo cargar el acceso"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void load({ silent: true });
    }, 0);
    return () => window.clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    if (!flash) return;
    const handle = window.setTimeout(() => setFlash(null), 4000);
    return () => window.clearTimeout(handle);
  }, [flash]);

  function openInvite() {
    setInviteEmail("");
    setInviteRole(assignableRoles[0] ?? "");
    setFormError(null);
    setModal({ kind: "invite" });
  }

  async function submitInvite() {
    if (!canSubmitInvite || !inviteRole) return;
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFormError(publicAccessUiError(response.status, payload));
        return;
      }
      setFlash(`Invitación enviada a ${inviteEmail.trim()}`);
      setModal({ kind: "closed" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function submitChangeRole() {
    if (modal.kind !== "change_role" || busy || !changeRole) return;
    const member = modal.member;
    if (
      membershipRoleRank(changeRole) < membershipRoleRank(member.role) &&
      !window.confirm(
        `Vas a reducir el rol de ${membershipRoleLabel(member.role)} a ${membershipRoleLabel(changeRole)}. ¿Continuar?`
      )
    ) {
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/team/access/${member.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "change_role", role: changeRole }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFormError(publicAccessUiError(response.status, payload));
        return;
      }
      setFlash("Rol actualizado correctamente.");
      setModal({ kind: "closed" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function submitSetActive(active: boolean) {
    if (
      (modal.kind !== "revoke" && modal.kind !== "reactivate") ||
      busy
    ) {
      return;
    }
    const member = modal.member;
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/team/access/${member.user_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set_active", active }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFormError(publicAccessUiError(response.status, payload));
        return;
      }
      setFlash(active ? "Acceso reactivado." : "Acceso revocado.");
      setModal({ kind: "closed" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function resendInvitation(invitation: AccessInvitation) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/team/invitations/${invitation.invitation_id}/resend`,
        { method: "POST" }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFlash(publicAccessUiError(response.status, payload));
        return;
      }
      setFlash(`Invitación reenviada a ${invitation.email}`);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvitation() {
    if (modal.kind !== "cancel_invite" || busy) return;
    setBusy(true);
    setFormError(null);
    try {
      const response = await fetch(
        `/api/team/invitations/${modal.invitation.invitation_id}`,
        { method: "DELETE" }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setFormError(publicAccessUiError(response.status, payload));
        return;
      }
      setFlash("Invitación cancelada.");
      setModal({ kind: "closed" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const memberships = data?.memberships ?? [];
  const invitations = data?.invitations ?? [];

  return (
    <>
      <PageHeader
        title="Usuarios y permisos"
        description="Gestiona quién puede acceder a esta organización y qué permisos tiene."
        actions={
          <Button
            type="button"
            onClick={openInvite}
            disabled={busy}
            className="gc-cta h-10 rounded-[var(--radius)] px-5 font-semibold"
          >
            + Invitar usuario
          </Button>
        }
      />

      {flash ? (
        <div className="mb-5 rounded-[var(--radius)] border border-primary/20 bg-primary/5 px-4 py-3.5 text-[0.9375rem] text-foreground">
          {flash}
        </div>
      ) : null}

      {error ? (
        <div className="mb-5 rounded-[var(--radius)] border border-[hsl(var(--gc-danger)/0.35)] bg-[hsl(var(--gc-danger)/0.12)] px-4 py-3.5 text-[0.9375rem] text-[hsl(var(--gc-danger))]">
          {error}
        </div>
      ) : null}

      <SectionCard
        title="Usuarios con acceso"
        description="Personas que pueden acceder actualmente a esta organización."
        bodyClassName="p-0"
      >
        {loading ? (
          <div className="space-y-3 p-6">
            <div className="h-11 animate-pulse rounded-md bg-muted" />
            <div className="h-11 animate-pulse rounded-md bg-muted" />
            <div className="h-11 animate-pulse rounded-md bg-muted" />
          </div>
        ) : memberships.length === 0 ? (
          <EmptyState title="No hay usuarios" />
        ) : (
          <>
            <div className="hidden md:block">
              <table className="gc-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {memberships.map((member) => (
                    <MembershipRowDesktop
                      key={member.user_id}
                      member={member}
                      actorRole={actorRole}
                      busy={busy}
                      onChangeRole={() => {
                        setChangeRole(
                          (invitableRolesForActor(actorRole).find(
                            (role) => role === member.role
                          ) ??
                            invitableRolesForActor(actorRole)[0] ??
                            "") as InvitableRole | ""
                        );
                        setFormError(null);
                        setModal({ kind: "change_role", member });
                      }}
                      onRevoke={() => {
                        setFormError(null);
                        setModal({ kind: "revoke", member });
                      }}
                      onReactivate={() => {
                        setFormError(null);
                        setModal({ kind: "reactivate", member });
                      }}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="space-y-3 p-5 md:hidden">
              {memberships.map((member) => (
                <MembershipCardMobile
                  key={member.user_id}
                  member={member}
                  actorRole={actorRole}
                  busy={busy}
                  onChangeRole={() => {
                    setChangeRole(
                      (invitableRolesForActor(actorRole)[0] ??
                        "") as InvitableRole | ""
                    );
                    setFormError(null);
                    setModal({ kind: "change_role", member });
                  }}
                  onRevoke={() => {
                    setFormError(null);
                    setModal({ kind: "revoke", member });
                  }}
                  onReactivate={() => {
                    setFormError(null);
                    setModal({ kind: "reactivate", member });
                  }}
                />
              ))}
            </div>
          </>
        )}
      </SectionCard>

      <div className="mt-8">
        <SectionCard
          title="Invitaciones pendientes"
          description="Invitaciones enviadas que todavía no han sido aceptadas."
          bodyClassName="p-0"
        >
          {loading ? (
            <div className="space-y-3 p-6">
              <div className="h-11 animate-pulse rounded-md bg-muted" />
            </div>
          ) : invitations.length === 0 ? (
            <EmptyState title="No hay invitaciones pendientes." />
          ) : (
            <>
              <div className="hidden md:block">
                <table className="gc-table">
                  <thead>
                    <tr>
                      <th>Email</th>
                      <th>Rol</th>
                      <th>Enviada</th>
                      <th>Caduca</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitations.map((invitation) => {
                      const expired = isInvitationVisuallyExpired(invitation);
                      return (
                        <tr key={invitation.invitation_id}>
                          <td className="font-medium">{invitation.email}</td>
                          <td>
                            <RoleBadge role={invitation.role} />
                          </td>
                          <td className="text-muted-foreground">
                            {formatAccessDate(
                              invitation.last_sent_at ?? invitation.created_at
                            )}
                          </td>
                          <td className="text-muted-foreground">
                            {formatAccessDate(invitation.expires_at)}
                          </td>
                          <td>
                            <StatusBadge tone={expired ? "warning" : "brand"}>
                              {expired ? "Caducada" : "Pendiente"}
                            </StatusBadge>
                          </td>
                          <td>
                            <div className="flex justify-end gap-2.5">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void resendInvitation(invitation)}
                                className="gc-action"
                              >
                                Reenviar
                              </button>
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  setModal({
                                    kind: "cancel_invite",
                                    invitation,
                                  })
                                }
                                className="gc-action-danger"
                              >
                                Cancelar
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="space-y-3 p-5 md:hidden">
                {invitations.map((invitation) => {
                  const expired = isInvitationVisuallyExpired(invitation);
                  return (
                    <div
                      key={invitation.invitation_id}
                      className="rounded-[var(--radius)] border border-border/70 bg-background p-5"
                    >
                      <p className="font-medium">{invitation.email}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <RoleBadge role={invitation.role} />
                        <StatusBadge tone={expired ? "warning" : "brand"}>
                          {expired ? "Caducada" : "Pendiente"}
                        </StatusBadge>
                      </div>
                      <p className="mt-3 text-[0.9375rem] text-muted-foreground">
                        Enviada{" "}
                        {formatAccessDate(
                          invitation.last_sent_at ?? invitation.created_at
                        )}{" "}
                        · Caduca {formatAccessDate(invitation.expires_at)}
                      </p>
                      <div className="mt-4 flex flex-wrap gap-2.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void resendInvitation(invitation)}
                          className="gc-action"
                        >
                          Reenviar
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            setModal({ kind: "cancel_invite", invitation })
                          }
                          className="gc-action-danger"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </SectionCard>
      </div>

      {modal.kind === "invite" ? (
        <AccessFormModal
          title="Invitar usuario"
          onClose={() => !busy && setModal({ kind: "closed" })}
        >
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="usuario@dominio.com"
                disabled={busy}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-role">Rol</Label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(event) =>
                  setInviteRole(event.target.value as InvitableRole)
                }
                disabled={busy}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {membershipRoleLabel(role)}
                  </option>
                ))}
              </select>
              {inviteRole ? (
                <p className="text-xs text-muted-foreground">
                  {membershipRoleDescription(inviteRole)}
                </p>
              ) : null}
            </div>
            <RoleHelpList roles={assignableRoles} />
            {formError ? (
              <p className="text-sm text-red-600">{formError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setModal({ kind: "closed" })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={!canSubmitInvite}
                onClick={() => void submitInvite()}
              >
                {busy ? "Enviando…" : "Enviar invitación"}
              </Button>
            </div>
          </div>
        </AccessFormModal>
      ) : null}

      {modal.kind === "change_role" ? (
        <AccessFormModal
          title="Cambiar rol"
          onClose={() => !busy && setModal({ kind: "closed" })}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {modal.member.full_name || modal.member.email || "Usuario"} ·{" "}
              {membershipRoleLabel(modal.member.role)}
            </p>
            <div className="grid gap-2">
              <Label htmlFor="change-role">Nuevo rol</Label>
              <select
                id="change-role"
                value={changeRole}
                onChange={(event) =>
                  setChangeRole(event.target.value as InvitableRole)
                }
                disabled={busy}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                {assignableRoles.map((role) => (
                  <option key={role} value={role}>
                    {membershipRoleLabel(role)}
                  </option>
                ))}
              </select>
            </div>
            {formError ? (
              <p className="text-sm text-red-600">{formError}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setModal({ kind: "closed" })}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={busy || !changeRole}
                onClick={() => void submitChangeRole()}
              >
                {busy ? "Guardando…" : "Guardar rol"}
              </Button>
            </div>
          </div>
        </AccessFormModal>
      ) : null}

      {modal.kind === "revoke" ? (
        <ConfirmDialog
          title="Revocar acceso"
          description="Este usuario dejará de poder acceder a esta organización. Sus datos de personal no se eliminarán."
          confirmLabel="Revocar acceso"
          destructive
          busy={busy}
          onCancel={() => setModal({ kind: "closed" })}
          onConfirm={() => void submitSetActive(false)}
        />
      ) : null}

      {modal.kind === "reactivate" ? (
        <ConfirmDialog
          title="Reactivar acceso"
          description="El usuario volverá a poder acceder a esta organización con su rol actual."
          confirmLabel="Reactivar"
          busy={busy}
          onCancel={() => setModal({ kind: "closed" })}
          onConfirm={() => void submitSetActive(true)}
        />
      ) : null}

      {modal.kind === "cancel_invite" ? (
        <ConfirmDialog
          title="Cancelar invitación"
          description={`Se cancelará la invitación pendiente de ${modal.invitation.email}.`}
          confirmLabel="Cancelar invitación"
          destructive
          busy={busy}
          onCancel={() => setModal({ kind: "closed" })}
          onConfirm={() => void cancelInvitation()}
        />
      ) : null}

      {formError &&
      (modal.kind === "revoke" ||
        modal.kind === "reactivate" ||
        modal.kind === "cancel_invite") ? (
        <div className="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-md border border-[hsl(var(--gc-danger)/0.35)] bg-card px-4 py-2 text-sm text-[hsl(var(--gc-danger))] shadow">
          {formError}
        </div>
      ) : null}
    </>
  );
}

function isInviteEmailValid(value: string) {
  const email = value.trim();
  if (!email) return false;
  // Practical UI gate; server still validates.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function RoleHelpList({ roles }: { roles: InvitableRole[] }) {
  return (
    <div className="rounded-[var(--radius)] border border-border/70 bg-secondary/50 p-4">
      <p className="text-sm font-medium text-foreground">Qué implica cada rol</p>
      <ul className="mt-3 space-y-2.5">
        {roles.map((role) => (
          <li key={role} className="text-[0.9375rem] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">
              {membershipRoleLabel(role)}:
            </span>{" "}
            {membershipRoleDescription(role)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AccessFormModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-5 shadow-lg"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Cerrar
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MembershipRowDesktop({
  member,
  actorRole,
  busy,
  onChangeRole,
  onRevoke,
  onReactivate,
}: {
  member: AccessMembership;
  actorRole: string;
  busy: boolean;
  onChangeRole: () => void;
  onRevoke: () => void;
  onReactivate: () => void;
}) {
  const manageable = canManageMembershipTarget(actorRole, member.role);
  return (
    <tr>
      <td className="font-medium">{member.full_name || "—"}</td>
      <td className="text-muted-foreground">{member.email || "—"}</td>
      <td>
        <RoleBadge role={member.role} />
      </td>
      <td>
        <StatusBadge tone={member.active ? "success" : "danger"}>
          {member.active ? "Activo" : "Acceso revocado"}
        </StatusBadge>
      </td>
      <td>
        {manageable ? (
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              disabled={busy}
              onClick={onChangeRole}
              className="gc-action"
            >
              Cambiar rol
            </button>
            {member.active ? (
              <button
                type="button"
                disabled={busy}
                onClick={onRevoke}
                className="gc-action-danger"
              >
                Revocar acceso
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={onReactivate}
                className="gc-action"
              >
                Reactivar acceso
              </button>
            )}
          </div>
        ) : (
          <span className="block text-right text-sm text-muted-foreground">
            —
          </span>
        )}
      </td>
    </tr>
  );
}

function MembershipCardMobile({
  member,
  actorRole,
  busy,
  onChangeRole,
  onRevoke,
  onReactivate,
}: {
  member: AccessMembership;
  actorRole: string;
  busy: boolean;
  onChangeRole: () => void;
  onRevoke: () => void;
  onReactivate: () => void;
}) {
  const manageable = canManageMembershipTarget(actorRole, member.role);
  return (
    <div className="rounded-[var(--radius)] border border-border/70 bg-background p-5">
      <p className="font-medium">{member.full_name || "Sin nombre"}</p>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">
        {member.email || "—"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <RoleBadge role={member.role} />
        <StatusBadge tone={member.active ? "success" : "danger"}>
          {member.active ? "Activo" : "Acceso revocado"}
        </StatusBadge>
      </div>
      {manageable ? (
        <div className="mt-4 flex flex-wrap gap-2.5">
          <button
            type="button"
            disabled={busy}
            onClick={onChangeRole}
            className="gc-action"
          >
            Cambiar rol
          </button>
          {member.active ? (
            <button
              type="button"
              disabled={busy}
              onClick={onRevoke}
              className="gc-action-danger"
            >
              Revocar acceso
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={onReactivate}
              className="gc-action"
            >
              Reactivar acceso
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
