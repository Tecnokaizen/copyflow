import type { PrintInvoice } from "@/lib/print/types";

/**
 * The invoice states as printed. null = Sin indicar (no box ticked);
 * «Entregada» only when the order requires an invoice.
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
