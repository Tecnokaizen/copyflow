"use client";

import { FormEvent, useState } from "react";
import { membershipRoleLabel } from "@/lib/auth/membership-roles";
import {
  accessUsersAvailableForMember,
  type TeamAccessUser,
} from "@/lib/team/link";
import type { TeamMemberFormData } from "@/lib/team/types";

type TeamMemberFormProps = {
  title: string;
  initialValues: TeamMemberFormData;
  submitting?: boolean;
  error?: string | null;
  submitLabel?: string;
  accessUsers?: TeamAccessUser[];
  memberId?: string | null;
  showUserSelect?: boolean;
  lockUserId?: boolean;
  onSubmit: (data: TeamMemberFormData) => void;
  onCancel: () => void;
};

const fieldClassName =
  "rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50";

export function TeamMemberForm({
  title,
  initialValues,
  submitting = false,
  error,
  submitLabel = "Guardar",
  accessUsers = [],
  memberId = null,
  showUserSelect = true,
  lockUserId = false,
  onSubmit,
  onCancel,
}: TeamMemberFormProps) {
  const [form, setForm] = useState<TeamMemberFormData>(initialValues);
  const [prevInitialValues, setPrevInitialValues] = useState(initialValues);

  if (initialValues !== prevInitialValues) {
    setPrevInitialValues(initialValues);
    setForm(initialValues);
  }

  const userOptions = accessUsersAvailableForMember(accessUsers, memberId);

  function updateField<K extends keyof TeamMemberFormData>(
    field: K,
    value: TeamMemberFormData[K]
  ) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();

    if (submitting || form.name.trim() === "") {
      return;
    }

    onSubmit(form);
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      {title ? <h2 className="text-lg font-semibold">{title}</h2> : null}

      <label className="grid gap-1 text-sm">
        Nombre *
        <input
          type="text"
          value={form.name}
          disabled={submitting}
          onChange={(event) => updateField("name", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Puesto
        <input
          type="text"
          value={form.job_title}
          disabled={submitting}
          onChange={(event) => updateField("job_title", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Área
        <input
          type="text"
          value={form.department}
          disabled={submitting}
          onChange={(event) => updateField("department", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Email
        <input
          type="email"
          value={form.email}
          disabled={submitting}
          onChange={(event) => updateField("email", event.target.value)}
          className={fieldClassName}
        />
      </label>

      <label className="grid gap-1 text-sm">
        Teléfono
        <input
          type="tel"
          value={form.phone}
          disabled={submitting}
          onChange={(event) => updateField("phone", event.target.value)}
          className={fieldClassName}
        />
      </label>

      {showUserSelect ? (
        <label className="grid gap-1 text-sm">
          Usuario de Gestcopy
          <select
            value={form.user_id}
            disabled={submitting || lockUserId}
            onChange={(event) => updateField("user_id", event.target.value)}
            className={fieldClassName}
          >
            <option value="">Sin usuario asignado</option>
            {userOptions.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {(user.full_name || user.email || "Sin nombre").trim()}
                {user.email ? ` · ${user.email}` : ""}
                {` · ${membershipRoleLabel(user.role)}`}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            Opcional. Así Gestcopy sabrá qué usuario corresponde a este miembro
            del equipo.
          </span>
        </label>
      ) : null}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.can_receive_orders}
          disabled={submitting}
          onChange={(event) =>
            updateField("can_receive_orders", event.target.checked)
          }
        />
        Puede recibir pedidos
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.active}
          disabled={submitting}
          onChange={(event) => updateField("active", event.target.checked)}
        />
        Activo
      </label>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={submitting}
          onClick={onCancel}
          className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={submitting || form.name.trim() === ""}
          className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
        >
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
