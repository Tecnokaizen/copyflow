import type { PrintInvoice } from "@/lib/print/types";

/**
 * The invoice states as printed. null = Sin indicar (no box ticked, both
 * groups printed empty); «Entregada» is dropped only when the answer is No.
 * A delivery value is only kept when the order requires an invoice.
 */
export function printInvoice(
  required: boolean | null | undefined,
  delivered: boolean | null | undefined
): PrintInvoice {
  const isRequired = required ?? null;
  return {
    required: isRequired,
    delivered: isRequired === true ? delivered ?? null : null,
  };
}
