import { SectionCard } from "@/components/gestcopy/section-card";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { isRichTextEmpty } from "@/lib/rich-text/html";
import type { Order, OrderDraft } from "@/lib/orders/types";

export function OrderNotes({
  order,
  draft,
  editing,
  onDraftChange,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  onDraftChange: (patch: Partial<OrderDraft>) => void;
}) {
  if (editing && draft) {
    return (
      <SectionCard title="Notas internas" bodyClassName="px-5 py-5 sm:px-6">
        <RichTextEditor
          ariaLabel="Notas internas"
          value={draft.notes}
          onChange={(value) => onDraftChange({ notes: value })}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Notas internas" bodyClassName="px-5 py-5 sm:px-6">
      {isRichTextEmpty(order.notes) ? (
        <p className="text-sm text-muted-foreground">Sin notas internas</p>
      ) : (
        <RichTextContent
          value={order.notes}
          className="text-sm leading-relaxed text-foreground"
        />
      )}
    </SectionCard>
  );
}
