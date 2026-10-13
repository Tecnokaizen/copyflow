/** True when Preview is ahead of the payment migration and PostgREST has no receipt link yet. */
export function receiptSchemaUnavailable(message: string): boolean {
  return /schema cache/i.test(message) && /order_payments|receipt_file_id/i.test(message);
}

export function receiptIdsFromRows(
  rows: Array<{ receipt_file_id?: unknown }> | null,
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows ?? []) {
    if (typeof row.receipt_file_id === "string" && row.receipt_file_id) {
      ids.add(row.receipt_file_id);
    }
  }
  return ids;
}

export function withReceiptMarker<T extends Record<string, unknown>>(
  row: T,
  linked: ReadonlySet<string>,
): T & { payment_receipts: { id: string }[] | null } {
  const id = row.id;
  return {
    ...row,
    payment_receipts:
      typeof id === "string" && linked.has(id) ? [{ id }] : null,
  };
}
