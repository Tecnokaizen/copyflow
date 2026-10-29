import { appendRichText } from "@/lib/rich-text/html";
import { ORDER_RICH_TEXT } from "@/lib/orders/rich-text";

/**
 * Append a shop-floor note to the existing `orders.notes` body.
 * Persistence still goes through PATCH content `{ field: "notes" }`. Text
 * sizes and colors of both the existing notes and the new note are kept.
 */
export function appendOrderNote(
  existing: string | null | undefined,
  addition: string
): string | null {
  const next = appendRichText(existing, addition, ORDER_RICH_TEXT);
  return next || null;
}
