/**
 * Presentation helpers for billing subscription fields.
 * Persisted status codes stay English/Stripe-aligned; labels are UI-only.
 */

export const SUBSCRIPTION_STATUS_LABELS: Record<string, string> = {
  active: "Activa",
  trialing: "En prueba",
  past_due: "Pago pendiente",
  canceled: "Cancelada",
  unpaid: "Impagada",
  incomplete: "Incompleta",
  paused: "Pausada",
};

export function formatSubscriptionStatusLabel(
  status: string | null | undefined
): string {
  if (!status) {
    return "—";
  }
  return SUBSCRIPTION_STATUS_LABELS[status] ?? status;
}

function toMillis(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Compare provider timestamps at second precision (Stripe unix seconds). */
export function isSamePeriodInstant(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  if (!a || !b) {
    return false;
  }
  const aMs = toMillis(a);
  const bMs = toMillis(b);
  if (aMs == null || bMs == null) {
    return false;
  }
  return Math.trunc(aMs / 1000) === Math.trunc(bMs / 1000);
}

export function formatBillingDate(value: string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
  }).format(date);
}

/**
 * Human cancellation copy. Does not coerce cancel_at into cancel_at_period_end.
 */
export function formatCancellationLabel(input: {
  cancelAt: string | null | undefined;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null | undefined;
}): string {
  if (input.cancelAtPeriodEnd) {
    return "Cancelará al final del periodo";
  }

  if (!input.cancelAt) {
    return "No programada";
  }

  if (isSamePeriodInstant(input.cancelAt, input.currentPeriodEnd ?? null)) {
    return "Cancelará al final del periodo";
  }

  return `Cancelación programada para ${formatBillingDate(input.cancelAt)}`;
}

/** Stripe cancel_at unix seconds → ISO, or null. */
export function stripeCancelAtToIso(
  cancelAt: number | null | undefined
): string | null {
  if (
    typeof cancelAt !== "number" ||
    !Number.isFinite(cancelAt) ||
    cancelAt <= 0
  ) {
    return null;
  }
  return new Date(cancelAt * 1000).toISOString();
}
