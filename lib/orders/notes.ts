/**
 * Append a shop-floor note to the existing `orders.notes` body.
 * Persistence still goes through PATCH content `{ field: "notes" }`.
 */
export function appendOrderNote(
  existing: string | null | undefined,
  addition: string
): string | null {
  const next = addition.trim();
  const current = existing?.trim() ?? "";

  if (!next) {
    return current || null;
  }

  if (!current) {
    return next;
  }

  return `${current}\n\n${next}`;
}
