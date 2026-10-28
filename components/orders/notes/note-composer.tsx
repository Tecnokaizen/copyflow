"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Pin } from "lucide-react";

import { NoteInlineMessage } from "@/components/orders/notes/note-parts";
import { NoteEditorFields, type NoteDraft } from "@/components/orders/notes/note-editor-fields";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { NoteAddresseeOption } from "@/lib/orders/notes/types";

export type NoteComposerInput = NoteDraft & { pinned: boolean; addresseeId: string | null };

/** Focus the editor once Tiptap has mounted it (it renders after the first effect). */
export function focusEditorIn(container: HTMLElement | null) {
  let attempts = 0;
  const tick = () => {
    const editable = container?.querySelector<HTMLElement>("[contenteditable='true']");
    if (editable) {
      editable.focus({ preventScroll: true });
      return;
    }
    if (attempts++ < 30) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function NoteComposer({
  addressees,
  busy,
  error,
  focusToken,
  onSubmit,
  onCancel,
}: {
  addressees: NoteAddresseeOption[];
  busy: boolean;
  error: string | null;
  /** Changes each time the composer must take the focus. */
  focusToken: number;
  onSubmit: (input: NoteComposerInput) => void;
  onCancel: () => void;
}) {
  const containerRef = useRef<HTMLFormElement>(null);
  const fieldId = useId();
  const [draft, setDraft] = useState<NoteDraft>({ body: "", visibility: "internal" });
  const [pinned, setPinned] = useState(false);
  const [addresseeId, setAddresseeId] = useState<string>("");

  useEffect(() => {
    focusEditorIn(containerRef.current);
  }, [focusToken]);

  return (
    <form
      ref={containerRef}
      className="min-w-0 space-y-4 rounded-[var(--radius)] border border-border bg-background p-3 sm:p-4"
      aria-label="Nueva nota"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ ...draft, pinned, addresseeId: addresseeId || null });
      }}
    >
      <NoteEditorFields ariaLabel="Texto de la nota" draft={draft} onChange={setDraft} disabled={busy} />

      <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor={`${fieldId}-addressee`}>Para (opcional)</Label>
          <select
            id={`${fieldId}-addressee`}
            value={addresseeId}
            disabled={busy}
            onChange={(event) => setAddresseeId(event.target.value)}
            className="h-11 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">Sin destinatario</option>
            {addressees.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">Solo se ve en la ficha: no se envía ningún aviso.</p>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
          <Checkbox checked={pinned} disabled={busy} onCheckedChange={(checked) => setPinned(checked === true)} />
          <Pin aria-hidden className="size-4 text-muted-foreground" />
          Fijar arriba en la ficha
        </label>
      </div>

      {error ? <NoteInlineMessage tone="error">{error}</NoteInlineMessage> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="min-h-11 w-full sm:w-auto">
          Cancelar
        </Button>
        <Button type="submit" disabled={busy} className="min-h-11 w-full sm:w-auto">
          {busy ? "Guardando…" : "Guardar nota"}
        </Button>
      </div>
    </form>
  );
}
