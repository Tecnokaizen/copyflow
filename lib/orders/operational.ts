/**
 * Unified operational activity predicate for Gestcopy orders.
 *
 * Active (operational) :=
 *   archived_at IS NULL
 *   AND status.is_closed IS NOT TRUE
 *   AND status.is_cancelled IS NOT TRUE
 *
 * `delivered_at` is an audit timestamp and must NOT gate activity.
 */

export type OperationalStatusFlags = {
  is_closed?: boolean | null;
  is_cancelled?: boolean | null;
  is_ready?: boolean | null;
} | null | undefined;

export type OperationalOrderLike = {
  archived_at?: string | null;
  status?: OperationalStatusFlags;
};

export function isOrderArchived(order: {
  archived_at?: string | null;
}): boolean {
  return order.archived_at != null && String(order.archived_at).length > 0;
}

export function isOrderTerminal(order: {
  status?: OperationalStatusFlags;
}): boolean {
  return (
    order.status?.is_closed === true || order.status?.is_cancelled === true
  );
}

export function isOrderOperational(order: OperationalOrderLike): boolean {
  return !isOrderArchived(order) && !isOrderTerminal(order);
}

/**
 * Apply the shared operational filter to a Supabase orders query that
 * already joins `order_statuses` as `status` (inner join when needed).
 *
 * Typed loosely on purpose: constraining T to builder methods triggers
 * TS2589 (excessively deep instantiation) with supabase-js query chains.
 */
export function applyOperationalOrdersFilter<T>(query: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see note above
  let next: any = query;
  next = next.is("archived_at", null);
  next = next.eq("status.is_closed", false);
  next = next.eq("status.is_cancelled", false);
  return next as T;
}

/** Non-archived orders (active + closed + cancelled). */
export function applyNonArchivedOrdersFilter<T>(query: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see note above
  let next: any = query;
  next = next.is("archived_at", null);
  return next as T;
}

/** Soft-archived orders only. */
export function applyArchivedOrdersFilter<T>(query: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see note above
  let next: any = query;
  next = next.not("archived_at", "is", null);
  return next as T;
}
