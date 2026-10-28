"use client";

import { useCallback, useEffect, useState } from "react";
import { Eraser } from "lucide-react";

import { NotesDialog } from "@/components/orders/notes/notes-dialog";
import { NoteInlineMessage, NoteStateBadge, NoteVisibilityBadge } from "@/components/orders/notes/note-parts";
import { RedactNoteDialog } from "@/components/orders/notes/redact-note-dialog";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { Button } from "@/components/ui/button";
import { notesErrorMessage, orderNotesApi } from "@/lib/orders/notes/client";
import { formatNoteDate, noteEventLabel, SUPPRESSED_TEXT_LABEL } from "@/lib/orders/notes/format";
import {
  NOTE_REDACT_REASON_LABELS,
  isNoteRedactReasonCode,
  type NoteHistoryEvent,
  type NoteRedactReasonCode,
  type NoteVersionView,
  type OrderNoteHistoryResponse,
} from "@/lib/orders/notes/types";

function VersionText({ label, version }: { label: string; version: NoteVersionView | null }) {
  if (!version) return null;
  return (
    <div className="mt-2 min-w-0">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {version.redacted ? (
        <p className="mt-1 text-sm italic text-muted-foreground">{SUPPRESSED_TEXT_LABEL}</p>
      ) : (
        <div className="mt-1 rounded-md border border-border bg-background px-3 py-2">
          <RichTextContent value={version.body} textStyles className="text-sm leading-relaxed text-foreground" />
        </div>
      )}
    </div>
  );
}

function redactionSummary(event: NoteHistoryEvent) {
  const after = event.after ?? {};
  const code = after.reason_code;
  const parts = [isNoteRedactReasonCode(code) ? NOTE_REDACT_REASON_LABELS[code] : null];
  const reasons = Number(after.reasons_redacted ?? 0);
  if (reasons > 0) parts.push(reasons === 1 ? "1 motivo suprimido" : `${reasons} motivos suprimidos`);
  return parts.filter(Boolean).join(" · ");
}

function HistoryEvent({ event }: { event: NoteHistoryEvent }) {
  return (
    <li className="min-w-0 border-l-2 border-border pl-3">
      <p className="text-sm">
        <span className="font-medium">{event.actor_name}</span> {noteEventLabel(event.action)}
      </p>
      <p className="text-xs text-muted-foreground">{formatNoteDate(event.created_at)}</p>
      {event.reason ? (
        <p className="mt-1 break-words text-sm">
          <span className="text-muted-foreground">Motivo: </span>
          {event.reason_redacted ? <em className="text-muted-foreground">[motivo suprimido]</em> : event.reason}
        </p>
      ) : null}
      {event.action === "redacted" ? (
        <p className="mt-1 text-sm text-muted-foreground">{redactionSummary(event)}</p>
      ) : null}
      {event.action === "edited" ? (
        <>
          <VersionText label="Texto anterior" version={event.version_before} />
          <VersionText label="Texto nuevo" version={event.version_after} />
        </>
      ) : null}
      {event.action === "created" || event.action === "converted_from_legacy" ? (
        <VersionText label="Texto" version={event.version_after} />
      ) : null}
    </li>
  );
}

/** History of one post-it: every change with the text before and after, or «Texto suprimido». */
export function NoteHistoryDialog({
  orderId,
  noteId,
  startWithRedaction = false,
  onClose,
  onChanged,
}: {
  orderId: string;
  noteId: string;
  /** Open «Suprimir texto» as soon as the history is loaded (owner only). */
  startWithRedaction?: boolean;
  onClose: () => void;
  /** After a redaction: refresh the list. */
  onChanged: () => void | Promise<void>;
}) {
  const [history, setHistory] = useState<OrderNoteHistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [redacting, setRedacting] = useState(startWithRedaction);
  const [redactBusy, setRedactBusy] = useState(false);
  const [redactError, setRedactError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    orderNotesApi.history(orderId, noteId, controller.signal).then(
      (next) => {
        if (controller.signal.aborted) return;
        setHistory(next);
        setError(null);
      },
      (caught: unknown) => {
        if (controller.signal.aborted) return;
        setError(notesErrorMessage(caught));
      }
    );
    return () => controller.abort();
  }, [orderId, noteId, revision]);

  const redact = useCallback(
    async (input: { reasonCode: NoteRedactReasonCode; eventIds: string[] }) => {
      setRedactBusy(true);
      setRedactError(null);
      try {
        await orderNotesApi.redact(orderId, noteId, { reason_code: input.reasonCode, reason_event_ids: input.eventIds });
        setRedacting(false);
        setRevision((current) => current + 1);
        await onChanged();
      } catch (caught) {
        setRedactError(notesErrorMessage(caught));
      } finally {
        setRedactBusy(false);
      }
    },
    [orderId, noteId, onChanged]
  );

  const note = history?.note ?? null;
  const events = history ? [...history.events].reverse() : [];

  return (
    <>
      <NotesDialog
        title="Historial de la nota"
        wide
        onClose={onClose}
        description={
          note ? (
            <span className="flex flex-wrap items-center gap-1.5">
              <NoteStateBadge state={note.state} />
              <NoteVisibilityBadge visibility={note.visibility} />
              <span>
                Creada por {note.author.name} · {formatNoteDate(note.created_at)}
              </span>
            </span>
          ) : undefined
        }
        footer={
          <>
            {note?.permissions.redact ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRedactError(null);
                  setRedacting(true);
                }}
                className="min-h-11 w-full text-destructive sm:mr-auto sm:w-auto"
              >
                <Eraser aria-hidden />
                Suprimir texto
              </Button>
            ) : null}
            <Button type="button" onClick={onClose} className="min-h-11 w-full sm:w-auto">
              Cerrar
            </Button>
          </>
        }
      >
        {error ? (
          <NoteInlineMessage tone="error">{error}</NoteInlineMessage>
        ) : !history ? (
          <p className="text-sm text-muted-foreground" role="status">
            Cargando historial…
          </p>
        ) : (
          <div className="space-y-4">
            {note?.redacted ? (
              <NoteInlineMessage tone="info">
                {SUPPRESSED_TEXT_LABEL}. El historial conserva quién hizo cada cambio y cuándo.
              </NoteInlineMessage>
            ) : null}
            <p className="text-xs text-muted-foreground">Del cambio más reciente al más antiguo.</p>
            <ol className="space-y-4">
              {events.map((event) => (
                <HistoryEvent key={event.id} event={event} />
              ))}
            </ol>
          </div>
        )}
      </NotesDialog>
      {redacting && history?.note.permissions.redact ? (
        <RedactNoteDialog
          events={history.events}
          alreadyRedacted={history.note.redacted}
          busy={redactBusy}
          error={redactError}
          onCancel={() => setRedacting(false)}
          onConfirm={(input) => void redact(input)}
        />
      ) : null}
    </>
  );
}
