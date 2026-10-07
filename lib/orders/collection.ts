export type OrderPayment = {
  id: string;
  amount: string;
  paid_at: string;
  created_at: string;
  created_by: string | null;
  actor_name: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

export type OrderCollection = {
  total_amount: string | null;
  paid_amount: string;
  pending_amount: string | null;
  collection_state: string;
  row_version: string;
  payments: OrderPayment[];
};

const COLLECTION_ERRORS: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: "No se encontró el pedido" },
  forbidden: { status: 403, error: "No tienes permiso para modificar el cobro" },
  conflict: { status: 409, error: "El pedido cambió. Recarga la ficha e inténtalo de nuevo." },
  invalid_amount: { status: 422, error: "El importe no es válido." },
  total_undefined: {
    status: 422,
    error: "Define el total del pedido antes de registrar una entrega a cuenta.",
  },
  payment_exceeds_total: {
    status: 422,
    error: "La entrega supera el pendiente de cobro.",
  },
  total_below_paid: {
    status: 422,
    error: "El total no puede quedar por debajo de lo ya entregado.",
  },
  invalid_paid_at: { status: 422, error: "La fecha de la entrega no es válida." },
  invalid_idempotency_key: {
    status: 422,
    error: "No se pudo confirmar la entrega. Vuelve a intentarlo.",
  },
  idempotency_mismatch: {
    status: 409,
    error: "Esta confirmación ya se usó con otro importe.",
  },
  order_archived: {
    status: 409,
    error: "El pedido archivado no admite cambios de cobro.",
  },
  already_voided: { status: 409, error: "Esa entrega ya estaba anulada." },
  invalid_reason: { status: 422, error: "Indica el motivo de la anulación." },
};

export function collectionError(code: string | null | undefined) {
  return COLLECTION_ERRORS[code ?? ""] ?? {
    status: 500,
    error: "No se pudo actualizar el cobro.",
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asMoney(value: unknown): string | null {
  return typeof value === "string" && /^\d+\.\d{2}$/.test(value) ? value : null;
}

export function mapOrderCollection(value: unknown): OrderCollection | null {
  const row = asRecord(value);
  if (!row || row.ok !== true) {
    return null;
  }
  const paid = asMoney(row.paid_amount);
  const version = typeof row.row_version === "string" ? row.row_version : null;
  const state = typeof row.collection_state === "string" ? row.collection_state : null;
  if (!paid || !version || !state || !Array.isArray(row.payments)) {
    return null;
  }
  const payments: OrderPayment[] = [];
  for (const item of row.payments) {
    const payment = asRecord(item);
    const amount = asMoney(payment?.amount);
    if (!payment || typeof payment.id !== "string" || !amount || typeof payment.paid_at !== "string") {
      return null;
    }
    payments.push({
      id: payment.id,
      amount,
      paid_at: payment.paid_at,
      created_at: typeof payment.created_at === "string" ? payment.created_at : payment.paid_at,
      created_by: typeof payment.created_by === "string" ? payment.created_by : null,
      actor_name: typeof payment.actor_name === "string" ? payment.actor_name : null,
      voided_at: typeof payment.voided_at === "string" ? payment.voided_at : null,
      void_reason: typeof payment.void_reason === "string" ? payment.void_reason : null,
    });
  }
  return {
    total_amount: asMoney(row.total_amount),
    paid_amount: paid,
    pending_amount: row.pending_amount == null ? null : asMoney(row.pending_amount),
    collection_state: state,
    row_version: version,
    payments,
  };
}

type ProfileName = { id: string; full_name: string | null };

export async function withActorNames(
  collection: OrderCollection,
  loadProfiles: (ids: string[]) => Promise<ProfileName[]>
): Promise<OrderCollection> {
  const ids = [
    ...new Set(
      collection.payments
        .map((payment) => payment.created_by)
        .filter((userId): userId is string => Boolean(userId))
    ),
  ];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    for (const profile of await loadProfiles(ids)) {
      const name = typeof profile.full_name === "string" ? profile.full_name.trim() : "";
      if (profile.id && name) {
        names.set(profile.id, name);
      }
    }
  }
  return {
    ...collection,
    payments: collection.payments.map((payment) => ({
      ...payment,
      actor_name: payment.created_by ? (names.get(payment.created_by) ?? "Usuario") : null,
    })),
  };
}
