"use client";

import { useId, useState } from "react";
import { AlertTriangle } from "lucide-react";

import { NotesDialog } from "@/components/orders/notes/notes-dialog";
import { NOTE_RADIO_CLASS, NoteInlineMessage } from "@/components/orders/notes/note-parts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatNoteDate, noteEventLabel } from "@/lib/orders/notes/format";
import { detectPersonalData, personalDataWarning } from "@/lib/orders/notes/pii";
import {
  NOTE_REDACT_REASON_CODES,
  NOTE_REDACT_REASON_LABELS,
  type NoteHistoryEvent,
  type NoteRedactReasonCode,
} from "@/lib/orders/notes/types";

/**
 * N22 «Suprimir texto», owner only. Irreversible: empties every version of
 * the note and leaves it voided and internal. The reason comes from a closed
 * list (no free text). Reasons of the note's events are kept unless the owner
 * flags them; the detector only marks the ones that look personal.
 */
export function RedactNoteDialog({
  events,
  alreadyRedacted,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  events: NoteHistoryEvent[];
  alreadyRedacted: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: (input: { reasonCode: NoteRedactReasonCode; eventIds: string[] }) => void;
  onCancel: () => void;
}) {
  const groupId = useId();
  const [reasonCode, setReasonCode] = useState<NoteRedactReasonCode | null>(null);
  const [flagged, setFlagged] = useState<string[]>([]);
  const [understood, setUnderstood] = useState(false);
  const withReason = events.filter((event) => event.reason !== null);
  const nothingNew = alreadyRedacted && flagged.length === 0;

  function toggle(eventId: string, checked: boolean) {
    setFlagged((current) => (checked ? [...current, eventId] : current.filter((id) => id !== eventId)));
  }

  return (
    <NotesDialog
      title="Suprimir el texto de la nota"
      wide
      busy={busy}
      onClose={onCancel}
      description={
        alreadyRedacted
          ? "El texto ya está suprimido. Puedes señalar motivos que contengan un dato personal."
          : "Para borrar un dato personal que no debía estar en la nota."
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="min-h-11 w-full sm:w-auto">
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || !reasonCode || !understood || nothingNew}
            onClick={() => reasonCode && onConfirm({ reasonCode, eventIds: flagged })}
            className="min-h-11 w-full sm:w-auto"
          >
            {busy ? "Suprimiendo…" : "Suprimir texto"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div
          role="note"
          className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground"
        >
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p className="min-w-0">
            <strong className="font-semibold">No se puede deshacer.</strong> Se borra el texto de todas las versiones
            de la nota, que queda anulada e interna. El historial conserva quién hizo cada cambio y cuándo, sin el
            texto. Las copias de seguridad guardan el texto hasta que caducan.
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Motivo de la supresión</legend>
          {NOTE_REDACT_REASON_CODES.map((code) => (
            <label key={code} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
              <input
                type="radio"
                name={`${groupId}-reason`}
                value={code}
                checked={reasonCode === code}
                onChange={() => setReasonCode(code)}
                className={NOTE_RADIO_CLASS}
              />
              {NOTE_REDACT_REASON_LABELS[code]}
            </label>
          ))}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Motivos escritos en la nota</legend>
          {withReason.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta nota no tiene motivos escritos.</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                Se conservan como auditoría. Señala solo los que contengan un dato personal: pasarán a «[motivo
                suprimido]».
              </p>
              <ul className="space-y-2">
                {withReason.map((event) => {
                  const warning = event.reason_redacted ? null : personalDataWarning(detectPersonalData(event.reason));
                  const checkboxId = `${groupId}-${event.id}`;
                  return (
                    <li key={event.id} className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
                      <Checkbox
                        id={checkboxId}
                        className="mt-0.5"
                        disabled={event.reason_redacted || busy}
                        checked={event.reason_redacted || flagged.includes(event.id)}
                        onCheckedChange={(checked) => toggle(event.id, checked === true)}
                        aria-label="Contiene un dato personal"
                      />
                      <label htmlFor={checkboxId} className="min-w-0 flex-1 text-sm">
                        <span className="block break-words">
                          {event.reason_redacted ? <em className="text-muted-foreground">[motivo suprimido]</em> : event.reason}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {event.actor_name} {noteEventLabel(event.action)} · {formatNoteDate(event.created_at)}
                        </span>
                        {warning ? (
                          <span className="mt-1 flex items-center gap-1 text-xs font-medium text-[hsl(var(--gc-warning))]">
                            <AlertTriangle aria-hidden className="size-3.5" />
                            Posible dato personal. {warning}
                          </span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </fieldset>

        <label className="flex cursor-pointer items-start gap-3 text-sm">
          <Checkbox
            className="mt-0.5"
            checked={understood}
            disabled={busy}
            onCheckedChange={(checked) => setUnderstood(checked === true)}
          />
          <span>Entiendo que el texto se borra de todas las versiones y que no se puede recuperar.</span>
        </label>

        {nothingNew && reasonCode && understood ? (
          <NoteInlineMessage tone="info">El texto ya está suprimido: señala algún motivo para continuar.</NoteInlineMessage>
        ) : null}
        {error ? <NoteInlineMessage tone="error">{error}</NoteInlineMessage> : null}
      </div>
    </NotesDialog>
  );
}
