"use client";

import { useState } from "react";
import { ArrowDown, Lock, StickyNote } from "lucide-react";

import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { SectionCard } from "@/components/gestcopy/section-card";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import { useOptionalOrderNotes } from "@/components/orders/notes/order-notes-provider";
import { ORDER_POSTITS_ANCHOR } from "@/components/orders/notes/order-sticky-notes-panel";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { Button } from "@/components/ui/button";
import { notesErrorMessage, orderNotesApi } from "@/lib/orders/notes/client";
import { isRichTextEmpty } from "@/lib/rich-text/html";
import type { Order, OrderDraft } from "@/lib/orders/types";

function NotPrintedBadge() {
  return (
    <StatusBadge tone="neutral" className="gap-1 self-start">
      <Lock aria-hidden className="size-3.5" />
      No se imprime
    </StatusBadge>
  );
}

/**
 * `orders.notes`. Since SUR4 E2 it never prints (N6/N18).
 * - Without post-its (`stickyNotes` false, the default): same card as before,
 *   with the «No se imprime» notice.
 * - With post-its: «Notas anteriores», read-only, and «Pasar a post-it»
 *   (convert_order_legacy_notes_v1), which creates an internal post-it with
 *   this text and empties the field in one transaction. The order's
 *   row_version goes up: the new one is handed to the parent.
 */
export function OrderNotes({
  order,
  draft,
  editing,
  onDraftChange,
  stickyNotes = false,
  canWrite = false,
  archived,
  onOrderVersionChange,
  onLegacyNotesConverted,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  onDraftChange: (patch: Partial<OrderDraft>) => void;
  /** Server answer for order_sticky_notes. */
  stickyNotes?: boolean;
  /** owner, admin, manager or staff (canWriteOrders): may use «Pasar a post-it». */
  canWrite?: boolean;
  /** Defaults to order.archived_at. */
  archived?: boolean;
  /** New order row_version after «Pasar a post-it». */
  onOrderVersionChange?: (version: string) => void;
  /** After «Pasar a post-it»: orders.notes is now empty (set it to null or reload the order). */
  onLegacyNotesConverted?: (result: { version: string; noteId: string }) => void;
}) {
  const notesContext = useOptionalOrderNotes();
  const [confirming, setConfirming] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Text already turned into a post-it: hidden until the parent clears it.
  const [convertedText, setConvertedText] = useState<string | null>(null);

  if (!stickyNotes) {
    if (editing && draft) {
      return (
        <SectionCard title="Notas internas" actions={<NotPrintedBadge />} bodyClassName="px-5 py-5 sm:px-6">
          <RichTextEditor
            ariaLabel="Notas internas"
            textStyles
            value={draft.notes}
            onChange={(value) => onDraftChange({ notes: value })}
          />
          <p className="mt-2 text-xs text-muted-foreground">Estas notas se ven solo en la ficha: no salen en la Hoja de trabajo.</p>
        </SectionCard>
      );
    }

    return (
      <SectionCard title="Notas internas" actions={<NotPrintedBadge />} bodyClassName="px-5 py-5 sm:px-6">
        {isRichTextEmpty(order.notes) ? (
          <p className="text-sm text-muted-foreground">Sin notas internas</p>
        ) : (
          <RichTextContent value={order.notes} textStyles className="text-sm leading-relaxed text-foreground" />
        )}
      </SectionCard>
    );
  }

  const isArchived = archived ?? order.archived_at != null;
  const legacy = order.notes != null && order.notes !== convertedText && !isRichTextEmpty(order.notes) ? order.notes : null;
  const justConverted = convertedText !== null && legacy === null;

  if (!legacy && !justConverted) {
    return null;
  }

  async function convert() {
    setConverting(true);
    setError(null);
    try {
      const result = await orderNotesApi.convertLegacy(order.id, order.version);
      setConfirming(false);
      setConvertedText(order.notes);
      onOrderVersionChange?.(result.version);
      onLegacyNotesConverted?.({ version: result.version, noteId: result.note_id });
      await notesContext?.reload();
    } catch (caught) {
      setConfirming(false);
      setError(notesErrorMessage(caught));
    } finally {
      setConverting(false);
    }
  }

  function showPostits() {
    const panel = document.getElementById(ORDER_POSTITS_ANCHOR);
    panel?.scrollIntoView({ block: "start", behavior: "smooth" });
    panel?.focus({ preventScroll: true });
  }

  return (
    <SectionCard
      title="Notas anteriores"
      description="Notas escritas antes de los post-its. Solo lectura."
      actions={<NotPrintedBadge />}
      bodyClassName="space-y-4 px-5 py-5 sm:px-6"
    >
      {justConverted ? (
        <div role="status" className="space-y-2 rounded-[var(--radius)] border border-border bg-secondary/40 px-4 py-3 text-sm">
          <p>
            Las notas anteriores ahora son un <strong>post-it interno</strong>. No se imprime: para que salga en la Hoja
            de trabajo, márcalo como imprimible en Post-its.
          </p>
          <Button type="button" variant="outline" size="sm" className="min-h-9" onClick={showPostits}>
            <ArrowDown aria-hidden />
            Ver post-its
          </Button>
        </div>
      ) : (
        <>
          <RichTextContent value={legacy} textStyles className="text-sm leading-relaxed text-foreground" />
          {canWrite && !isArchived ? (
            <div className="space-y-2 border-t border-border/70 pt-4">
              <Button
                type="button"
                variant="outline"
                className="min-h-11 w-full sm:w-auto"
                disabled={converting || editing}
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
              >
                <StickyNote aria-hidden />
                Pasar a post-it
              </Button>
              <p className="text-xs text-muted-foreground">
                {editing
                  ? "Guarda o cancela la edición del pedido antes de pasar estas notas a post-it."
                  : "Crea un post-it interno con este texto y vacía este campo. Para imprimirlo, márcalo después como imprimible."}
              </p>
            </div>
          ) : null}
        </>
      )}
      {error ? (
        <div role="alert" className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {confirming ? (
        <ConfirmDialog
          title="¿Pasar las notas anteriores a post-it?"
          description="Se crea un post-it interno con este texto y el campo «Notas anteriores» queda vacío, todo a la vez. El post-it no se imprime hasta que lo marques como imprimible y confirmes el texto."
          confirmLabel="Pasar a post-it"
          busy={converting}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void convert()}
        />
      ) : null}
    </SectionCard>
  );
}
