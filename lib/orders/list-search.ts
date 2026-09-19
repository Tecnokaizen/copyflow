/**
 * List search (`q`) for GET /api/orders — trim + 80-char cap (same as Mostrador).
 */
export function normalizeOrdersListQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, 80);
}

/** Escape `%` / `_` / `\` so user input is literal in ILIKE patterns. */
export function escapeIlikePattern(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
}

/**
 * Build a PostgREST `or` clause for reference + title ILIKE.
 * Values are double-quoted so commas/parens in the needle cannot break `.or()`.
 */
export function buildOrdersTextSearchOrFilter(q: string): string {
  const pattern = `%${escapeIlikePattern(q)}%`;
  const quoted = `"${pattern.replace(/"/g, '\\"')}"`;
  return `reference.ilike.${quoted},title.ilike.${quoted}`;
}

export function buildOrdersSearchOrFilter(input: {
  q: string;
  matchingClientIds: string[];
}): string {
  const parts = [buildOrdersTextSearchOrFilter(input.q)];
  const ids = input.matchingClientIds.filter((id) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  );
  if (ids.length > 0) {
    parts.push(`client_id.in.(${ids.join(",")})`);
  }
  return parts.join(",");
}
