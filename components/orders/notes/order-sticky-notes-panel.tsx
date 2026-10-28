"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Plus, RefreshCw } from "lucide-react";

import { SectionCard } from "@/components/gestcopy/section-card";
import { NoteCard, type NoteCardActions } from "@/components/orders/notes/note-card";
import { NoteComposer, type NoteComposerInput } from "@/components/orders/notes/note-composer";
import type { NoteDraft } from "@/components/orders/notes/note-editor-fields";
import { NoteHistoryDialog } from "@/components/orders/notes/note-history-dialog";
import { NoteInlineMessage } from "@/components/orders/notes/note-parts";
import { useOrderNotes } from "@/components/orders/notes/order-notes-provider";
import { PrintableConfirmDialog } from "@/components/orders/notes/printable-confirm-dialog";
import { VoidNoteDialog } from "@/components/orders/notes/void-note-dialog";
import { Button } from "@/components/ui/button";
import { ORDER_RICH_TEXT } from "@/lib/orders/rich-text";
import { notePlainLength } from "@/lib/orders/notes/body";
import { NotesRequestError, notesErrorMessage, orderNotesApi } from "@/lib/orders/notes/client";
import { NOTE_MAX_PLAIN_LENGTH, type NoteVisibility, type OrderNoteView } from "@/lib/orders/notes/types";
import { normalizeRichText } from "@/lib/rich-text/html";

/** Anchor of the panel; the pinned strip's «Ver todas» scrolls here. */
export const ORDER_POSTITS_ANCHOR = "order-postits";

type PrintableRequest =
  | { mode: "create"; input: NoteComposerInput }
  | { mode: "make"; noteId: string; body: string }
  | { mode: "edit"; noteId: string; body: string; bodyChanged: boolean; visibilityChanged: boolean; wasPrintable: boolean };

type Dialog =
  | { kind: "printable"; request: PrintableRequest }
  | { kind: "void"; noteId: string }
  | { kind: "history"; noteId: string; redact: boolean };

const EMPTY_BODY = "Escribe el texto de la nota.";
const TOO_LONG = `La nota no puede superar ${NOTE_MAX_PLAIN_LENGTH} caracteres.`;

function cleanBody(body: string) {
  return normalizeRichText(body, ORDER_RICH_TEXT);
}

function bodyProblem(body: string) {
  if (!body) return EMPTY_BODY;
  if (notePlainLength(body) > NOTE_MAX_PLAIN_LENGTH) return TOO_LONG;
  return null;
}

/**
 * Post-its of the order (SUR4 E6): list, composer, states, edit, history,
 * printable confirmation (N18) and the owner's «Suprimir texto» (N22).
 * Reads and reloads through OrderNotesProvider. Post-its never change the
 * order's row_version (N5), so this panel never touches the order.
 */
