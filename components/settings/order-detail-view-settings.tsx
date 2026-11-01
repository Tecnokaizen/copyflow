"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import {
  IMPLEMENTED_ORDER_DETAIL_VIEWS,
  ORDER_DETAIL_VIEW_PREVIEW_PARAM,
  ORDER_DETAIL_VIEWS,
  type OrderDetailViewCode,
} from "@/lib/orders/detail-views";
import {
  userFacingOrderDetailViewSaveError,
  type OrderDetailViewState,
} from "@/lib/settings/order-detail-view";
import { cn } from "@/lib/utils";

// Order Detail Views V1 — «Configuración › Personalización › Vista de pedidos».
// Owner/admin only (page and API). Only implemented views are offered.

const ORDER: OrderDetailViewCode[] = ["classic", "operational", "tabs", "production", "hybrid"];
const SELECTABLE = ORDER.filter((code) => IMPLEMENTED_ORDER_DETAIL_VIEWS.includes(code));

function viewTitle(code: OrderDetailViewCode) {
  const info = ORDER_DETAIL_VIEWS[code];
  return info.letter ? `${info.letter} · ${info.name}` : info.name;
}

async function fetchState(): Promise<OrderDetailViewState> {
  const response = await fetch("/api/settings/order-detail-view", { cache: "no-store" });
  if (!response.ok) throw new Error(userFacingOrderDetailViewSaveError(response.status) ?? "");
  return (await response.json()) as OrderDetailViewState;
}

function Capture({ code, kind }: { code: OrderDetailViewCode; kind: "desktop" | "mobile" }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static captures, no optimisation needed
    <img
      src={`/order-detail-views/${code}-${kind}.png`}
      alt={`${viewTitle(code)} en ${kind === "desktop" ? "escritorio" : "móvil"}`}
      loading="lazy"
      className={cn(
        "block rounded-[calc(var(--radius)-4px)] border border-border/70 bg-secondary/30 object-cover object-top",
        kind === "desktop" ? "aspect-[16/10] w-full" : "aspect-[9/19] w-full"
      )}
    />
  );
}

export function OrderDetailViewSettings({ sampleOrderId }: { sampleOrderId: string | null }) {
  const [state, setState] = useState<OrderDetailViewState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<OrderDetailViewCode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setState(await fetchState());
    } catch (err) {
      setLoadError(err instanceof Error && err.message ? err.message : "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
    void load();
  }, [load]);

  async function apply(view: OrderDetailViewCode) {
    if (!state || saving) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/order-detail-view", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view, revision: state.revision }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && result?.current) setState(result.current as OrderDetailViewState);
        setError(userFacingOrderDetailViewSaveError(response.status));
        return;
      }
      setState(result as OrderDetailViewState);
      setNotice(
        `Vista aplicada: «${viewTitle(view)}». Todo el equipo la verá al abrir o recargar un pedido.`
      );
    } catch {
      setError(userFacingOrderDetailViewSaveError(500));
    } finally {
      setSaving(false);
      setPending(null);
    }
  }

  if (loading && !state) return <LoadingState label="Cargando vistas…" />;
  if (!state) {
    return <ErrorState title={loadError ?? "No se pudo cargar la configuración."} onRetry={() => void load()} />;
  }

  const previous = state.previousView && state.previousView !== state.view ? state.previousView : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-border/70 bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          Vista aplicada ahora: <span className="font-semibold">{viewTitle(state.view)}</span>.{" "}
          <span className="text-muted-foreground">
            Es la misma para todo el equipo; solo cambia la distribución de la ficha, no los permisos ni los datos.
          </span>
        </p>
        {previous ? (
          <button
            type="button"
            disabled={saving}
            onClick={() => setPending(previous)}
            className="gc-action min-h-11 shrink-0 disabled:opacity-50"
          >
            Volver a «{viewTitle(previous)}»
          </button>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div role="status" className="rounded-[var(--radius)] border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground">
          {notice}
        </div>
      ) : null}

      {!sampleOrderId ? (
        <p className="text-sm text-muted-foreground">
          La vista previa necesita al menos un pedido sin archivar en tu organización.
        </p>
      ) : null}

      <ul className="grid gap-4 md:grid-cols-2" aria-label="Vistas de la ficha de pedido">
        {SELECTABLE.map((code) => {
          const info = ORDER_DETAIL_VIEWS[code];
          const applied = code === state.view;
          return (
            <li
              key={code}
              data-view-card={code}
              className={cn(
                "gc-card flex flex-col gap-4 p-4 sm:p-5",
                applied && "border-primary ring-1 ring-primary"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-foreground">{viewTitle(code)}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{info.summary}</p>
                </div>
                {applied ? <StatusBadge tone="brand">Aplicada</StatusBadge> : null}
              </div>
              <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,1fr)] items-start gap-3">
                <Capture code={code} kind="desktop" />
                <Capture code={code} kind="mobile" />
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                {sampleOrderId ? (
                  <Link
                    href={`/orders/${sampleOrderId}?${ORDER_DETAIL_VIEW_PREVIEW_PARAM}=${code}`}
                    className="gc-action min-h-11"
                  >
                    Vista previa
                  </Link>
                ) : null}
                <button
                  type="button"
                  disabled={applied || saving}
                  onClick={() => setPending(code)}
                  className="gc-cta min-h-11 disabled:opacity-50"
                >
                  {applied ? "Aplicada" : "Aplicar esta vista"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {pending ? (
        <ConfirmDialog
          title={`¿Aplicar «${viewTitle(pending)}»?`}
          description={`Todo el equipo verá la ficha de pedido con esta distribución. Las acciones, los permisos y los datos no cambian, y puedes volver a «${viewTitle(state.view)}» cuando quieras.`}
          confirmLabel="Aplicar vista"
          busy={saving}
          onCancel={() => {
            if (!saving) setPending(null);
          }}
          onConfirm={() => void apply(pending)}
        />
      ) : null}
    </div>
  );
}
