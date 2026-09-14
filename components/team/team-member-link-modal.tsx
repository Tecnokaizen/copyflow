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

  const current = accessUsers.find((user) => user.user_id === member.user_id);

  return (
    <TeamModal>
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Vincular acceso
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Asocia un usuario con acceso a <span className="font-medium text-foreground">{member.name}</span>.
            Un usuario solo puede estar vinculado a un perfil de equipo.
          </p>
        </div>

        {current ? (
          <p className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm">
            Ahora: {current.full_name || "Usuario"} ·{" "}
            {membershipRoleLabel(current.role)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Sin acceso</p>
        )}

        <label className="grid gap-2 text-sm">
          <span className="font-medium">Usuario con acceso</span>
          <select
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            disabled={busy}
            className="gc-field-control"
          >
            <option value="">Sin acceso</option>
            {options.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {(user.full_name || "Usuario").trim()} ·{" "}
                {membershipRoleLabel(user.role)}
              </option>
            ))}
          </select>
        </label>

        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay usuarios disponibles para vincular. Invita o activa un
            acceso primero, o quita el vínculo de otro perfil.
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
            {busy ? "Guardando…" : "Guardar vínculo"}
          </button>
        </div>
      </div>
    </TeamModal>
  );
}
