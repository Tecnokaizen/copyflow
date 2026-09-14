"use client";

import { useMemo, useState } from "react";
import { TeamModal } from "@/components/team/team-modal";
import { membershipRoleLabel } from "@/lib/auth/membership-roles";
import {
  accessUsersAvailableForMember,
  type TeamAccessUser,
} from "@/lib/team/link";
import type { TeamMember } from "@/lib/team/types";

export function TeamMemberLinkModal({
  member,
  accessUsers,
  busy,
  error,
  onClose,
  onSave,
}: {
  member: TeamMember;
  accessUsers: TeamAccessUser[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (userId: string | null) => void;
}) {
  const options = useMemo(
    () => accessUsersAvailableForMember(accessUsers, member.id),
    [accessUsers, member.id]
  );
  const [userId, setUserId] = useState(member.user_id ?? "");
  const hasAssignedUser = Boolean(member.user_id);

  const current = accessUsers.find((user) => user.user_id === member.user_id);
  const currentName = current?.full_name?.trim() || null;

  return (
    <TeamModal>
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Asignar usuario a este trabajador
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Selecciona qué usuario de Gestcopy corresponde a este miembro del
            equipo.
          </p>
        </div>

        <dl className="space-y-4 rounded-md border border-border/70 bg-muted/30 px-4 py-3.5">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Trabajador
            </dt>
            <dd className="mt-1 text-sm font-medium text-foreground">
              {member.name}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Usuario asignado actualmente
            </dt>
            {current ? (
              <dd className="mt-1 space-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  {currentName || "Sin nombre"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {current.email ? `${current.email} · ` : ""}
                  {membershipRoleLabel(current.role)}
                </p>
              </dd>
            ) : (
              <dd className="mt-1 text-sm text-muted-foreground">
                Sin usuario asignado
              </dd>
            )}
          </div>
        </dl>

        <label className="grid gap-2 text-sm">
          <span className="font-medium">Usuario de Gestcopy</span>
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            disabled={busy}
            className="gc-field-control"
          >
            <option value="">Sin usuario asignado</option>
            {options.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {(user.full_name || user.email || "Sin nombre").trim()}
                {user.email ? ` · ${user.email}` : ""}
                {` · ${membershipRoleLabel(user.role)}`}
              </option>
            ))}
          </select>
        </label>

        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay usuarios disponibles. Invita a esta persona o quita la
            asignación de otro trabajador.
          </p>
        ) : null}

        {error ? (
          <p className="text-sm text-[hsl(var(--gc-danger))]">{error}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="gc-action"
            disabled={busy}
            onClick={onClose}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="gc-cta rounded-md px-4 py-2 text-sm font-semibold"
            disabled={busy}
            onClick={() => onSave(userId ? userId : null)}
          >
            {busy
              ? "Guardando…"
              : hasAssignedUser
                ? "Cambiar usuario"
                : "Asignar usuario"}
          </button>
        </div>
      </div>
    </TeamModal>
  );
}
