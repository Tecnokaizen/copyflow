import { SectionCard } from "@/components/gestcopy/section-card";
import { DraftTextarea } from "@/components/orders/detail/order-field";
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
        <DraftTextarea
          value={draft.notes}
          onChange={(value) => onDraftChange({ notes: value })}
          rows={4}
        />
      </SectionCard>
    );
  }

  const notes = order.notes?.trim();

  return (
    <SectionCard title="Notas internas" bodyClassName="px-5 py-5 sm:px-6">
      {notes ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {notes}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Sin notas internas</p>
      )}
    </SectionCard>
  );
}
