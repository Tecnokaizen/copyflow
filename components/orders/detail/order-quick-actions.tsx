"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { isRichTextEmpty } from "@/lib/rich-text/html";
import { DraftSelect } from "@/components/orders/detail/order-field";
import { assigneeOptionsWithCurrent } from "@/lib/team/assignee-eligibility";
import {
  isSelectableStatus,
  statusOptionsWithCurrent,
} from "@/lib/orders/status-options";
import {
  ARCHIVE_CONFIRM_COPY,
  canShowArchiveAction,
  planStatusSave,
  type ConfirmCopy,
  type LifecycleStatusFlags,
} from "@/lib/orders/lifecycle-ux";
import type { OrderOption, OrderStatus } from "@/lib/orders/types";

type QuickPanel = "status" | "assignee" | "note" | null;

export function OrderQuickActions({
  busy,
  statuses,
  teamMembers,
  optionsLoading,
  currentStatusId,
  currentStatusName,
  currentAssigneeId,
  currentAssigneeName,
  archivedAt,
  currentStatus,
  onEdit,
  onSaveStatus,
  onSaveAssignee,
  onSaveNote,
  onNoteRequest,
  onArchive,
  compact = false,
}: {
  busy: boolean;
  statuses: OrderStatus[];
  teamMembers: OrderOption[];
  optionsLoading: boolean;
  currentStatusId: string;
  currentStatusName?: string | null;
  currentAssigneeId: string | null;
  currentAssigneeName?: string | null;
  archivedAt: string | null;
  currentStatus: LifecycleStatusFlags;
  onEdit: () => void;
  onSaveStatus: (statusId: string) => Promise<void>;
  onSaveAssignee: (memberId: string | null) => Promise<void>;
  onSaveNote: (note: string) => Promise<void>;
  /** SUR4 E6: with Post-its the button opens the Post-it composer instead. */
  onNoteRequest?: () => void;
  onArchive: () => Promise<void>;
  /** Order Detail Views V1: two columns on phones, same buttons. */
  compact?: boolean;
}) {
  const [panel, setPanel] = useState<QuickPanel>(null);
  const [statusId, setStatusId] = useState(currentStatusId);
  const [assigneeId, setAssigneeId] = useState(currentAssigneeId ?? "");
  const [note, setNote] = useState("");
  const [terminalConfirm, setTerminalConfirm] = useState<{
    statusId: string;
    copy: ConfirmCopy;
  } | null>(null);
  const [archiveConfirm, setArchiveConfirm] = useState(false);

  const showArchive = canShowArchiveAction({
    archived_at: archivedAt,
    status: currentStatus,
  });

  function closePanel() {
    if (busy) return;
    setPanel(null);
    setNote("");
  }

  function openStatus() {
    setStatusId(currentStatusId);
    setPanel("status");
  }

  function openAssignee() {
    setAssigneeId(currentAssigneeId ?? "");
    setPanel("assignee");
  }

  function openNote() {
    if (onNoteRequest) {
      onNoteRequest();
      return;
    }
    setNote("");
    setPanel("note");
  }

  async function confirmStatus(terminalConfirmed = false) {
    if (!statusId || statusId === currentStatusId) {
      closePanel();
      return;
    }

    const nextStatus = statuses.find((item) => item.id === statusId) ?? null;
    const plan = planStatusSave({
      currentStatusId,
      nextStatusId: statusId,
      nextStatus,
      terminalConfirmed,
    });

    if (plan.type === "noop") {
      closePanel();
      return;
    }

    if (plan.type === "require_terminal_confirm") {
      setPanel(null);
      setTerminalConfirm({ statusId: plan.statusId, copy: plan.copy });
      return;
    }

    await onSaveStatus(plan.statusId);
    setPanel(null);
    setTerminalConfirm(null);
  }

  async function confirmAssignee() {
    const next = assigneeId || null;
    if (next === currentAssigneeId) {
      closePanel();
      return;
    }
    await onSaveAssignee(next);
    setPanel(null);
  }

  async function confirmNote() {
    const trimmed = note.trim();
    if (!trimmed) return;
    await onSaveNote(trimmed);
    setNote("");
    setPanel(null);
  }

  async function confirmTerminal() {
    if (!terminalConfirm) return;
    await onSaveStatus(terminalConfirm.statusId);
    setTerminalConfirm(null);
  }

  async function confirmArchive() {
    await onArchive();
    setArchiveConfirm(false);
  }

  return (
    <>
      <div
        className={`grid w-full gap-2 sm:grid-cols-2 lg:flex lg:w-auto lg:flex-wrap lg:justify-end ${
          compact ? "grid-cols-2 [&>button]:px-2" : "grid-cols-1"
        }`}
      >
        <button
          type="button"
          disabled={busy}
          onClick={onEdit}
          className="gc-cta min-h-11 w-full lg:w-auto disabled:opacity-50"
        >
          Editar pedido
        </button>
        <button
          type="button"
          disabled={busy || !statuses.some(isSelectableStatus)}
          onClick={openStatus}
          className="gc-action min-h-11 w-full lg:w-auto"
        >
          Cambiar estado
        </button>
        <button
          type="button"
          disabled={busy || optionsLoading}
          onClick={openAssignee}
          className="gc-action min-h-11 w-full lg:w-auto"
        >
          Cambiar responsable
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={openNote}
          className="gc-action min-h-11 w-full lg:w-auto"
        >
          + Añadir nota
        </button>
        {showArchive ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => setArchiveConfirm(true)}
            className="gc-action min-h-11 w-full lg:w-auto"
          >
            Archivar pedido
          </button>
        ) : null}
      </div>

      {panel === "status" ? (
        <ConfirmDialog
          title="Cambiar estado"
          description="El cambio se guarda al confirmar."
          confirmLabel="Guardar estado"
          busy={busy}
          confirmDisabled={!statusId}
          onCancel={closePanel}
          onConfirm={() => void confirmStatus(false)}
        >
          <label className="block text-sm font-medium text-foreground">
            Estado
            <DraftSelect
              value={statusId}
              disabled={busy}
              className="mt-2 min-h-11 max-w-none text-base"
              onChange={setStatusId}
            >
              {statusOptionsWithCurrent(statuses, {
                id: currentStatusId,
                name: currentStatusName,
              }).map((status) => (
                <option key={status.id} value={status.id} disabled={status.unavailable}>
                  {status.name}
                </option>
              ))}
            </DraftSelect>
          </label>
        </ConfirmDialog>
      ) : null}

      {panel === "assignee" ? (
        <ConfirmDialog
          title="Cambiar responsable"
          description="El cambio se guarda al confirmar."
          confirmLabel="Guardar responsable"
          busy={busy}
          onCancel={closePanel}
          onConfirm={() => void confirmAssignee()}
        >
          <label className="block text-sm font-medium text-foreground">
            Responsable
            <DraftSelect
              value={assigneeId}
              disabled={busy || optionsLoading}
              className="mt-2 min-h-11 max-w-none text-base"
              onChange={setAssigneeId}
            >
              <option value="">— Sin responsable —</option>
              {assigneeOptionsWithCurrent(teamMembers, {
                id: currentAssigneeId,
                name: currentAssigneeName,
              }).map((member) => (
                <option key={member.id} value={member.id} disabled={member.unavailable}>
                  {member.name}
                </option>
              ))}
            </DraftSelect>
          </label>
        </ConfirmDialog>
      ) : null}

      {panel === "note" ? (
        <ConfirmDialog
          title="Añadir nota"
          description="Se añade a las notas internas y queda registrada en la actividad."
          confirmLabel="Guardar nota"
          busy={busy}
          confirmDisabled={isRichTextEmpty(note)}
          onCancel={closePanel}
          onConfirm={() => void confirmNote()}
        >
          <div className="grid gap-2 text-sm font-medium text-foreground">
            Nota
            <RichTextEditor
              ariaLabel="Nota"
              textStyles
              value={note}
              disabled={busy}
              onChange={setNote}
            />
          </div>
        </ConfirmDialog>
      ) : null}

      {terminalConfirm ? (
        <ConfirmDialog
          title={terminalConfirm.copy.title}
          description={terminalConfirm.copy.description}
          confirmLabel={terminalConfirm.copy.confirmLabel}
          destructive={
            terminalConfirm.copy.confirmLabel === "Confirmar cancelación"
          }
          busy={busy}
          onCancel={() => {
            if (busy) return;
            setTerminalConfirm(null);
          }}
          onConfirm={() => void confirmTerminal()}
        />
      ) : null}

      {archiveConfirm ? (
        <ConfirmDialog
          title={ARCHIVE_CONFIRM_COPY.title}
          description={ARCHIVE_CONFIRM_COPY.description}
          confirmLabel={ARCHIVE_CONFIRM_COPY.confirmLabel}
          busy={busy}
          onCancel={() => {
            if (busy) return;
            setArchiveConfirm(false);
          }}
          onConfirm={() => void confirmArchive()}
        />
      ) : null}
    </>
  );
}
