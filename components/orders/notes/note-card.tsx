"use client";

import {
  Ban,
  CheckCircle2,
  Eraser,
  History,
  Lock,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Printer,
  RotateCcw,
} from "lucide-react";

import {
  NoteAddressee,
  NoteInlineMessage,
  NotePinnedBadge,
  NoteStateBadge,
  NoteVisibilityBadge,
} from "@/components/orders/notes/note-parts";
import { NoteEditorFields, type NoteDraft } from "@/components/orders/notes/note-editor-fields";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatNoteDate, SUPPRESSED_TEXT_LABEL } from "@/lib/orders/notes/format";
import type { NoteStateAction, OrderNoteView } from "@/lib/orders/notes/types";
import { cn } from "@/lib/utils";

export type NoteCardActions = {
  onState: (note: OrderNoteView, action: Exclude<NoteStateAction, "void">) => void;
  onVoid: (note: OrderNoteView) => void;
  onEdit: (note: OrderNoteView) => void;
  onVisibility: (note: OrderNoteView, visibility: OrderNoteView["visibility"]) => void;
  onHistory: (note: OrderNoteView) => void;
  onRedact: (note: OrderNoteView) => void;
};

export function NoteCard({
  note,
  readOnly,
  busy,
  error,
  editing,
  draft,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  actions,
}: {
  note: OrderNoteView;
  /** Archived order (or a viewer): only the history stays available. */
  readOnly: boolean;
  busy: boolean;
  error: string | null;
  editing: boolean;
  draft: NoteDraft | null;
  onDraftChange: (draft: NoteDraft) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  actions: NoteCardActions;
}) {
  const can = readOnly
    ? { edit: false, pin: false, resolve: false, reopen: false, void: false, redact: note.permissions.redact }
    : note.permissions;
  const hasMenu = can.edit || can.void || can.redact;

  return (
    <article
      className={cn(
        "min-w-0 rounded-[var(--radius)] border p-3 sm:p-4",
        note.state === "open" && "border-[hsl(var(--gc-warning)/0.3)] bg-[hsl(var(--gc-warning)/0.06)]",
        note.state === "resolved" && "border-border bg-card",
        note.state === "voided" && "border-dashed border-border bg-muted/40"
      )}
      aria-busy={busy}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <NoteStateBadge state={note.state} />
        <NoteVisibilityBadge visibility={note.visibility} />
        {note.pinned ? <NotePinnedBadge /> : null}
        <NoteAddressee addressee={note.addressee} className="ml-0.5" />
      </div>

      {editing && draft ? (
        <div className="mt-3">
          <NoteEditorFields
            ariaLabel="Editar el texto de la nota"
            draft={draft}
            onChange={onDraftChange}
            disabled={busy}
          />
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" onClick={onCancelEdit} disabled={busy} className="min-h-11 w-full sm:w-auto">
              Cancelar
            </Button>
            <Button type="button" onClick={onSaveEdit} disabled={busy} className="min-h-11 w-full sm:w-auto">
              {busy ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </div>
      ) : note.redacted ? (
        <p className="mt-2 text-sm italic text-muted-foreground">{SUPPRESSED_TEXT_LABEL}</p>
      ) : (
        <RichTextContent
          value={note.body}
          textStyles
          className={cn("mt-2 text-sm leading-relaxed text-foreground", note.state === "voided" && "text-muted-foreground")}
        />
      )}

      {note.state === "voided" && note.void_reason ? (
        <p className="mt-2 break-words text-xs text-muted-foreground">
          Anulada {formatNoteDate(note.voided_at)} · Motivo: {note.void_reason}
        </p>
      ) : null}

      {error ? (
        <div className="mt-3">
          <NoteInlineMessage tone="error">{error}</NoteInlineMessage>
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{note.author.name}</span> · {formatNoteDate(note.created_at)}
          {note.state === "resolved" && note.resolved_at ? ` · Resuelta ${formatNoteDate(note.resolved_at)}` : null}
        </p>

        {editing ? null : (
          <div className="flex flex-wrap items-center gap-1">
            {can.pin ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-9"
                disabled={busy}
                onClick={() => actions.onState(note, note.pinned ? "unpin" : "pin")}
              >
                {note.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                {note.pinned ? "Desfijar" : "Fijar"}
              </Button>
            ) : null}
            {can.resolve ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-9"
                disabled={busy}
                onClick={() => actions.onState(note, "resolve")}
              >
                <CheckCircle2 aria-hidden />
                Resolver
              </Button>
            ) : null}
            {can.reopen ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-9"
                disabled={busy}
                onClick={() => actions.onState(note, "reopen")}
              >
                <RotateCcw aria-hidden />
                Reabrir
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" className="min-h-9" onClick={() => actions.onHistory(note)}>
              <History aria-hidden />
              Historial
            </Button>
            {hasMenu ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="min-h-9 min-w-9 px-2" disabled={busy} aria-label="Más acciones de la nota">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  {can.edit ? (
                    <DropdownMenuItem onSelect={() => actions.onEdit(note)}>
                      <Pencil aria-hidden />
                      Editar texto
                    </DropdownMenuItem>
                  ) : null}
                  {can.edit && note.visibility === "internal" ? (
                    <DropdownMenuItem onSelect={() => actions.onVisibility(note, "printable")}>
                      <Printer aria-hidden />
                      Marcar como imprimible
                    </DropdownMenuItem>
                  ) : null}
                  {can.edit && note.visibility === "printable" ? (
                    <DropdownMenuItem onSelect={() => actions.onVisibility(note, "internal")}>
                      <Lock aria-hidden />
                      Pasar a interna (no se imprime)
                    </DropdownMenuItem>
                  ) : null}
                  {can.void ? (
                    <>
                      {can.edit ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem onSelect={() => actions.onVoid(note)} className="text-destructive focus:text-destructive">
                        <Ban aria-hidden />
                        Anular…
                      </DropdownMenuItem>
                    </>
                  ) : null}
                  {can.redact ? (
                    <>
                      {can.edit || can.void ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem onSelect={() => actions.onRedact(note)} className="text-destructive focus:text-destructive">
                        <Eraser aria-hidden />
                        Suprimir texto…
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}
