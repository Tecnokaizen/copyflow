"use client";

import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { DateTimePicker } from "@/components/gestcopy/date-time-picker";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { FactRow, FactValue } from "@/components/orders/detail/order-field";
import type { OrderCollection, OrderPayment } from "@/lib/orders/collection";
import { formatDate, fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/orders/format";
import { collectionLabel, formatOrderMoney } from "@/lib/orders/money";

export function OrderCollection({
  orderId,
  canWrite,
  archived,
  editing = false,
  onChanged,
  onInteractionChange,
}: {
  orderId: string;
  canWrite: boolean;
  archived: boolean;
  editing?: boolean;
  onChanged: () => void;
  onInteractionChange?: (active: boolean) => void;
}) {
  const [collection, setCollection] = useState<OrderCollection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [totalOpen, setTotalOpen] = useState(false);
  const [voiding, setVoiding] = useState<OrderPayment | null>(null);
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState("");
  const [totalDraft, setTotalDraft] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onInteractionChange?.(busy || paymentOpen || totalOpen || voiding !== null);
  }, [busy, paymentOpen, totalOpen, voiding, onInteractionChange]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/orders/${orderId}/payments`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error ?? "No se pudo cargar el cobro");
        }
        return body as OrderCollection;
      })
      .then((next) => {
        if (!cancelled) {
          setCollection(next);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No se pudo cargar el cobro");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  async function submit(url: string, payload: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: url.endsWith("/total") ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "No se pudo guardar");
      }
      setCollection(body as OrderCollection);
      setPaymentOpen(false);
      setTotalOpen(false);
      setVoiding(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar");
    } finally {
      setBusy(false);
    }
  }

  function openPayment() {
    setAmount("");
    setPaidAt(toDateTimeLocalValue(new Date().toISOString()));
    setIdempotencyKey(crypto.randomUUID());
    setPaymentOpen(true);
  }

  const actionsEnabled = canWrite && !archived && !editing;

  return (
    <div className="border-t border-border/60">
      {loading ? <LoadingState label="Cargando cobro…" className="px-0 py-6" /> : null}
      {error ? <p className="px-0 py-3 text-sm text-destructive">{error}</p> : null}
      {collection ? (
        <>
          <FactRow label="Total del pedido" emphasis>
            <FactValue value={collection.total_amount ? formatOrderMoney(collection.total_amount) : null} empty="Sin definir" />
          </FactRow>
          <FactRow label="Entregado a cuenta">
            <FactValue value={formatOrderMoney(collection.paid_amount)} />
          </FactRow>
          <FactRow label="Pendiente de cobro" emphasis>
            <FactValue value={collection.pending_amount ? formatOrderMoney(collection.pending_amount) : null} empty="Sin definir" />
          </FactRow>
          <FactRow label="Situación">
            <FactValue value={collectionLabel(collection.collection_state)} />
          </FactRow>
          {actionsEnabled ? (
            <div className="flex flex-wrap gap-2 py-3">
              <button type="button" className="gc-action" onClick={() => { setTotalDraft(collection.total_amount ?? ""); setTotalOpen(true); }}>
                {collection.total_amount ? "Modificar total" : "Definir total"}
              </button>
              <button type="button" className="gc-cta" disabled={!collection.total_amount} onClick={openPayment}>
                Registrar entrega a cuenta
              </button>
            </div>
          ) : null}
          {canWrite && !archived && editing ? (
            <p className="py-3 text-sm text-muted-foreground">
              Guarda o cancela la edición para modificar el cobro.
            </p>
          ) : null}
          {actionsEnabled && !collection.total_amount ? (
            <p className="pb-3 text-sm text-muted-foreground">
              Define el total del pedido antes de registrar una entrega a cuenta.
            </p>
          ) : null}
          {collection.payments.length > 0 ? (
            <ul className="pb-2">
              {collection.payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 py-3 text-sm">
                  <div>
                    <div className="font-medium">{formatOrderMoney(payment.amount)}</div>
                    <div className="text-muted-foreground">
                      {payment.actor_name ?? "Usuario"} · {formatDate(payment.paid_at)}
                      {payment.voided_at ? " · Anulada" : ""}
                    </div>
                  </div>
                  {actionsEnabled && !payment.voided_at ? (
                    <button type="button" className="text-sm text-muted-foreground underline-offset-2 hover:underline" onClick={() => { setReason(""); setVoiding(payment); }}>
                      Anular
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {actionsEnabled && paymentOpen && collection ? (
        <ConfirmDialog
          title="Registrar entrega a cuenta"
          description="Esta entrega se añade al historial. No sustituye a las anteriores."
          confirmLabel="Confirmar entrega"
          busy={busy}
          confirmDisabled={!fromDateTimeLocalValue(paidAt)}
          onCancel={() => { if (!busy) setPaymentOpen(false); }}
          onConfirm={() => {
            const iso = fromDateTimeLocalValue(paidAt);
            if (!iso) return;
            void submit(`/api/orders/${orderId}/payments`, {
              amount,
              paid_at: iso,
              idempotency_key: idempotencyKey,
            });
          }}
        >
          <label className="grid gap-1 text-sm">
            Importe
            <input className="gc-field-control" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <div className="mt-3">
            <DateTimePicker value={paidAt} onChange={setPaidAt} disabled={busy} />
          </div>
        </ConfirmDialog>
      ) : null}

      {actionsEnabled && totalOpen && collection ? (
        <ConfirmDialog
          title="Total del pedido"
          description="El total no puede quedar por debajo de lo ya entregado a cuenta."
          confirmLabel="Guardar total"
          busy={busy}
          onCancel={() => { if (!busy) setTotalOpen(false); }}
          onConfirm={() => {
            void submit(`/api/orders/${orderId}/total`, {
              total_amount: totalDraft,
              expected_version: collection.row_version,
            });
          }}
        >
          <label className="grid gap-1 text-sm">
            Importe
            <input className="gc-field-control" inputMode="decimal" value={totalDraft} onChange={(event) => setTotalDraft(event.target.value)} />
          </label>
        </ConfirmDialog>
      ) : null}

      {actionsEnabled && voiding ? (
        <ConfirmDialog
          title="Anular entrega"
          description={`Se anula ${formatOrderMoney(voiding.amount)}. El movimiento permanece en el historial.`}
          confirmLabel="Anular entrega"
          destructive
          busy={busy}
          confirmDisabled={reason.trim().length === 0}
          onCancel={() => { if (!busy) setVoiding(null); }}
          onConfirm={() => {
            void submit(`/api/orders/${orderId}/payments/${voiding.id}/void`, { reason });
          }}
        >
          <label className="grid gap-1 text-sm">
            Motivo
            <textarea className="gc-field-control min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
