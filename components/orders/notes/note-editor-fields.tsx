"use client";

import { useId } from "react";
import { Lock, Printer } from "lucide-react";

import { NOTE_RADIO_CLASS, PersonalDataNotice } from "@/components/orders/notes/note-parts";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { notePlainLength } from "@/lib/orders/notes/body";
import { NOTE_VISIBILITY_HINTS, NOTE_VISIBILITY_LABELS } from "@/lib/orders/notes/format";
import { NOTE_MAX_PLAIN_LENGTH, NOTE_VISIBILITIES, type NoteVisibility } from "@/lib/orders/notes/types";
import { richTextToPlainText } from "@/lib/rich-text/html";
import { cn } from "@/lib/utils";

export type NoteDraft = { body: string; visibility: NoteVisibility };

const VISIBILITY_ICON = { internal: Lock, printable: Printer } as const;

/** Text (editor of #146 with sizes, colors and alignment) and visibility of a post-it. */
export function NoteEditorFields({
  ariaLabel,
  draft,
  onChange,
  disabled = false,
}: {
  ariaLabel: string;
  draft: NoteDraft;
  onChange: (draft: NoteDraft) => void;
  disabled?: boolean;
}) {
  const groupId = useId();
  const length = notePlainLength(draft.body);
  const tooLong = length > NOTE_MAX_PLAIN_LENGTH;

  return (
    <div className="min-w-0 space-y-3">
      <div className="min-w-0">
        <RichTextEditor
          ariaLabel={ariaLabel}
          textStyles
          value={draft.body}
          invalid={tooLong}
          disabled={disabled}
          onChange={(body) => onChange({ ...draft, body })}
        />
        <p className={cn("mt-1 text-right text-xs", tooLong ? "text-destructive" : "text-muted-foreground")}>
          {length}/{NOTE_MAX_PLAIN_LENGTH} caracteres
        </p>
      </div>

      <PersonalDataNotice
        text={richTextToPlainText(draft.body)}
        context={draft.visibility === "printable" ? "Revisa que se pueda sacar en papel." : "Escribe solo lo necesario."}
      />

      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium">Visibilidad</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {NOTE_VISIBILITIES.map((visibility) => {
            const Icon = VISIBILITY_ICON[visibility];
            const checked = draft.visibility === visibility;
            return (
              <label
                key={visibility}
                className={cn(
                  "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm",
                  checked ? "border-primary bg-primary/5" : "border-border",
                  disabled && "cursor-not-allowed opacity-70"
                )}
              >
                <input
                  type="radio"
                  name={`${groupId}-visibility`}
                  value={visibility}
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onChange({ ...draft, visibility })}
                  className={cn("mt-0.5", NOTE_RADIO_CLASS)}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Icon aria-hidden className="size-4" />
                    {NOTE_VISIBILITY_LABELS[visibility]}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{NOTE_VISIBILITY_HINTS[visibility]}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
