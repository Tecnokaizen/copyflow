export const PAYMENT_METHODS = [
  { value: "cash", label: "Efectivo" },
  { value: "card", label: "Tarjeta" },
  { value: "bizum", label: "Bizum" },
  { value: "transfer", label: "Transferencia" },
  { value: "other", label: "Otro" },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];
export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return PAYMENT_METHODS.some((method) => method.value === value);
}
export function paymentMethodLabel(value: PaymentMethod | null): string {
  return PAYMENT_METHODS.find((method) => method.value === value)?.label ?? "Sin especificar (histórico)";
}
