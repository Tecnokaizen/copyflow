"use client";

import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { DateTimePicker } from "@/components/gestcopy/date-time-picker";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { FactRow, FactValue } from "@/components/orders/detail/order-field";
import type { OrderCollection, OrderPayment } from "@/lib/orders/collection";
import { formatDate, fromDateTimeLocalValue, toDateTimeLocalValue } from "@/lib/orders/format";
import { paymentPendingStorageKey } from "@/lib/orders/payment-pending";
import { PAYMENT_METHODS, isPaymentMethod, paymentMethodLabel, type PaymentMethod } from "@/lib/orders/payment-methods";
import { parsePaymentPayload, type PaymentPayload } from "@/lib/orders/payment-payload";
import { canonicalMoney } from "@/lib/orders/money";
import { ORDER_FILE_ACCEPT, completeOrderFileUpload, requestOrderFileDownload, triggerBrowserDownload, uploadOrderFile } from "@/lib/files/client";
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
  const [paidAtInvalid, setPaidAtInvalid] = useState(false);
  const [totalDraft, setTotalDraft] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const receiptId = useRef<string | null>(null);
  const completeId = useRef<string | null>(null);
  const paymentAttempt = useRef<PaymentPayload | null>(null);
  const pendingKeyRef = useRef<string | null>(null);
  const paymentBusy = useRef(false);
  const [attemptPending, setAttemptPending] = useState(false);
  const [uploadStatus, setUploadStatus] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
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

  async function loadLatestCollection(): Promise<OrderCollection> {
    const response = await fetch(`/api/orders/${orderId}/payments`, {
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error ?? "No se pudo actualizar el cobro");
    }
    return body as OrderCollection;
  }

  async function openTotal() {
    setBusy(true);
    setError(null);
    try {
      // The parent order may have changed while this component stayed mounted.
      // Refresh the server row_version before opening an optimistic-concurrency form.
      const latest = await loadLatestCollection();
      setCollection(latest);
      setTotalDraft(latest.total_amount ?? "");
      setTotalOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el cobro");
    } finally {
      setBusy(false);
    }
  }

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
        if (response.status === 409) {
          // Never retry a monetary write automatically: the user must verify
          // the latest total and decide whether to submit again.
          try {
            setCollection(await loadLatestCollection());
          } catch {
            // Preserve the original conflict rather than obscuring it.
          }
          throw new Error("El pedido ha cambiado. Hemos actualizado los importes; revisa el total y vuelve a confirmar.");
        }
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

  async function pendingKeyForCurrentSession() {
    const response = await fetch("/api/context", { cache: "no-store" });
    if (!response.ok) return null;
    const body = await response.json();
    const tenantId = body?.tenant?.id;
    const userId = body?.user?.id;
    if (typeof tenantId !== "string" || typeof userId !== "string") return null;
    return paymentPendingStorageKey(tenantId, userId, orderId);
  }

  async function openPayment() {
    setError(null);
    setUploadStatus("");
    setPaidAtInvalid(false);
    setReceiptFile(null);
    receiptId.current = null;
    completeId.current = null;
    const pendingKey = await pendingKeyForCurrentSession();
    if (!pendingKey) {
      setError("No se ha podido comprobar la sesión. Vuelve a intentarlo.");
      return;
    }
    pendingKeyRef.current = pendingKey;
    // A lost payment response must survive closing the popup or reloading.
    // Restoring only opens the form; the user explicitly confirms the replay.
    // The key includes tenant and user, so another person on this browser
    // cannot resume this confirmation.
    let pending: PaymentPayload | null = null;
    try {
      const saved = sessionStorage.getItem(pendingKey);
      pending = saved ? parsePaymentPayload(JSON.parse(saved)) : null;
    } catch {
      setError("No se pudo recuperar la confirmación. Revisa el historial antes de registrar una nueva entrega.");
      return;
    }
    paymentAttempt.current = pending;
    setAttemptPending(Boolean(pending));
    setAmount(pending?.amount ?? "");
    setMethod(pending?.payment_method ?? "");
    setPaidAt(toDateTimeLocalValue(pending?.paid_at ?? new Date().toISOString()));
    setIdempotencyKey(pending?.idempotency_key ?? crypto.randomUUID());
    if (pending) setError("Hay una confirmación pendiente. Vuelve a confirmar con los mismos datos para comprobarla sin duplicar la entrega.");
    setPaymentOpen(true);
  }

  async function submitPayment() {
    if (paymentBusy.current) return;
    const iso = fromDateTimeLocalValue(paidAt);
    if (!paymentAttempt.current && (paidAtInvalid || !iso || !isPaymentMethod(method) || !canonicalMoney(amount, false))) return;
    paymentBusy.current = true;
    setBusy(true);
    setError(null);
    try {
      const pendingKey = await pendingKeyForCurrentSession();
      if (!pendingKey || pendingKey !== pendingKeyRef.current) {
        throw new Error("La sesión ha cambiado. Revisa el historial antes de registrar una entrega.");
      }
      let payload = paymentAttempt.current;
      if (!payload) {
        if (receiptFile && !receiptId.current) {
          if (completeId.current) {
            setUploadStatus("Confirmando justificante…");
            await completeOrderFileUpload(orderId, completeId.current);
            receiptId.current = completeId.current;
            completeId.current = null;
          } else {
            try {
              const uploaded = await uploadOrderFile(orderId, receiptFile, {
                onPhase: (phase) => setUploadStatus(phase === "initializing" ? "Preparando justificante…" : phase === "completing" ? "Confirmando justificante…" : "Subiendo justificante…"),
                onProgress: (percent) => setUploadStatus(`Subiendo justificante: ${percent} %`),
              });
              receiptId.current = uploaded.fileId;
            } catch (err) {
              // COMPLETE may have succeeded but lost its response. Retry this
              // file's COMPLETE rather than re-uploading or recording any money.
              if (err && typeof err === "object" && "fileId" in err && typeof err.fileId === "string") {
                completeId.current = err.fileId;
              }
              throw err;
            }
          }
        }
        payload = parsePaymentPayload({ amount, paid_at: iso, payment_method: method,
          idempotency_key: idempotencyKey, receipt_file_id: receiptId.current });
        if (!payload) throw new Error("Revisa los datos de la entrega.");
        // Persist the exact request BEFORE sending money. An uncertain response
        // locks all fields and keeps the same request through manual retries.
        sessionStorage.setItem(pendingKey, JSON.stringify(payload));
        paymentAttempt.current = payload;
        setAttemptPending(true);
      }
      setUploadStatus("Confirmando entrega…");
      const response = await fetch(`/api/orders/${orderId}/payments`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        // 422 explicitly means no payment was inserted. Network errors/5xx and
        // conflicts remain locked: never turn an uncertain result into a new key.
        if (response.status === 422) {
          sessionStorage.removeItem(pendingKey);
          paymentAttempt.current = null;
          setAttemptPending(false);
        }
        throw new Error(body.error ?? "No se pudo confirmar la entrega. Vuelve a confirmar con los mismos datos.");
      }
      sessionStorage.removeItem(pendingKey);
      paymentAttempt.current = null;
      setAttemptPending(false);
      setCollection(body as OrderCollection);
      setPaymentOpen(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo confirmar la entrega. Vuelve a confirmar con los mismos datos.");
    } finally {
      setUploadStatus("");
      paymentBusy.current = false;
      setBusy(false);
    }
  }

  async function downloadReceipt(payment: OrderPayment) {
    if (!payment.receipt) return;
    setDownloading(payment.id);
    setError(null);
    try {
      const result = await requestOrderFileDownload(orderId, payment.receipt.id);
      triggerBrowserDownload(result.download_url, result.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descargar el justificante.");
    } finally {
      setDownloading(null);
    }
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
              <button type="button" className="gc-action" disabled={busy} onClick={() => { void openTotal(); }}>
                {collection.total_amount ? "Modificar total" : "Definir total"}
              </button>
              <button type="button" className="gc-cta" disabled={busy || !collection.total_amount} onClick={() => { void openPayment(); }}>
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
                      {paymentMethodLabel(payment.payment_method)} · {payment.actor_name ?? "Usuario"} · {formatDate(payment.paid_at)}
                      {payment.voided_at ? " · Anulada" : ""}
                    </div>
                  </div>
                  {payment.receipt ? (
                    <button type="button" className="gc-action max-w-full break-all text-sm" disabled={downloading === payment.id} onClick={() => void downloadReceipt(payment)}>
                      {downloading === payment.id ? "Descargando…" : `Justificante: ${payment.receipt.original_name}`}
                    </button>
                  ) : <span className="text-xs text-muted-foreground">Sin justificante</span>}
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
          confirmDisabled={!attemptPending && (paidAtInvalid || !fromDateTimeLocalValue(paidAt) || !isPaymentMethod(method) || !canonicalMoney(amount, false))}
          onCancel={() => { if (!busy) setPaymentOpen(false); }}
          onConfirm={() => { void submitPayment(); }}
        >
          <label className="grid gap-1 text-sm">
            Importe
            <input className="gc-field-control" inputMode="decimal" value={amount} disabled={busy || attemptPending} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label className="mt-3 grid gap-1 text-sm">
            Método de pago
            <select className="gc-field-control" required value={method} disabled={busy || attemptPending} onChange={(event) => setMethod(event.target.value as PaymentMethod | "")}>
              <option value="">Selecciona un método</option>
              {PAYMENT_METHODS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="mt-3">
            <DateTimePicker value={paidAt} onChange={setPaidAt} onValidityChange={setPaidAtInvalid} disabled={busy || attemptPending} />
          </div>
          <label className="mt-3 grid gap-1 text-sm">
            Justificante (opcional)
            <input type="file" className="gc-field-control max-w-full text-xs" accept={ORDER_FILE_ACCEPT} disabled={busy || attemptPending}
              onChange={(event) => { setReceiptFile(event.target.files?.[0] ?? null); receiptId.current = null; completeId.current = null; }} />
          </label>
          {attemptPending ? <p className="mt-2 text-xs text-muted-foreground">Se conservan los datos y el justificante adjunto para comprobar esta confirmación.</p> : null}
          {uploadStatus ? <p role="status" className="mt-2 text-sm text-muted-foreground">{uploadStatus}</p> : null}
          {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
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
          {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
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
