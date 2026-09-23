export const OPEN_QUOTE_STATUS_CODES = [
  "draft",
  "pending",
  "sent",
  "accepted",
] as const;

export function quoteOperationalCounts(
  rows: Array<{ code: string; converted: boolean }>
) {
  const unconverted = rows.filter((row) => !row.converted);

  return {
    open: unconverted.filter((row) => row.code !== "rejected").length,
    in_review: unconverted.filter((row) => row.code === "pending").length,
    sent: unconverted.filter((row) => row.code === "sent").length,
    accepted_pending: unconverted.filter((row) => row.code === "accepted").length,
  };
}
