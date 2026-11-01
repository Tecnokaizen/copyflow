"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, ListOrdered, Pencil } from "lucide-react";

import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { MarkStepDoneDialog } from "@/components/orders/work-sequence/mark-step-done-dialog";
import { useWorkSequencePresentation } from "@/components/orders/work-sequence/presentation";
import { useAssignableMembers } from "@/components/orders/work-sequence/use-assignable-members";
import { WorkSequenceEditor } from "@/components/orders/work-sequence/work-sequence-editor";
import { WorkStepCard } from "@/components/orders/work-sequence/work-step-card";
import { Button } from "@/components/ui/button";
import {
  fetchWorkSequence,
  setWorkStepDone,
  type WorkSequenceWrite,
} from "@/lib/orders/work-sequence/client";
import type { AssignableMember, WorkSequenceDto, WorkStepDto } from "@/lib/orders/work-sequence/types";
import { sequenceProgress, sequenceWarnings, stageLabel } from "@/lib/orders/work-sequence/view";
import { cn } from "@/lib/utils";

export type OrderWorkSequenceProps = {
  orderId: string;
  /** orders.row_version as the page knows it (Order.version). Sent as expected_version. */
  orderVersion: string;
  /** The page's own write permission (canWriteOrders). */
  canWrite: boolean;
  archived: boolean;
  /** Every write that changed the sequence bumps orders.row_version: adopt it. */
  onOrderVersionChange: (rowVersion: string) => void;
  /** Optional: assignable people the page already loaded (/api/orders/options team_members). */
  assignableMembers?: readonly AssignableMember[] | null;
  /** Optional: a save hit 409 conflict; the page should reload the order. */
  onOrderConflict?: () => void;
  className?: string;
};

type LoadState =
  | { status: "loading" }
  | { status: "hidden" }
  | { status: "error"; message: string }
  | { status: "ready"; data: WorkSequenceDto };

const CONFLICT_NOTICE = "El pedido ha cambiado; se ha recargado.";

/**
 * SUR4 E8 · «Secuencia de trabajo» strip of the order page. Fetches its own
 * data and renders nothing for a tenant without the feature or without
 * active stages (and no steps on this order).
 */
