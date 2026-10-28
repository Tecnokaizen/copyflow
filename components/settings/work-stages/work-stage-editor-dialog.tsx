"use client";

import { FormEvent, useId, useState } from "react";

import { WorkStageIcon } from "@/components/orders/work-stage-icon";
import { Button } from "@/components/ui/button";
import { normalizeStageName } from "@/lib/orders/work-sequence/payload";
import { WORK_STAGE_NAME_MAX, type WorkStageDto } from "@/lib/orders/work-sequence/types";
import {
  WORK_STAGE_ICON_LABELS,
  WORK_STAGE_ICONS,
  isWorkStageIcon,
  type WorkStageIcon as WorkStageIconCode,
} from "@/lib/orders/work-stage-icons";
import { cn } from "@/lib/utils";

export type WorkStageEditorTarget = { mode: "create"; stage: null } | { mode: "edit"; stage: WorkStageDto };

export function WorkStageEditorDialog({
  target,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  target: WorkStageEditorTarget;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: { name: string; icon: WorkStageIconCode }) => void;
}) {
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState(target.stage?.name ?? "");
  const [icon, setIcon] = useState<WorkStageIconCode>(
    target.stage && isWorkStageIcon(target.stage.icon) ? target.stage.icon : "other"
  );
  const normalized = normalizeStageName(name);
  const nameValid = normalized.length >= 1 && normalized.length <= WORK_STAGE_NAME_MAX;
  const title = target.mode === "create" ? "Nueva fase" : "Editar fase";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!nameValid || saving) return;
    onSubmit({ name: normalized, icon });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !saving) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-5 shadow-lg sm:p-6"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          El nombre aparece en la secuencia de cada pedido. El icono ayuda a reconocer la fase de un vistazo.
        </p>

        <div className="mt-5 grid gap-4">
          <label htmlFor={nameId} className="grid gap-1.5 text-sm">
            Nombre *
            <input
              id={nameId}
              className="gc-field-control"
              value={name}
              maxLength={WORK_STAGE_NAME_MAX + 10}
              disabled={saving}
              autoFocus
              aria-invalid={(name.length > 0 && !nameValid) || undefined}
              onChange={(event) => setName(event.target.value)}
            />
            <span className={cn("text-xs", nameValid || !name ? "text-muted-foreground" : "text-destructive")}>
              {normalized.length} de {WORK_STAGE_NAME_MAX} caracteres
            </span>
          </label>

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-sm">Icono</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {WORK_STAGE_ICONS.map((code) => (
                <label
                  key={code}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                    icon === code ? "border-primary bg-primary/5 font-medium" : "border-border"
                  )}
                >
                  <input
                    type="radio"
                    name={`${titleId}-icon`}
                    value={code}
                    checked={icon === code}
                    disabled={saving}
                    className="sr-only"
                    onChange={() => setIcon(code)}
                  />
                  <WorkStageIcon icon={code} className="size-4 shrink-0" />
                  <span className="truncate">{WORK_STAGE_ICON_LABELS[code]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={saving} onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={saving || !nameValid}>
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </form>
    </div>
  );
}