export function OrderStickyNotesPanel({
  archived = false,
  composeRequest = 0,
}: {
  /** The order is archived: read-only, whatever the last list said. */
  archived?: boolean;
  /** Increment to open the composer and focus it (header «Añadir nota»). */
  composeRequest?: number;
}) {
  const { orderId, enabled, data, loading, error, includeVoided, setIncludeVoided, reload } = useOrderNotes();
  const rootRef = useRef<HTMLDivElement>(null);
  const [handledRequest, setHandledRequest] = useState(composeRequest);
  const [composeOpen, setComposeOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [creating, setCreating] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ noteId: string; draft: NoteDraft } | null>(null);
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null);
  const [noteErrors, setNoteErrors] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // A new request from the header opens the composer (state from props, no effect).
  if (composeRequest !== handledRequest) {
    setHandledRequest(composeRequest);
    if (composeRequest > 0) {
      setComposeOpen(true);
      setComposerError(null);
      setNotice(null);
      setFocusToken((token) => token + 1);
    }
  }

  useEffect(() => {
    if (focusToken > 0) {
      rootRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [focusToken]);

  const readOnly = archived || data?.archived === true;
  const canCreate = !readOnly && data?.can_create === true;
  const limitReached = data ? data.total >= data.limit : false;

  const findNote = useCallback((noteId: string) => data?.notes.find((note) => note.id === noteId) ?? null, [data]);

  const setNoteError = useCallback((noteId: string, message: string | null) => {
    setNoteErrors((current) => {
      const next = { ...current };
      if (message) next[noteId] = message;
      else delete next[noteId];
      return next;
    });
  }, []);

  const afterFailure = useCallback(
    async (caught: unknown) => {
      // Someone else changed it, it is gone, or the order was archived: show the current state.
      if (caught instanceof NotesRequestError && [404, 409, 422].includes(caught.status)) {
        await reload();
      }
    },
    [reload]
  );

  // ---------------------------------------------------------------- create
  async function submitCreate(input: NoteComposerInput, confirmPrintable: boolean) {
    setCreating(true);
    if (confirmPrintable) setDialogBusy(true);
    setComposerError(null);
    setDialogError(null);
    try {
      await orderNotesApi.create(orderId, {
        body: input.body,
        visibility: input.visibility,
        pinned: input.pinned,
        addressee_team_member_id: input.addresseeId,
        confirm_printable: confirmPrintable,
      });
      setDialog(null);
      setComposeOpen(false);
      setNotice(input.visibility === "printable" ? "Nota añadida. Saldrá en la Hoja de trabajo." : "Nota añadida.");
      await reload();
    } catch (caught) {
      const message = notesErrorMessage(caught);
      if (confirmPrintable) setDialogError(message);
      else setComposerError(message);
      if (caught instanceof NotesRequestError && caught.code === "too_many_notes") await reload();
    } finally {
      setCreating(false);
      setDialogBusy(false);
    }
  }

  function requestCreate(input: NoteComposerInput) {
    const body = cleanBody(input.body);
    const problem = bodyProblem(body);
    if (problem) {
      setComposerError(problem);
      return;
    }
    const prepared = { ...input, body };
    if (input.visibility === "printable") {
      setDialogError(null);
      setDialog({ kind: "printable", request: { mode: "create", input: prepared } });
      return;
    }
    void submitCreate(prepared, false);
  }

  // ---------------------------------------------------------------- update
  async function submitUpdate(
    noteId: string,
    patch: { body?: string; visibility?: NoteVisibility },
    confirmPrintable: boolean,
    success: string
  ) {
    const note = findNote(noteId);
    if (!note) return;
    if (confirmPrintable) setDialogBusy(true);
    setBusyNoteId(noteId);
    setNoteError(noteId, null);
    setDialogError(null);
    try {
      await orderNotesApi.update(orderId, noteId, {
        expected_row_version: note.row_version,
        ...patch,
        confirm_printable: confirmPrintable,
      });
      setDialog(null);
      setEditing((current) => (current?.noteId === noteId ? null : current));
      setNotice(success);
      await reload();
    } catch (caught) {
      const message = notesErrorMessage(caught);
      if (confirmPrintable) setDialogError(message);
      else setNoteError(noteId, message);
      await afterFailure(caught);
    } finally {
      setBusyNoteId(null);
      setDialogBusy(false);
    }
  }

  function saveEdit() {
    if (!editing) return;
    const note = findNote(editing.noteId);
    if (!note || !note.permissions.edit || readOnly) {
      setEditing(null);
      if (note) setNoteError(note.id, "Ya no puedes editar esta nota.");
      return;
    }
    const body = cleanBody(editing.draft.body);
    const problem = bodyProblem(body);
    if (problem) {
      setNoteError(note.id, problem);
      return;
    }
    const bodyChanged = body !== cleanBody(note.body ?? "");
    const visibilityChanged = editing.draft.visibility !== note.visibility;
    if (!bodyChanged && !visibilityChanged) {
      setEditing(null);
      return;
    }
    if (editing.draft.visibility === "printable") {
      setDialogError(null);
      setDialog({
        kind: "printable",
        request: { mode: "edit", noteId: note.id, body, bodyChanged, visibilityChanged, wasPrintable: note.visibility === "printable" },
      });
      return;
    }
    void submitUpdate(
      note.id,
      { body: bodyChanged ? body : undefined, visibility: visibilityChanged ? "internal" : undefined },
      false,
      visibilityChanged ? "Nota guardada. Ya no se imprime." : "Nota guardada."
    );
  }

  function confirmPrintable(request: PrintableRequest) {
    if (request.mode === "create") {
      void submitCreate(request.input, true);
    } else if (request.mode === "make") {
      void submitUpdate(request.noteId, { visibility: "printable" }, true, "La nota saldrá en la Hoja de trabajo.");
    } else {
      void submitUpdate(
        request.noteId,
        {
          body: request.bodyChanged ? request.body : undefined,
          visibility: request.visibilityChanged ? "printable" : undefined,
        },
        true,
        "Nota guardada. Saldrá en la Hoja de trabajo."
      );
    }
  }

  // ---------------------------------------------------------------- state
  async function runState(note: OrderNoteView, action: "pin" | "unpin" | "resolve" | "reopen") {
    setBusyNoteId(note.id);
    setNoteError(note.id, null);
    try {
      await orderNotesApi.setState(orderId, note.id, action);
      await reload();
    } catch (caught) {
      setNoteError(note.id, notesErrorMessage(caught));
      await afterFailure(caught);
    } finally {
      setBusyNoteId(null);
    }
  }

  async function confirmVoid(noteId: string, reason: string) {
    setDialogBusy(true);
    setDialogError(null);
    try {
      await orderNotesApi.setState(orderId, noteId, "void", reason);
      setDialog(null);
      setEditing((current) => (current?.noteId === noteId ? null : current));
      setNotice("Nota anulada. Sigue en el historial.");
      await reload();
    } catch (caught) {
      setDialogError(notesErrorMessage(caught));
      await afterFailure(caught);
    } finally {
      setDialogBusy(false);
    }
  }

  const actions: NoteCardActions = {
    onState: (note, action) => void runState(note, action),
    onVoid: (note) => {
      setDialogError(null);
      setDialog({ kind: "void", noteId: note.id });
    },
    onEdit: (note) => {
      setNoteError(note.id, null);
      setEditing({ noteId: note.id, draft: { body: note.body ?? "", visibility: note.visibility } });
    },
    onVisibility: (note, visibility) => {
      if (visibility === "printable") {
        setDialogError(null);
        setDialog({ kind: "printable", request: { mode: "make", noteId: note.id, body: note.body ?? "" } });
      } else {
        void submitUpdate(note.id, { visibility: "internal" }, false, "La nota ya no se imprime.");
      }
    },
    onHistory: (note) => setDialog({ kind: "history", noteId: note.id, redact: false }),
    onRedact: (note) => setDialog({ kind: "history", noteId: note.id, redact: true }),
  };

  function openComposer() {
    setComposeOpen(true);
    setComposerError(null);
    setNotice(null);
    setFocusToken((token) => token + 1);
  }

  if (!enabled) return null;

  const notes = data?.notes ?? [];
  const hiddenVoided = !includeVoided && (data?.voided_count ?? 0) > 0 ? data?.voided_count ?? 0 : 0;

  return (
    <div id={ORDER_POSTITS_ANCHOR} ref={rootRef} tabIndex={-1} className="scroll-mt-24 outline-none">
      <SectionCard
        title="Post-its"
        description="Notas con autor y estado. Las internas solo se ven aquí; en la Hoja de trabajo solo salen las marcadas como imprimibles."
        bodyClassName="space-y-4 px-4 py-4 sm:px-6 sm:py-5"
        actions={
          <div className="flex flex-wrap gap-2">
            {canCreate ? (
              <Button type="button" size="sm" className="min-h-9" onClick={openComposer}>
                <Plus aria-hidden />
                Añadir nota
              </Button>
            ) : null}
            {data && (data.voided_count > 0 || includeVoided) ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-9"
                aria-pressed={includeVoided}
                onClick={() => setIncludeVoided(!includeVoided)}
              >
                {includeVoided ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                {includeVoided ? "Ocultar anuladas" : `Mostrar anuladas (${data.voided_count})`}
              </Button>
            ) : null}
          </div>
        }
      >
        {readOnly && data ? (
          <NoteInlineMessage tone="info">Pedido archivado: las notas son de solo lectura.</NoteInlineMessage>
        ) : null}
        {!readOnly && limitReached ? (
          <NoteInlineMessage tone="info">
            Este pedido ya tiene {data?.limit} notas, el máximo permitido (las anuladas también cuentan). No se pueden
            añadir más.
          </NoteInlineMessage>
        ) : null}
        {composeOpen && data && !canCreate && !readOnly && !limitReached ? (
          <NoteInlineMessage tone="info">Tu rol permite ver las notas, pero no añadirlas.</NoteInlineMessage>
        ) : null}
        {notice ? <NoteInlineMessage tone="info">{notice}</NoteInlineMessage> : null}

        {composeOpen && canCreate ? (
          <NoteComposer
            addressees={data?.addressees ?? []}
            busy={creating}
            error={composerError}
            focusToken={focusToken}
            onSubmit={requestCreate}
            onCancel={() => {
              setComposeOpen(false);
              setComposerError(null);
            }}
          />
        ) : null}

        {error && !data ? (
          <div className="space-y-2">
            <NoteInlineMessage tone="error">{error}</NoteInlineMessage>
            <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={() => void reload()}>
              <RefreshCw aria-hidden />
              Reintentar
            </Button>
          </div>
        ) : loading && !data ? (
          <p className="text-sm text-muted-foreground" role="status">
            Cargando notas…
          </p>
        ) : notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {includeVoided ? "Este pedido no tiene notas." : "Todavía no hay notas abiertas ni resueltas en este pedido."}
            {hiddenVoided > 0 ? ` Hay ${hiddenVoided === 1 ? "1 anulada" : `${hiddenVoided} anuladas`} oculta${hiddenVoided === 1 ? "" : "s"}.` : null}
          </p>
        ) : (
          <ul className="space-y-3" aria-busy={loading}>
            {notes.map((note) => (
              <li key={note.id} className="min-w-0">
                <NoteCard
                  note={note}
                  readOnly={readOnly}
                  busy={busyNoteId === note.id}
                  error={noteErrors[note.id] ?? null}
                  editing={editing?.noteId === note.id}
                  draft={editing?.noteId === note.id ? editing.draft : null}
                  onDraftChange={(draft) => setEditing({ noteId: note.id, draft })}
                  onSaveEdit={saveEdit}
                  onCancelEdit={() => {
                    setEditing(null);
                    setNoteError(note.id, null);
                  }}
                  actions={actions}
                />
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      {dialog?.kind === "printable" ? (
        <PrintableConfirmDialog
          body={dialog.request.mode === "create" ? dialog.request.input.body : dialog.request.body}
          editingPrintable={dialog.request.mode === "edit" && dialog.request.wasPrintable}
          busy={dialogBusy}
          error={dialogError}
          onCancel={() => setDialog(null)}
          onConfirm={() => confirmPrintable(dialog.request)}
        />
      ) : null}
      {dialog?.kind === "void" ? (
        <VoidNoteDialog
          busy={dialogBusy}
          error={dialogError}
          onCancel={() => setDialog(null)}
          onConfirm={(reason) => void confirmVoid(dialog.noteId, reason)}
        />
      ) : null}
      {dialog?.kind === "history" ? (
        <NoteHistoryDialog
          orderId={orderId}
          noteId={dialog.noteId}
          startWithRedaction={dialog.redact}
          onClose={() => setDialog(null)}
          onChanged={reload}
        />
      ) : null}
    </div>
  );
}
