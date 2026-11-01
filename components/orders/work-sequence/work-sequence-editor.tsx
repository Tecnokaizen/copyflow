"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";

import { WorkStageIcon } from "@/components/orders/work-stage-icon";
import { Button } from "@/components/ui/button";
import { saveWorkSequence, type WorkSequenceWrite } from "@/lib/orders/work-sequence/client";
import {
  MAX_WORK_STEPS,
  type AssignableMember,
  type WorkStageDto,
  type WorkStepDto,
} from "@/lib/orders/work-sequence/types";
import {
  canAddEditorRow,
  DONE_ROW_LOCKED_HINT,
  editorErrorRow,
  editorRowsFromSteps,
  editorRowsToPayload,
  memberOptionsForRow,
  moveEditorRow,
  newEditorRow,
  removeEditorRow,
  rowPersonUnavailable,
  rowStageInactive,
  stageOptionsForRow,
  UNASSIGNED_LABEL,
  updateEditorRow,
  validateEditorRows,
  type EditorRow,
} from "@/lib/orders/work-sequence/view";
import { cn } from "@/lib/utils";

type SavedResult = Extract<WorkSequenceWrite, { ok: true }>;

function nextStageId(rows: readonly EditorRow[], stages: readonly WorkStageDto[]) {
  const used = new Set(rows.map((row) => row.stage_id));
  return stages.find((stage) => stage.active && !used.has(stage.id))?.id ?? stages.find((s) => s.active)?.id ?? "";
}

