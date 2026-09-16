"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import {
  DEFAULT_QUICK_ORDER_LAYOUT,
  QUICK_ORDER_FIELDS,
  QUICK_ORDER_FIELD_LABELS,
  type QuickOrderLayout,
  type QuickOrderPlacement,
} from "@/lib/settings/quick-order-layout";
import { cn } from "@/lib/utils";

type SettingsResponse = {
  layout?: QuickOrderLayout;
  revision?: string;
  error?: string;
};

export function QuickOrderLayoutSettings() {
  const [layout, setLayout] = useState<QuickOrderLayout | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch("/api/settings/quick-order-layout");
      const result = (await response.json()) as SettingsResponse;

      if (!response.ok || !result.layout || !result.revision) {
        throw new Error(
          result.error ?? "No se pudo cargar la configuración"
        );
      }

      setLayout(result.layout);
      setRevision(result.revision);
    } catch (err) {
      setLayout(null);
      setRevision(null);
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo cargar la configuración"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function place(
    field: (typeof QUICK_ORDER_FIELDS)[number],
    placement: QuickOrderPlacement
  ) {
    setSaved(false);
    setError(null);
    setLayout((current) =>
      current ? { ...current, [field]: placement } : current
    );
  }

  async function save() {
    if (!layout || !revision || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const response = await fetch("/api/settings/quick-order-layout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout, revision }),
      });
      const result = (await response.json()) as SettingsResponse;

      if (response.status === 409) {
        await load();
        setError(
          "La configuración cambió en otra sesión. Se ha cargado la versión más reciente."
        );
        return;
      }

      if (!response.ok || !result.layout || !result.revision) {
        throw new Error(
          result.error ?? "No se pudo guardar la configuración"
        );
      }

      setLayout(result.layout);
      setRevision(result.revision);
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar la configuración"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="Pedido rápido"
      description="Elige qué datos aparecen primero. Todos los campos siguen disponibles y mantienen un orden fijo."
      bodyClassName="px-5 py-5 sm:px-6"
    >
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
          <div className="divide-y divide-border/70 rounded-lg border border-border/70">
            {QUICK_ORDER_FIELDS.map((field) => (
              <fieldset
                key={field}
                className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5"
              >
                <legend className="contents">
                  <span className="text-sm font-medium text-foreground">
                    {QUICK_ORDER_FIELD_LABELS[field]}
                  </span>
                </legend>
                <div
                  className="grid grid-cols-2 rounded-md border border-border bg-muted/30 p-1"
                  aria-label={`Posición de ${QUICK_ORDER_FIELD_LABELS[field]}`}
                >
                  {(
                    [
                      ["primary", "Principal"],
                      ["more", "Más opciones"],
                    ] as const
                  ).map(([placement, label]) => (
                    <label
                      key={placement}
                      className={cn(
                        "cursor-pointer rounded px-3 py-2 text-center text-sm font-medium transition-colors",
                        layout[field] === placement
                          ? "bg-background text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <input
                        type="radio"
                        name={`placement-${field}`}
                        value={placement}
                        checked={layout[field] === placement}
                        disabled={saving}
                        onChange={() => place(field, placement)}
                        className="sr-only"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-400" role="status">
              Configuración guardada.
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" disabled={saving} onClick={() => void save()}>
              {saving ? "Guardando…" : "Guardar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                setLayout({ ...DEFAULT_QUICK_ORDER_LAYOUT });
                setSaved(false);
                setError(null);
              }}
            >
              Restaurar distribución actual
            </Button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
