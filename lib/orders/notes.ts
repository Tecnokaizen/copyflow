import { appendRichText } from "@/lib/rich-text/html";

/**
 * Append a shop-floor note to the existing `orders.notes` body.
 * Persistence still goes through PATCH content `{ field: "notes" }`.
 */
export function appendOrderNote(
  existing: string | null | undefined,
  addition: string
): string | null {
  const next = appendRichText(existing, addition);
  return next || null;
}