export function WorkSequenceEditor({
  orderId,
  orderVersion,
  steps,
  stages,
  members,
  membersError,
  onClose,
  onSaved,
  onConflict,
}: {
  orderId: string;
  orderVersion: string;
  steps: readonly WorkStepDto[];
  /** Active stages of the tenant. */
  stages: readonly WorkStageDto[];
  members: readonly AssignableMember[] | null;
  membersError: string | null;
  onClose: () => void;
  onSaved: (result: SavedResult) => void;
  onConflict: () => void;
}) {
  const titleId = useId();
  const keyCounter = useRef(0);
  const newKey = () => `new-${(keyCounter.current += 1)}`;
  const [rows, setRows] = useState<EditorRow[]>(() => {
    const existing = editorRowsFromSteps(steps);
    return existing.length > 0 ? existing : [newEditorRow("new-0", nextStageId([], stages))];
  });
  const [saving, setSaving] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const hasActiveStages = stages.some((stage) => stage.active);

  function change(next: EditorRow[]) {
    setRows(next);
    setRowErrors({});
    setFormError(null);
  }

  async function save() {
    if (saving) return;
    const invalid = validateEditorRows(rows);
    if (invalid) {
      if (invalid.index !== null) {
        setRowErrors({ [rows[invalid.index].key]: invalid.message });
      } else {
        setFormError(invalid.message);
      }
      return;
    }

    setSaving(true);
    setRowErrors({});
    setFormError(null);
    const result = await saveWorkSequence(orderId, orderVersion, editorRowsToPayload(rows));
    setSaving(false);

    if (result.ok) {
      onSaved(result);
      return;
    }
    const error = result.error;
    if (error.status === 409 && error.code === "conflict") {
      onConflict();
      return;
    }
    const rowIndex = editorErrorRow({ index: error.index, stepId: error.stepId }, rows);
    if (rowIndex !== null) {
      setRowErrors({ [rows[rowIndex].key]: error.message });
    } else {
      setFormError(error.message);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !saving) {
      event.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onKeyDown={onKeyDown}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[100dvh] w-full max-w-2xl flex-col rounded-t-[var(--radius)] border border-border bg-card shadow-lg sm:max-h-[calc(100dvh-2rem)] sm:rounded-[var(--radius)]"
      >
        <div className="border-b border-border px-4 py-4 sm:px-5">
          <h3 id={titleId} className="text-lg font-semibold tracking-tight">
            Editar secuencia
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Le toca al primer paso sin hacer. Máximo {MAX_WORK_STEPS} pasos; la persona es opcional mientras el paso
            está pendiente.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <ol className="space-y-3">
            {rows.map((row, index) => {
              const stageOptions = stageOptionsForRow(row, stages);
              const memberOptions = memberOptionsForRow(row, members ?? []);
              const stageOff = rowStageInactive(row, stages);
              const personOff = rowPersonUnavailable(row, members);
              const error = rowErrors[row.key];
              const stageSelectId = `${titleId}-stage-${row.key}`;
              const personSelectId = `${titleId}-person-${row.key}`;
              const icon = stages.find((stage) => stage.id === row.stage_id)?.icon ?? row.savedStage?.icon;
              return (
                <li
                  key={row.key}
                  className={cn(
                    "rounded-md border p-3",
                    error ? "border-destructive" : "border-border",
                    row.done && "bg-muted/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                      <WorkStageIcon icon={icon} className="size-4 shrink-0 text-muted-foreground" />
                      Paso {index + 1}
                      {row.done ? (
                        <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                          Hecho
                        </span>
                      ) : null}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={saving || index === 0}
                        aria-label={`Subir el paso ${index + 1}`}
                        onClick={() => change(moveEditorRow(rows, index, -1))}
                      >
                        <ArrowUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={saving || index === rows.length - 1}
                        aria-label={`Bajar el paso ${index + 1}`}
                        onClick={() => change(moveEditorRow(rows, index, 1))}
                      >
                        <ArrowDown aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={saving || row.done}
                        title={row.done ? DONE_ROW_LOCKED_HINT : undefined}
                        aria-label={`Quitar el paso ${index + 1}`}
                        onClick={() => change(removeEditorRow(rows, index))}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <label htmlFor={stageSelectId} className="grid min-w-0 gap-1 text-sm">
                      Fase
                      <select
                        id={stageSelectId}
                        className="gc-field-control w-full min-w-0"
                        value={row.stage_id}
                        disabled={saving || row.done}
                        aria-invalid={Boolean(error) || undefined}
                        onChange={(event) => change(updateEditorRow(rows, index, { stage_id: event.target.value }))}
                      >
                        <option value="" disabled>
                          Elige una fase
                        </option>
                        {stageOptions.map((option) => (
                          <option key={option.value} value={option.value} disabled={option.disabled}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label htmlFor={personSelectId} className="grid min-w-0 gap-1 text-sm">
                      Persona
                      <select
                        id={personSelectId}
                        className="gc-field-control w-full min-w-0"
                        value={row.team_member_id ?? ""}
                        disabled={saving || row.done}
                        onChange={(event) =>
                          change(updateEditorRow(rows, index, { team_member_id: event.target.value || null }))
                        }
                      >
                        <option value="">{UNASSIGNED_LABEL}</option>
                        {memberOptions.map((option) => (
                          <option key={option.value} value={option.value} disabled={option.disabled}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {row.done ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      {DONE_ROW_LOCKED_HINT}
                    </p>
                  ) : null}
                  {!row.done && stageOff ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      Esta fase está desactivada. El paso la conserva, pero no se puede volver a elegir.
                    </p>
                  ) : null}
                  {!row.done && personOff ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      Esta persona ya no puede recibir pedidos. Elige otra para poder marcar el paso.
                    </p>
                  ) : null}
                  {error ? (
                    <p className="mt-2 text-xs font-medium text-destructive" role="alert">
                      {error}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin pasos. Al guardar, el pedido se quedará sin secuencia.
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9"
              disabled={saving || !canAddEditorRow(rows) || !hasActiveStages}
              onClick={() => change([...rows, newEditorRow(newKey(), nextStageId(rows, stages))])}
            >
              <Plus aria-hidden="true" />
              Añadir paso
            </Button>
            {!canAddEditorRow(rows) ? (
              <span className="text-xs text-muted-foreground">Máximo {MAX_WORK_STEPS} pasos.</span>
            ) : null}
            {!hasActiveStages ? (
              <span className="text-xs text-muted-foreground">
                No hay fases activas. Créalas en Configuración → Fases de trabajo.
              </span>
            ) : null}
          </div>

          {membersError ? <p className="mt-3 text-xs text-muted-foreground">{membersError}</p> : null}
          {!members && !membersError ? (
            <p className="mt-3 text-xs text-muted-foreground" role="status">
              Cargando personal…
            </p>
          ) : null}
        </div>

        <div className="border-t border-border px-4 py-3 sm:px-5">
          {formError ? (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {formError}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full sm:w-auto"
              disabled={saving}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={saving} onClick={() => void save()}>
              {saving ? "Guardando…" : "Guardar secuencia"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
