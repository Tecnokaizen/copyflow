"use client";

import { ArrowDown, Pin } from "lucide-react";

import { NoteAddressee, NoteVisibilityBadge } from "@/components/orders/notes/note-parts";
import { useOrderNotes } from "@/components/orders/notes/order-notes-provider";
import { ORDER_POSTITS_ANCHOR } from "@/components/orders/notes/order-sticky-notes-panel";
import { Button } from "@/components/ui/button";
import { formatNoteDate } from "@/lib/orders/notes/format";
import { plainTextSnippet } from "@/lib/rich-text/html";

const VISIBLE_PINNED = 3;

function showAllNotes() {
  const panel = document.getElementById(ORDER_POSTITS_ANCHOR);
  if (!panel) return;
  panel.scrollIntoView({ block: "start", behavior: "smooth" });
  panel.focus({ preventScroll: true });
}

/** Up to three pinned open post-its under the order header; nothing when there are none. */
export function OrderPinnedNotesStrip() {
  const { enabled, pinned } = useOrderNotes();
  if (!enabled || pinned.length === 0) return null;

  const visible = pinned.slice(0, VISIBLE_PINNED);
  const more = pinned.length - visible.length;

  return (
    <section
      aria-label="Post-its fijados"
      className="mb-4 min-w-0 rounded-[var(--radius)] border border-[hsl(var(--gc-warning)/0.35)] bg-[hsl(var(--gc-warning)/0.06)] px-3 py-3 sm:px-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Pin aria-hidden className="size-4 text-[hsl(var(--gc-warning))]" />
          Fijados
          <span className="font-normal text-muted-foreground">({pinned.length})</span>
        </h2>
        <Button type="button" variant="ghost" size="sm" className="min-h-9" onClick={showAllNotes}>
          <ArrowDown aria-hidden />
          {more > 0 ? `Ver todas (${more} fijadas más)` : "Ver todas"}
        </Button>
      </div>
      <ul className="mt-2 grid min-w-0 gap-2 md:grid-cols-3">
        {visible.map((note) => (
          <li key={note.id} className="min-w-0 rounded-md border border-border/70 bg-card px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <NoteVisibilityBadge visibility={note.visibility} />
              <NoteAddressee addressee={note.addressee} />
            </div>
            <p className="mt-1.5 line-clamp-3 break-words text-sm text-foreground">
              {note.redacted ? <em className="text-muted-foreground">Texto suprimido</em> : plainTextSnippet(note.body)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {note.author.name} · {formatNoteDate(note.created_at)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
