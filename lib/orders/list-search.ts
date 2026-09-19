/**
 * List search (`q`) for GET /api/orders.
 *
 * PostgREST maps `*` → `%` for like/ilike even inside double quotes, so literal
 * `*` cannot be expressed via ILIKE through the API. We use `imatch` (~*) with
 * a regex contains pattern instead.
 *
 * Escape is split into two layers:
 * 1) regex literal (user text is not a pattern)
 * 2) PostgREST filter-value quoting inside `.or(...)`
 */

/** A. Normalize user input: trim + max 80; preserve characters. */
export function normalizeOrdersListQuery(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, 80);
}

/**
 * B. Escape user text so it is literal inside a PostgreSQL POSIX regex.
 * Only the outer `.*` we add mean "contains".
 */
export function escapeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Case-insensitive contains pattern for `imatch` / `~*`. */
export function buildOrdersContainsRegex(q: string): string {
  return `.*${escapeRegexLiteral(q)}.*`;
}

/**
 * C. Quote a filter value for PostgREST (inside `.or()`).
 * Doubles `\` and escapes `"`, then wraps in double quotes so reserved
 * characters (`,`, `.`, `:`, `*`, `(`, `)`) stay inside one value.
 */
export function quotePostgrestFilterValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/** Quoted regex value ready for `reference.imatch.` / `title.imatch.` in `.or()`. */
export function buildOrdersQuotedContainsRegex(q: string): string {
  return quotePostgrestFilterValue(buildOrdersContainsRegex(q));
}

/**
 * Top-level PostgREST `or` clause for list search.
 * Client match participates via empty embed `client_search` + `not.is.null`
 * (name imatch is applied separately on the embed).
 */
export function buildOrdersListSearchOrClause(q: string): string {
  const quoted = buildOrdersQuotedContainsRegex(q);
  return `reference.imatch.${quoted},title.imatch.${quoted},client_search.not.is.null`;
}

/** Empty embed alias used only for filtering; keep `client:clients(*)` for DTO. */
export const ORDERS_CLIENT_SEARCH_EMBED = "client_search:clients()";

/** Unquoted regex for direct embed filters (`client_search.name=imatch...`). */
export function buildOrdersClientNameImatchValue(q: string): string {
  return buildOrdersContainsRegex(q);
}
