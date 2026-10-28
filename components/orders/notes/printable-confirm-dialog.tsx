"use client";

import { Printer } from "lucide-react";

import { NotesDialog } from "@/components/orders/notes/notes-dialog";
import { NoteInlineMessage, PersonalDataNotice } from "@/components/orders/notes/note-parts";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { Button } from "@/components/ui/button";
import { richTextToPlainText } from "@/lib/rich-text/html";

/**
 * N18: making a post-it printable, or editing the text of a printable one,
 * shows the full text exactly as it will print and warns about an email or a
 * phone. Only after this confirmation is confirm_printable sent.
 */
export function PrintableConfirmDialog({
  body,
  editingPrintable = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: {
  /** Sanitized rich text that will print. */
  body: string;
  /** The note is already printable and its text changes. */
  editingPrintable?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <NotesDialog
      title={editingPrintable ? "¿Imprimir el texto nuevo?" : "¿Marcar la nota como imprimible?"}
      description={
        <>
          Saldrá en la Hoja de trabajo exactamente así. El Resguardo del cliente nunca lleva notas. Quedará registrado
          quién lo autoriza y cuándo.
        </>
      }
      busy={busy}
      onClose={onCancel}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="min-h-11 w-full sm:w-auto">
            Revisar el texto
          </Button>
          <Button type="button" onClick={onConfirm} disabled={busy} className="min-h-11 w-full sm:w-auto">
            <Printer aria-hidden />
            {busy ? "Guardando…" : "Marcar como imprimible"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Texto que se imprimirá</p>
        <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-background px-3 py-2">
          <RichTextContent value={body} textStyles className="text-sm leading-relaxed text-foreground" />
        </div>
        <PersonalDataNotice text={richTextToPlainText(body)} context="Revisa que se pueda sacar en papel." />
        {error ? <NoteInlineMessage tone="error">{error}</NoteInlineMessage> : null}
      </div>
    </NotesDialog>
  );
}
