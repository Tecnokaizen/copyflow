// SUR4 (contract §5, N16 and N21): names of the amounts and of the job text.
// Without order_custom_labels every tenant keeps today's names.
export type OrderLabels = {
  total: string;
  paid: string;
  due: string;
  description: string;
};

const STANDARD_LABELS: OrderLabels = {
  total: "Total del pedido",
  paid: "Entregado a cuenta",
  due: "Pendiente de cobro",
  description: "Instrucciones",
};

const CUSTOM_LABELS: OrderLabels = {
  total: "Total pedido",
  paid: "A cuenta",
  due: "Falta por abonar",
  description: "Descripción",
};

export function orderLabels({ custom }: { custom: boolean }): OrderLabels {
  return custom ? CUSTOM_LABELS : STANDARD_LABELS;
}

// The customer receipt always titles the job box this way (N12).
export const RECEIPT_DESCRIPTION_TITLE = "Descripción del trabajo";
