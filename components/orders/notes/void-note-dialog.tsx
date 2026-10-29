"use client";

import { useId, useState } from "react";

import { NotesDialog } from "@/components/orders/notes/notes-dialog";
import { NoteInlineMessage, PersonalDataNotice } from "@/components/orders/notes/note-parts";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NOTE_MAX_REASON_LENGTH } from "@/lib/orders/notes/types";

/** Voiding is final and needs a reason; the reason is warned about personal data while typing (N22). */
export function VoidNoteDialog({
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const fieldId = useId();
  const trimmed = reason.trim();
  const tooLong = trimmed.length > NOTE_MAX_REASON_LENGTH;

  return (
    <NotesDialog
      title="Anular la nota"
      description="La nota no se borra: queda en el historial y se ve con «Mostrar anuladas». Una nota anulada ya no se puede reabrir."
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="min-h-11 w-full sm:w-auto">
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => onConfirm(trimmed)}
            disabled={busy || !trimmed || tooLong}
            className="min-h-11 w-full sm:w-auto"
          >
            {busy ? "Anulando…" : "Anular nota"}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor={fieldId}>Motivo (obligatorio)</Label>
        <textarea
          id={fieldId}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={NOTE_MAX_REASON_LENGTH + 50}
          rows={3}
          aria-invalid={tooLong}
          aria-describedby={`${fieldId}-hint`}
          className="w-full min-w-0 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          placeholder="Por ejemplo: duplicada, ya no aplica…"
        />
        <p id={`${fieldId}-hint`} className={tooLong ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          {trimmed.length}/{NOTE_MAX_REASON_LENGTH}. No escribas datos personales en el motivo.
        </p>
        <PersonalDataNotice text={reason} context="El motivo queda en el historial." />
        {error ? <NoteInlineMessage tone="error">{error}</NoteInlineMessage> : null}
      </div>
    </NotesDialog>
  );
}
