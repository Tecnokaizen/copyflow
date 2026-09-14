"use client";

import { useState } from "react";
import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import {
  DraftSelect,
  DraftTextarea,
} from "@/components/orders/detail/order-field";
import type { OrderOption, OrderStatus } from "@/lib/orders/types";

type QuickPanel = "status" | "assignee" | "note" | null;

export function OrderQuickActions({
  busy,
  statuses,
  teamMembers,
  optionsLoading,
  currentStatusId,
  currentAssigneeId,
  onEdit,
  onSaveStatus,
  onSaveAssignee,
  onSaveNote,
}: {
  busy: boolean;
  statuses: OrderStatus[];
  teamMembers: OrderOption[];
  optionsLoading: boolean;
  currentStatusId: string;
  currentAssigneeId: string | null;
  onEdit: () => void;
  onSaveStatus: (statusId: string) => Promise<void>;
  onSaveAssignee: (memberId: string | null) => Promise<void>;
  onSaveNote: (note: string) => Promise<void>;
}) {
  const [panel, setPanel] = useState<QuickPanel>(null);
  const [statusId, setStatusId] = useState(currentStatusId);
  const [assigneeId, setAssigneeId] = useState(currentAssigneeId ?? "");
  const [note, setNote] = useState("");

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
    setNote("");
    setPanel("note");
  }

  async function confirmStatus() {
    if (!statusId || statusId === currentStatusId) {
      closePanel();
      return;
    }
    await onSaveStatus(statusId);
    setPanel(null);
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

  return (
    <>
      <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:w-auto lg:flex-wrap lg:justify-end">
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
          disabled={busy || statuses.length === 0}
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
      </div>

      {panel === "status" ? (
        <ConfirmDialog
          title="Cambiar estado"
          description="El cambio se guarda al confirmar."
          confirmLabel="Guardar estado"
          busy={busy}
          confirmDisabled={!statusId}
          onCancel={closePanel}
          onConfirm={() => void confirmStatus()}
        >
          <label className="block text-sm font-medium text-foreground">
            Estado
            <DraftSelect
              value={statusId}
              disabled={busy}
              className="mt-2 min-h-11 max-w-none text-base"
              onChange={setStatusId}
            >
              {statuses.map((status) => (
                <option key={status.id} value={status.id}>
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
              {teamMembers.map((member) => (
                <option key={member.id} value={member.id}>
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
          confirmDisabled={!note.trim()}
          onCancel={closePanel}
          onConfirm={() => void confirmNote()}
        >
          <label className="block text-sm font-medium text-foreground">
            Nota
            <DraftTextarea
              value={note}
              disabled={busy}
              rows={4}
              className="mt-2 min-h-24 text-base"
              onChange={setNote}
            />
          </label>
        </ConfirmDialog>
      ) : null}
    </>
  );
}
