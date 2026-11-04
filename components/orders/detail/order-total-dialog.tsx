"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { OrderCollection } from "@/lib/orders/collection";
import type { OrderItemsState } from "@/lib/orders/items";
import { canonicalMoney, formatOrderMoney } from "@/lib/orders/money";
import { DEFAULT_ORDER_TAX_RATE, taxRateLabel, taxRateOptions } from "@/lib/orders/tax-rates";
import {
  applyRateToAll,
  compareMoney,
  duplicateRow,
  emptyRow,
  firstInvalidRow,
  hasDiscounts,
  initialMode,
  initialPricesIncludeTax,
  itemsPayload,
  removeRow,
  rowFromItem,
  summarizeRows,
  type CalculatorMode,
  type CalculatorRow,
} from "@/lib/orders/total-calculator";

type Props = {
  orderId: string;
  collection: OrderCollection;
  title: string;
  onSaved: (collection: OrderCollection) => void;
  onCancel: () => void;
};

const CONFLICT_MESSAGE = "El pedido ha cambiado. Hemos actualizado los importes y conservado tus datos; revísalos y vuelve a guardar.";

/**
 * «Definir / Modificar total»: by concepts (lines, VAT included or added) or a
 * direct amount. Previews amounts while typing; the database calculates and
 * stores the real ones. Payments are never changed here.
 */
