export const QUOTE_MESSAGES = {
  unauthorized: "No tienes acceso a presupuestos",
  notFound: "No se encontró el presupuesto",
  invalid: "Los datos del presupuesto no son válidos",
  description: "La descripción es obligatoria",
  version: "El presupuesto cambió. Recarga e inténtalo de nuevo",
  relation: "El dato relacionado no pertenece a esta organización",
  status: "El estado no pertenece a esta organización",
  date: "La fecha de validez no es válida",
  create: "No se pudo crear el presupuesto",
  update: "No se pudo guardar el presupuesto",
  convert: "No se pudo convertir el presupuesto",
  noInitialStatus: "La organización no tiene un estado inicial de pedido",
  noDraftStatus: "La organización no tiene el estado inicial de presupuesto",
} as const;

export type ConvertRpcBody = {
  ok?: boolean;
  created?: boolean;
  error?: string;
  order_id?: string;
  reference?: string;
};

export function interpretConvertResult(body: ConvertRpcBody) {
  if (body.ok === true && body.order_id && body.reference) {
    return {
      ok: true as const,
      created: body.created === true,
      replayed: body.created !== true,
      orderId: body.order_id,
      reference: body.reference,
    };
  }

  if (body.error === "no_initial_status") {
    return { ok: false as const, error: QUOTE_MESSAGES.noInitialStatus, status: 500 };
  }

  if (body.error === "invalid") {
    return { ok: false as const, error: QUOTE_MESSAGES.invalid, status: 400 };
  }

  return { ok: false as const, error: QUOTE_MESSAGES.notFound, status: 404 };
}
