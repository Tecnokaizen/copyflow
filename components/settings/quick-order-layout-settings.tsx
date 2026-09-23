"use client";

import { useEffect, useMemo, useState } from "react";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import {
  DEFAULT_QUICK_ORDER_LAYOUT,
  QUICK_ORDER_FIELDS,
  QUICK_ORDER_FIELD_LABELS,
  layoutsEqual,
  userFacingQuickOrderLayoutSaveError,
  type QuickOrderLayout,
  type QuickOrderPlacement,
} from "@/lib/settings/quick-order-layout";

type SettingsResponse = {
  ok?: boolean;
  layout?: QuickOrderLayout;
  revision?: string;
  error?: string;
};

async function fetchQuickOrderSettings() {
  const response = await fetch(
    `/api/settings/quick-order-layout?ts=${Date.now()}`,
    {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    }
  );
  const result = (await response.json()) as SettingsResponse;

  if (!response.ok || !result.layout || !result.revision) {
    throw new Error(result.error ?? "No se pudo cargar la configuración");
  }

  return {
    layout: result.layout,
    revision: result.revision,
  };
}

export function QuickOrderLayoutSettings() {
  const [layout, setLayout] = useState<QuickOrderLayout | null>(null);
  const [savedLayout, setSavedLayout] = useState<QuickOrderLayout | null>(
    null
  );
  const [revision, setRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(() => {
    if (!layout || !savedLayout) {
      return false;
    }
    return !layoutsEqual(layout, savedLayout);
  }, [layout, savedLayout]);

  function applyLoaded(result: { layout: QuickOrderLayout; revision: string }) {
    setLayout(result.layout);
    setSavedLayout(result.layout);
    setRevision(result.revision);
  }

  async function load() {
    setLoading(true);
    setError(null);
    setSaved(false);

    try {
      applyLoaded(await fetchQuickOrderSettings());
    } catch (err) {
      setLayout(null);
      setSavedLayout(null);
      setRevision(null);
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la configuración"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function loadInitial() {
      try {
        const result = await fetchQuickOrderSettings();
        if (!active) return;
        applyLoaded(result);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo cargar la configuración"
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void loadInitial();
    return () => {
      active = false;
    };
  }, []);

  function setPlacement(field: (typeof QUICK_ORDER_FIELDS)[number], placement: QuickOrderPlacement) {
    setSaved(false);
    setError(null);
    setLayout((current) =>
      current ? { ...current, [field]: placement } : current
    );
  }

  async function save() {
    if (!layout || !revision || saving || !dirty) {
      if (!revision && !saving) {
        setError("No se pudo guardar porque falta la revisión de la configuración.");
      }
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch("/api/settings/quick-order-layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ layout, revision }),
      });
      let result: SettingsResponse = {};
      try {
        result = (await response.json()) as SettingsResponse;
      } catch {
        setError("No se pudo guardar la configuración. Inténtalo de nuevo.");
        return;
      }

      if (!response.ok || !result.layout || !result.revision) {
        if (response.status === 409) {
          try {
            applyLoaded(await fetchQuickOrderSettings());
          } catch {
            /* keep the PATCH error below */
          }
        }
        setError(
          userFacingQuickOrderLayoutSaveError(response.status) ??
            "No se pudo guardar la configuración. Inténtalo de nuevo."
        );
        return;
      }

      const confirmed = await fetchQuickOrderSettings();
      if (!layoutsEqual(confirmed.layout, layout)) {
        applyLoaded(confirmed);
        setError(
          "El servidor no confirmó la configuración guardada. Revisa la selección e inténtalo de nuevo."
        );
        return;
      }

      applyLoaded(confirmed);
      setSaved(true);
    } catch {
      setError("No se pudo guardar la configuración. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard bodyClassName="px-5 py-5 sm:px-6">
      {loading ? (
        <LoadingState label="Cargando configuración…" className="px-0 py-8" />
      ) : !layout ? (
        <ErrorState
          title="No se pudo cargar la configuración"
          description={error ?? undefined}
          onRetry={() => void load()}
          className="px-0 py-8"
        />
      ) : (
        <div className="grid gap-5">
          <fieldset
            disabled={saving}
            className="-mx-5 overflow-hidden border-y border-border/70 sm:-mx-6"
          >
            <legend className="sr-only">
              Campos visibles al crear un pedido rápido
            </legend>
            {QUICK_ORDER_FIELDS.map((field) => (
              <div key={field} className="flex min-h-12 flex-col gap-2 border-b border-border/60 px-5 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <label htmlFor={`quick-placement-${field}`} className="text-sm font-medium text-foreground">
                  {QUICK_ORDER_FIELD_LABELS[field]}
                </label>
                <select
                  id={`quick-placement-${field}`}
                  value={layout[field]}
                  disabled={saving}
                  onChange={(event) => setPlacement(field, event.target.value as QuickOrderPlacement)}
                  className="min-h-11 rounded-md border border-input bg-background px-3 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-48"
                >
                  <option value="primary">Principal</option>
                  <option value="more">Más opciones</option>
                  <option value="hidden">Oculto</option>
                </select>
              </div>
            ))}
          </fieldset>

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void save()}
              className="gc-cta min-h-11 w-full sm:w-auto disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar"}
            </button>
            <button
              type="button"
              disabled={saving || layoutsEqual(layout, DEFAULT_QUICK_ORDER_LAYOUT)}
              onClick={() => {
                setLayout({ ...DEFAULT_QUICK_ORDER_LAYOUT });
                setSaved(false);
                setError(null);
              }}
              className="gc-action min-h-11 w-full sm:w-auto"
            >
              Restaurar distribución actual
            </button>
            <div className="grid gap-1 sm:ml-1" aria-live="polite">
              {dirty ? (
                <p className="text-sm font-medium text-foreground">
                  Cambios sin guardar
                </p>
              ) : null}
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              {saved && !dirty ? (
                <p
                  className="text-sm font-medium text-[hsl(var(--gc-success))]"
                  role="status"
                >
                  Configuración guardada
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
