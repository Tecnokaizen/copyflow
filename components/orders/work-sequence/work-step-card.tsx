"use client";

import { AlertTriangle, Check, CheckCircle2, Circle, CircleDot, MoreHorizontal, RotateCcw, UserRound } from "lucide-react";

import { WorkStageIcon } from "@/components/orders/work-stage-icon";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { WorkStepDto } from "@/lib/orders/work-sequence/types";
import {
  doneSummary,
  markBlockedReason,
  personLabel,
  personUnavailable,
  STEP_STATE_LABELS,
  stageLabel,
  stepState,
} from "@/lib/orders/work-sequence/view";
import { cn } from "@/lib/utils";

const STATE_ICONS = {
  done: CheckCircle2,
  current: CircleDot,
  pending: Circle,
} as const;

export function WorkStepCard({
  step,
  editable,
  busy,
  layout,
  onMark,
  onUndo,
  onEdit,
}: {
  step: WorkStepDto;
  editable: boolean;
  busy: boolean;
  /** card: desktop row of cards; row: mobile vertical list. */
  layout: "card" | "row";
  onMark: (step: WorkStepDto) => void;
  onUndo: (step: WorkStepDto) => void;
  onEdit: () => void;
}) {
  const state = stepState(step);
  const StateIcon = STATE_ICONS[state];
  const blocked = markBlockedReason(step);
  const unavailable = personUnavailable(step.team_member);
  const stageOff = !step.done && step.stage !== null && !step.stage.active;
  const name = stageLabel(step.stage);
  const summary = step.done ? doneSummary(step) : null;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1 rounded-md border px-3 py-2 text-sm",
        layout === "card" ? "w-48" : "w-full",
        state === "current" && "border-primary bg-primary/5 ring-1 ring-primary/30",
        state === "done" && "border-border bg-muted/40",
        state === "pending" && "border-border bg-card"
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
          <WorkStageIcon icon={step.stage?.icon} className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate" title={name}>
            <span className="sr-only">Paso {step.position}: </span>
            {name}
          </span>
        </p>
        {editable ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-mr-2 -mt-1 size-8 shrink-0"
                disabled={busy}
                aria-label={`Acciones del paso «${name}»`}
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {step.done ? (
                <DropdownMenuItem onSelect={() => onUndo(step)}>
                  <RotateCcw aria-hidden="true" />
                  Deshacer
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled={Boolean(blocked)} onSelect={() => onMark(step)}>
                  <Check aria-hidden="true" />
                  Marcar hecho
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => onEdit()}>Editar secuencia</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      <p
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          unavailable ? "text-amber-800 dark:text-amber-300" : "text-muted-foreground"
        )}
      >
        <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate" title={personLabel(step.team_member)}>
          {personLabel(step.team_member)}
        </span>
      </p>

      <p
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold",
          state === "current" ? "text-primary" : state === "done" ? "text-foreground" : "text-muted-foreground"
        )}
      >
        <StateIcon className="size-3.5 shrink-0" aria-hidden="true" />
        {STEP_STATE_LABELS[state]}
      </p>

      {summary?.line ? (
        <p className="text-xs text-muted-foreground">
          {summary.line}
          {summary.marker ? <span className="block">({summary.marker})</span> : null}
        </p>
      ) : null}

      {stageOff ? (
        <p className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          Fase desactivada
        </p>
      ) : null}

      {state === "current" && editable ? (
        blocked ? (
          <p className="text-xs text-muted-foreground">{blocked}</p>
        ) : (
          <Button
            type="button"
            size="sm"
            className="mt-1 min-h-9 w-full"
            disabled={busy}
            onClick={() => onMark(step)}
          >
            <Check aria-hidden="true" />
            Marcar hecho
          </Button>
        )
      ) : null}
    </div>
  );
}
