"use client";

import { FormEvent, useEffect, useState } from "react";
import type { TeamMemberFormData } from "@/lib/team/types";

type TeamMemberFormProps = {
  title: string;
  initialValues: TeamMemberFormData;
  submitting?: boolean;
  error?: string | null;
  submitLabel?: string;
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
  onSubmit,
  onCancel,
}: TeamMemberFormProps) {
  const [form, setForm] = useState<TeamMemberFormData>(initialValues);

  useEffect(() => {
    setForm(initialValues);
  }, [initialValues]);

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
      <h2 className="text-lg font-semibold">{title}</h2>

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
        Rol
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

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.active}
          disabled={submitting}
          onChange={(event) => updateField("active", event.target.checked)}
        />
        Activo
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={form.can_receive_orders}
          disabled={submitting}
          onChange={(event) =>
            updateField("can_receive_orders", event.target.checked)
          }
        />
        Disponible para pedidos
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
