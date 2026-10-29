"use client";

import { useId, useState } from "react";

import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import type { AssignableMember, WorkStepDto } from "@/lib/orders/work-sequence/types";
import { personLabel, stageLabel } from "@/lib/orders/work-sequence/view";

/**
 * «Marcar hecho»: who did it. Defaults to the assigned person; the options are
 * the assignable people (the RPC rejects anyone else with member_unassignable).
 */
export function MarkStepDoneDialog({
  step,
  members,
  membersError,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  step: WorkStepDto;
  members: readonly AssignableMember[] | null;
  membersError: string | null;
  busy: boolean;
  error: string | null;
  onConfirm: (executedBy: string | null) => void;
  onCancel: () => void;
}) {
  const selectId = useId();
  const assigned = step.team_member;
  const [executor, setExecutor] = useState(assigned?.id ?? "");

  const options: AssignableMember[] = members ? [...members] : [];
  if (assigned && !options.some((member) => member.id === assigned.id)) {
    options.unshift({ id: assigned.id, name: members ? personLabel(assigned) : assigned.name });
  }

  return (
    <ConfirmDialog
      title={`Marcar «${stageLabel(step.stage)}» como hecho`}
      description={
        step.is_current
          ? "El turno pasará al siguiente paso sin hacer."
          : "Este paso no es el que toca ahora. Se marcará igualmente y el turno seguirá en el primer paso sin hacer."
      }
      confirmLabel="Marcar hecho"
      busy={busy}
      confirmDisabled={!executor}
      onConfirm={() => onConfirm(executor && executor !== assigned?.id ? executor : null)}
      onCancel={onCancel}
    >
      <label htmlFor={selectId} className="grid gap-1.5 text-sm">
        ¿Quién lo hizo?
        <select
          id={selectId}
          className="gc-field-control"
          value={executor}
          disabled={busy}
          onChange={(event) => setExecutor(event.target.value)}
        >
          {options.map((member) => (
            <option key={member.id} value={member.id}>
              {member.id === assigned?.id ? `${member.name} (asignada)` : member.name}
            </option>
          ))}
        </select>
      </label>
      {!members && !membersError ? (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          Cargando personal…
        </p>
      ) : null}
      {membersError ? <p className="mt-2 text-xs text-muted-foreground">{membersError}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </ConfirmDialog>
  );
}
