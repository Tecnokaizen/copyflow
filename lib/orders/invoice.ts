/**
 * «Requiere factura» / «Factura entregada» (orders.invoice_required,
 * orders.invoice_delivered). Only recorded states: Gestcopy issues no invoice.
 * null means «Sin indicar». Same rules as change_order_invoice_v1.
 */

export type InvoiceState = {
  invoice_required: boolean | null;
  invoice_delivered: boolean | null;
};

export type InvoicePayloadResult =
  | { ok: true; value: InvoiceState }
  | { ok: false; error: string };

function readTriState(value: unknown): boolean | null | undefined {
  if (value === null || value === true || value === false) return value;
  return undefined;
}

/**
 * Server-side validation of the PATCH body. Both keys are required (true,
 * false or null). «Entregada: Sí» without «Requiere factura: Sí» is refused;
 * any other delivery value is normalised to null when not required.
 */
export function parseInvoicePayload(body: Record<string, unknown>): InvoicePayloadResult {
  const required = readTriState(body.invoice_required);
  const delivered = readTriState(body.invoice_delivered);

  if (required === undefined || delivered === undefined) {
    return {
      ok: false,
      error: "invoice_required and invoice_delivered must be true, false or null",
    };
  }

  if (delivered === true && required !== true) {
    return {
      ok: false,
      error: "invoice_delivered requires invoice_required",
    };
  }

  return {
    ok: true,
    value: {
      invoice_required: required,
      invoice_delivered: required === true ? delivered : null,
    },
  };
}

/** UI value of a tri-state select: "yes" | "no" | "" (Sin indicar). */
export function invoiceSelectValue(value: boolean | null | undefined): "yes" | "no" | "" {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

export function invoiceFromSelectValue(value: string): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

export function formatInvoiceFlag(value: boolean | null | undefined): string {
  if (value === true) return "Sí";
  if (value === false) return "No";
  return "Sin indicar";
}