export function OrderWorkSequence({
  orderId,
  orderVersion,
  canWrite,
  archived,
  onOrderVersionChange,
  assignableMembers,
  onOrderConflict,
  className,
}: OrderWorkSequenceProps) {
  const headingId = useId();
  const { pendingFirstOnMobile } = useWorkSequencePresentation();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [marking, setMarking] = useState<WorkStepDto | null>(null);
  const [undoing, setUndoing] = useState<WorkStepDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const dataVersion = useRef<string | null>(null);
  const seenOrderVersion = useRef(orderVersion);
  const loadController = useRef<AbortController | null>(null);

  const { members, error: membersError } = useAssignableMembers(
    assignableMembers,
    editorOpen || marking !== null
  );

  const reload = useCallback(
    async (options: { silent?: boolean } = {}) => {
      loadController.current?.abort();
      const controller = new AbortController();
      loadController.current = controller;
      if (!options.silent) {
        setState((current) => (current.status === "ready" ? current : { status: "loading" }));
      }
      try {
        const result = await fetchWorkSequence(orderId, controller.signal);
        if (controller.signal.aborted) return;
        if (result.kind === "ok") {
          dataVersion.current = result.data.row_version;
          setState({ status: "ready", data: result.data });
        } else if (result.kind === "hidden") {
          setState({ status: "hidden" });
        } else {
          setState((current) =>
            options.silent && current.status === "ready" ? current : { status: "error", message: result.message }
          );
        }
      } catch {
        // Aborted by a newer load or by unmount.
      }
    },
    [orderId]
  );

  useEffect(() => {
    queueMicrotask(() => {
      void reload();
    });
    return () => loadController.current?.abort();
  }, [reload]);

  // The page's version moved (live refresh, another person): refresh quietly
  // unless it is the version this strip already shows.
  useEffect(() => {
    if (seenOrderVersion.current === orderVersion) return;
    seenOrderVersion.current = orderVersion;
    if (dataVersion.current !== null && dataVersion.current !== orderVersion) {
      queueMicrotask(() => {
        void reload({ silent: true });
      });
    }
  }, [orderVersion, reload]);

  function applyWrite(result: Extract<WorkSequenceWrite, { ok: true }>) {
    dataVersion.current = result.rowVersion;
    if (result.changed) {
      seenOrderVersion.current = result.rowVersion;
      onOrderVersionChange(result.rowVersion);
    }
    if (result.data) {
      setState({ status: "ready", data: result.data });
    } else {
      void reload({ silent: true });
    }
  }

  function handleConflict() {
    setEditorOpen(false);
    setNotice(CONFLICT_NOTICE);
    void reload({ silent: true });
    onOrderConflict?.();
  }

  async function markDone(step: WorkStepDto, executedBy: string | null) {
    if (busy) return;
    setBusy(true);
    setDialogError(null);
    const result = await setWorkStepDone(orderId, step.id, true, executedBy);
    setBusy(false);
    if (result.ok) {
      setMarking(null);
      setNotice(null);
      applyWrite(result);
      return;
    }
    if (result.error.status === 422) {
      setDialogError(result.error.message);
      return;
    }
    setMarking(null);
    setNotice(result.error.message);
    void reload({ silent: true });
  }

  async function undo(step: WorkStepDto) {
    if (busy) return;
    setBusy(true);
    const result = await setWorkStepDone(orderId, step.id, false);
    setBusy(false);
    setUndoing(null);
    if (result.ok) {
      setNotice(null);
      applyWrite(result);
      return;
    }
    setNotice(result.error.message);
    void reload({ silent: true });
  }

  if (state.status === "loading" || state.status === "hidden") {
    return null;
  }

  if (state.status === "error") {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-[var(--radius)] border border-border bg-card px-4 py-3 text-sm",
          className
        )}
        role="status"
      >
        <span className="text-muted-foreground">{state.message}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
          Reintentar
        </Button>
      </div>
    );
  }

  const { data } = state;
  const editable = canWrite && !archived && data.can_edit;
  const steps = data.steps;

  const editor = editorOpen ? (
    <WorkSequenceEditor
      orderId={orderId}
      orderVersion={orderVersion}
      steps={steps}
      stages={data.stages}
      members={members}
      membersError={membersError}
      onClose={() => setEditorOpen(false)}
      onSaved={(result) => {
        setEditorOpen(false);
        setNotice(null);
        applyWrite(result);
      }}
      onConflict={handleConflict}
    />
  ) : null;

  if (steps.length === 0) {
    if (data.stages.length === 0 || !editable) {
      return null;
    }
    return (
      <div className={cn("flex flex-wrap items-center gap-2", className)}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-9 text-muted-foreground"
          onClick={() => {
            setNotice(null);
            setEditorOpen(true);
          }}
        >
          <ListOrdered aria-hidden="true" />
          Añadir secuencia
        </Button>
        {notice ? (
          <span className="text-sm text-muted-foreground" role="status">
            {notice}
          </span>
        ) : null}
        {editor}
      </div>
    );
  }

  const progress = sequenceProgress(steps);
  const warnings = sequenceWarnings(steps);
  const openEditor = () => {
    setNotice(null);
    setEditorOpen(true);
  };
  const cardProps = {
    editable,
    busy,
    onMark: (step: WorkStepDto) => {
      setDialogError(null);
      setMarking(step);
    },
    onUndo: (step: WorkStepDto) => setUndoing(step),
    onEdit: openEditor,
  };

  return (
    <section
      aria-labelledby={headingId}
      className={cn("rounded-[var(--radius)] border border-border bg-card px-4 py-3", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-sm font-semibold text-foreground">
          Secuencia de trabajo
          <span className="ml-2 font-normal text-muted-foreground">
            {progress.done} de {progress.total} hechos
          </span>
        </h2>
        {editable ? (
          <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={openEditor}>
            <Pencil aria-hidden="true" />
            Editar secuencia
          </Button>
        ) : null}
      </div>

      {notice ? (
        <p className="mt-2 text-sm text-foreground" role="status">
          {notice}
        </p>
      ) : null}

      {warnings.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {warnings.map((warning) => (
            <li
              key={`${warning.kind}-${warning.stepId}`}
              className="flex items-start gap-1.5 text-sm text-amber-800 dark:text-amber-300"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Desktop: cards in a row with arrows. */}
      <ol className="mt-3 hidden flex-wrap items-stretch gap-2 sm:flex">
        {steps.map((step, index) => (
          <li key={step.id} className="flex items-stretch gap-2">
            {index > 0 ? (
              <ArrowRight className="size-4 shrink-0 self-center text-muted-foreground" aria-hidden="true" />
            ) : null}
            <WorkStepCard step={step} layout="card" {...cardProps} />
          </li>
        ))}
      </ol>

      {/* Order Detail Views V1 (view C, phones): done steps fold into one
          line so the pending work and «Le toca» come first. */}
      {pendingFirstOnMobile && progress.done > 0 && progress.done < steps.length ? (
        <details className="mt-3 sm:hidden" data-done-steps>
          <summary className="flex min-h-9 cursor-pointer items-center text-sm text-muted-foreground underline-offset-4 hover:underline">
            {progress.done === 1 ? "1 paso hecho" : `${progress.done} pasos hechos`}
          </summary>
          <ol className="ml-1.5 mt-2 space-y-3 border-l-2 border-border pl-4">
            {steps
              .filter((step) => step.done)
              .map((step) => (
                <li key={step.id} className="relative">
                  <span
                    aria-hidden="true"
                    className="absolute -left-[1.4rem] top-3 size-3 rounded-full border-2 border-foreground bg-foreground"
                  />
                  <WorkStepCard step={step} layout="row" {...cardProps} />
                </li>
              ))}
          </ol>
        </details>
      ) : null}

      {/* Mobile: vertical list with the line of steps on the left. */}
      <ol className="ml-1.5 mt-3 space-y-3 border-l-2 border-border pl-4 sm:hidden">
        {steps
          .filter(
            (step) =>
              !(pendingFirstOnMobile && step.done && progress.done < steps.length)
          )
          .map((step) => (
          <li key={step.id} className="relative">
            <span
              aria-hidden="true"
              className={cn(
                "absolute -left-[1.4rem] top-3 size-3 rounded-full border-2",
                step.done
                  ? "border-foreground bg-foreground"
                  : step.is_current
                    ? "border-primary bg-primary"
                    : "border-border bg-card"
              )}
            />
            <WorkStepCard step={step} layout="row" {...cardProps} />
          </li>
        ))}
      </ol>

      {marking ? (
        <MarkStepDoneDialog
          key={marking.id}
          step={marking}
          members={members}
          membersError={membersError}
          busy={busy}
          error={dialogError}
          onConfirm={(executedBy) => void markDone(marking, executedBy)}
          onCancel={() => {
            if (!busy) {
              setMarking(null);
              setDialogError(null);
            }
          }}
        />
      ) : null}

      {undoing ? (
        <ConfirmDialog
          title={`Deshacer «${stageLabel(undoing.stage)}»`}
          description="Se borrará quién lo hizo y cuándo. Podrás volver a marcarlo como hecho."
          confirmLabel="Deshacer"
          busy={busy}
          onConfirm={() => void undo(undoing)}
          onCancel={() => {
            if (!busy) setUndoing(null);
          }}
        />
      ) : null}

      {editor}
    </section>
  );
}