export function OrderTotalDialog({ orderId, collection: initialCollection, title, onSaved, onCancel }: Props) {
  const [collection, setCollection] = useState(initialCollection);
  const [state, setState] = useState<OrderItemsState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [mode, setMode] = useState<CalculatorMode>("items");
  const [rows, setRows] = useState<CalculatorRow[]>([]);
  const [inclusive, setInclusive] = useState(true);
  const [commonRate, setCommonRate] = useState(DEFAULT_ORDER_TAX_RATE);
  const [direct, setDirect] = useState(initialCollection.total_amount?.replace(".", ",") ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [touched, setTouched] = useState(false);
  const keySeed = useRef(0);
  const nextKey = () => `row-${++keySeed.current}`;

  async function fetchState(): Promise<OrderItemsState> {
    const response = await fetch(`/api/orders/${orderId}/items`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "No se pudieron cargar las partidas");
    return body as OrderItemsState;
  }

  async function fetchCollection(): Promise<OrderCollection> {
    const response = await fetch(`/api/orders/${orderId}/payments`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "No se pudo cargar el cobro");
    return body as OrderCollection;
  }

  useEffect(() => {
    let cancelled = false;
    fetchState().then((loaded) => {
      if (cancelled) return;
      setState(loaded);
      setMode(initialMode(loaded));
      setInclusive(initialPricesIncludeTax(loaded));
      const loadedRows = loaded.items.map((item) => rowFromItem(item, nextKey()));
      setRows(loadedRows.length > 0 ? loadedRows : [emptyRow(nextKey())]);
      const rates = [...new Set(loadedRows.map((row) => row.tax_rate))];
      if (rates.length === 1) setCommonRate(rates[0]);
    }).catch((err: unknown) => {
      if (!cancelled) setLoadError(err instanceof Error ? err.message : "No se pudieron cargar las partidas");
    });
    return () => { cancelled = true; };
    // Load once per opening; later refreshes keep the user's edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  const summary = useMemo(() => summarizeRows(rows, inclusive), [rows, inclusive]);
  const invalidRow = firstInvalidRow(rows, summary);
  const belowPaid = compareMoney(summary.total, collection.paid_amount) === -1;
  const directAmount = canonicalMoney(direct, true);
  const directBelowPaid = compareMoney(directAmount, collection.paid_amount) === -1;
  const paid = compareMoney(collection.paid_amount, "0.00") === 1;
  const savedLines = state?.items.length ?? 0;
  const itemsMode = state?.total_mode === "items";

  function update(index: number, patch: Partial<CalculatorRow>) {
    setTouched(true);
    setErrorRow(null);
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  /** After a 409: refresh version and amounts, keep what the user typed. */
  async function refreshAfterConflict() {
    try {
      const [loaded, latest] = await Promise.all([fetchState(), fetchCollection()]);
      setState(loaded);
      setCollection(latest);
      setError(CONFLICT_MESSAGE);
    } catch {
      setError("El pedido ha cambiado. No se pudieron actualizar los importes; cierra el diálogo y vuelve a abrirlo antes de guardar.");
    }
  }

  async function saveItems() {
    if (!state) return;
    if (invalidRow !== null) {
      setErrorRow(invalidRow);
      setError(`Revisa la partida ${invalidRow + 1}: concepto, cantidad, precio e IVA.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemsPayload(rows, inclusive, state.row_version)),
      });
      const body = await response.json();
      if (response.status === 409 && body.code === "conflict") {
        await refreshAfterConflict();
        return;
      }
      if (!response.ok) {
        if (typeof body.index === "number") setErrorRow(body.index);
        throw new Error(body.error ?? "No se pudieron guardar las partidas");
      }
      onSaved(body.collection as OrderCollection);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron guardar las partidas");
    } finally {
      setBusy(false);
    }
  }

  async function saveDirect() {
    if (!state || !directAmount) {
      setError("El importe no es válido.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/total`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // One atomic call: when the total came from lines, the database leaves
        // items mode and sets the amount together, or does nothing.
        body: JSON.stringify({ total_amount: directAmount, expected_version: state.row_version, ...(itemsMode ? { leave_items: true } : {}) }),
      });
      const body = await response.json();
      if (response.status === 409 && body.code === "conflict") {
        await refreshAfterConflict();
        return;
      }
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar el total");
      onSaved(body as OrderCollection);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el total");
    } finally {
      setBusy(false);
    }
  }

  const confirmDisabled = busy || !state || (mode === "items" ? belowPaid || rows.length === 0 : !directAmount || directBelowPaid);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="order-total-dialog-title"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-4xl overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-5 shadow-lg">
        <h3 id="order-total-dialog-title" className="text-lg font-semibold tracking-tight">{title}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          El total no puede quedar por debajo de lo ya entregado a cuenta. Las entregas y su historial no cambian.
        </p>

        {loadError ? <p role="alert" className="mt-4 text-sm text-destructive">{loadError}</p> : null}
        {!state && !loadError ? <p className="mt-4 text-sm text-muted-foreground">Cargando partidas…</p> : null}

        {state ? (
          <div className="mt-4 grid gap-4">
            <div role="tablist" aria-label="Forma de calcular el total" className="inline-flex w-full rounded-[var(--radius)] border border-border p-1 sm:w-auto sm:justify-self-start">
              {([["items", "Por conceptos"], ["direct", "Importe directo"]] as const).map(([value, label]) => (
                <button key={value} type="button" role="tab" aria-selected={mode === value}
                  className={`min-h-10 flex-1 rounded-[calc(var(--radius)-2px)] px-4 text-sm font-medium sm:flex-none ${mode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                  disabled={busy} onClick={() => { setMode(value); setError(null); }}>
                  {label}
                </button>
              ))}
            </div>

            {paid ? (
              <p className="text-sm">Ya entregado a cuenta: <strong>{formatOrderMoney(collection.paid_amount)}</strong></p>
            ) : null}

            {mode === "items" ? (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <input type="checkbox" className="size-4" checked={inclusive} disabled={busy}
                      onChange={(event) => { setTouched(true); setInclusive(event.target.checked); }} />
                    Precios con IVA incluido
                  </label>
                  <div className="flex items-center gap-2 text-sm">
                    <label htmlFor="order-total-common-rate">IVA para todas</label>
                    <select id="order-total-common-rate" className="gc-field-control w-24" value={commonRate} disabled={busy}
                      onChange={(event) => setCommonRate(event.target.value)}>
                      {taxRateOptions(commonRate).map((rate) => <option key={rate} value={rate}>{taxRateLabel(rate)}</option>)}
                    </select>
                    <Button type="button" variant="outline" size="sm" className="min-h-10" disabled={busy}
                      onClick={() => { setTouched(true); setRows((current) => applyRateToAll(current, commonRate)); }}>
                      Aplicar
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {inclusive
                    ? "Los precios son finales: el total es la suma de los importes y se desglosan base imponible e IVA."
                    : "Los precios son base imponible: el IVA de cada partida se suma al total."}
                </p>

                {state.total_mode === "manual" && savedLines > 0 && !touched ? (
                  <p className="rounded-[var(--radius)] border border-border bg-muted/40 p-3 text-sm">
                    Estas partidas están guardadas como referencia y ahora no determinan el total. Al guardar, el total pasará a calcularse con ellas.
                  </p>
                ) : null}
                {hasDiscounts(rows) ? (
                  <p className="text-xs text-muted-foreground">Alguna partida tiene un descuento guardado: se conserva y su importe ya lo incluye.</p>
                ) : null}

                <div className="grid gap-2">
                  <div className="hidden gap-2 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_5.5rem_7rem_6rem_6.5rem_5.5rem]">
                    <span>Concepto</span><span>Cantidad</span><span>Precio unitario</span><span>IVA</span><span className="text-right">Importe</span><span />
                  </div>
                  {rows.map((row, index) => {
                    const line = summary.lines[index];
                    const highlighted = errorRow === index;
                    return (
                      <div key={row.key} data-testid="order-total-row"
                        className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 rounded-[var(--radius)] border p-2 sm:grid-cols-[minmax(0,1fr)_5.5rem_7rem_6rem_6.5rem_5.5rem] sm:items-center sm:border-0 sm:p-1 ${highlighted ? "border-destructive" : "border-border"}`}>
                        <input aria-label={`Concepto de la partida ${index + 1}`} className="gc-field-control col-span-2 sm:col-span-1"
                          value={row.concept} maxLength={2000} placeholder="Concepto" disabled={busy}
                          aria-invalid={highlighted || undefined} onChange={(event) => update(index, { concept: event.target.value })} />
                        {/* Visible labels on phones; the desktop header row names the columns. */}
                        <label className="grid min-w-0 gap-1">
                          <span aria-hidden="true" className="text-xs text-muted-foreground sm:hidden">Cantidad</span>
                          <input aria-label={`Cantidad de la partida ${index + 1}`} className="gc-field-control w-full min-w-0" inputMode="decimal"
                            value={row.quantity} disabled={busy} onChange={(event) => update(index, { quantity: event.target.value })} />
                        </label>
                        <label className="grid min-w-0 gap-1">
                          <span aria-hidden="true" className="text-xs text-muted-foreground sm:hidden">Precio unitario</span>
                          <input aria-label={`Precio unitario de la partida ${index + 1}`} className="gc-field-control w-full min-w-0" inputMode="decimal"
                            value={row.unit_price} placeholder="0,00" disabled={busy} onChange={(event) => update(index, { unit_price: event.target.value })} />
                        </label>
                        <label className="grid min-w-0 gap-1">
                          <span aria-hidden="true" className="text-xs text-muted-foreground sm:hidden">IVA</span>
                          <select aria-label={`IVA de la partida ${index + 1}`} className="gc-field-control w-full min-w-0" value={row.tax_rate} disabled={busy}
                            onChange={(event) => update(index, { tax_rate: event.target.value })}>
                            {taxRateOptions(row.tax_rate).map((rate) => <option key={rate} value={rate}>{taxRateLabel(rate)}</option>)}
                          </select>
                        </label>
                        <div className="grid gap-1 self-end text-right sm:self-center">
                          <span aria-hidden="true" className="text-xs text-muted-foreground sm:hidden">Importe</span>
                          <span className="text-sm font-medium tabular-nums" aria-label={`Importe de la partida ${index + 1}`}>
                            {line ? formatOrderMoney(line.total) : "—"}
                          </span>
                        </div>
                        <div className="col-span-2 flex justify-end gap-1 sm:col-span-1">
                          <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2" disabled={busy || rows.length >= 500}
                            aria-label={`Duplicar la partida ${index + 1}`} title="Duplicar"
                            onClick={() => { setTouched(true); setRows((current) => duplicateRow(current, index, nextKey())); }}>⧉</Button>
                          <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2" disabled={busy || rows.length <= 1}
                            aria-label={`Eliminar la partida ${index + 1}`} title="Eliminar"
                            onClick={() => { setTouched(true); setErrorRow(null); setRows((current) => removeRow(current, index)); }}>✕</Button>
                        </div>
                      </div>
                    );
                  })}
                  <div>
                    <Button type="button" variant="outline" size="sm" className="min-h-10" disabled={busy || rows.length >= 500}
                      onClick={() => { setTouched(true); setRows((current) => [...current, emptyRow(nextKey(), commonRate)]); }}>
                      Añadir partida
                    </Button>
                  </div>
                </div>

                <dl className="ml-auto grid w-full max-w-sm gap-1 text-sm">
                  {summary.breakdown.length > 1 ? summary.breakdown.map((row) => (
                    <div key={row.tax_rate} className="flex justify-between text-muted-foreground">
                      <dt>Base {taxRateLabel(row.tax_rate)} · IVA</dt>
                      <dd className="tabular-nums">{formatOrderMoney(row.subtotal)} · {formatOrderMoney(row.tax_amount)}</dd>
                    </div>
                  )) : null}
                  <div className="flex justify-between"><dt>Base imponible</dt><dd className="tabular-nums">{formatOrderMoney(summary.subtotal)}</dd></div>
                  <div className="flex justify-between"><dt>IVA</dt><dd className="tabular-nums">{formatOrderMoney(summary.tax_total)}</dd></div>
                  <div className="flex justify-between border-t border-border pt-1 text-base font-semibold"><dt>Total</dt><dd className="tabular-nums" data-testid="order-total-preview">{formatOrderMoney(summary.total)}</dd></div>
                  <p className="text-xs text-muted-foreground">Vista previa. Al guardar, los importes se calculan y guardan en el servidor.</p>
                </dl>
                {belowPaid ? <p role="alert" className="text-sm text-destructive">El total quedaría por debajo de lo ya entregado a cuenta.</p> : null}
              </>
            ) : (
              <>
                <label className="grid max-w-xs gap-1 text-sm">
                  Importe
                  <input className="gc-field-control" inputMode="decimal" value={direct} disabled={busy}
                    onChange={(event) => setDirect(event.target.value)} />
                </label>
                {savedLines > 0 ? (
                  <p className="rounded-[var(--radius)] border border-border bg-muted/40 p-3 text-sm">
                    {itemsMode
                      ? `Ahora el total sale de ${savedLines} ${savedLines === 1 ? "partida" : "partidas"} (${formatOrderMoney(state.items_total)}). Al guardar un importe directo, las partidas se conservan como referencia y dejan de determinar el total.`
                      : `Hay ${savedLines} ${savedLines === 1 ? "partida guardada" : "partidas guardadas"} como referencia (${formatOrderMoney(state.items_total)}). No determinan el total.`}
                  </p>
                ) : null}
                {directBelowPaid ? <p role="alert" className="text-sm text-destructive">El total quedaría por debajo de lo ya entregado a cuenta.</p> : null}
              </>
            )}
          </div>
        ) : null}

        {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy} className="min-h-11 w-full sm:w-auto">Cancelar</Button>
          <Button type="button" onClick={() => { void (mode === "items" ? saveItems() : saveDirect()); }}
            disabled={confirmDisabled} className="min-h-11 w-full sm:w-auto">
            {busy ? "Procesando…" : mode === "items" ? "Guardar partidas" : "Guardar total"}
          </Button>
        </div>
      </div>
    </div>
  );
}
