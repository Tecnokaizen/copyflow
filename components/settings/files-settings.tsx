"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import {
  MAX_FILE_BYTES_PRESETS,
  availableStorageBytes,
  formatBinaryStorage,
  maxFileBytesLabel,
  storageUsagePercent,
  type TenantFilesSettings,
} from "@/lib/settings/files";

type FilesSettingsResponse = TenantFilesSettings & {
  tenant: string;
};

export function FilesSettings() {
  const [settings, setSettings] = useState<FilesSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedMax, setSelectedMax] = useState<number>(
    MAX_FILE_BYTES_PRESETS[MAX_FILE_BYTES_PRESETS.length - 1]
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/settings/files", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error("No se ha podido cargar la configuración de archivos.");
      }
      const body = (await response.json()) as FilesSettingsResponse;
      setSettings(body);
      setSelectedMax(body.max_file_bytes);
    } catch (err) {
      setLoadError(
        err instanceof Error
          ? err.message
          : "No se ha podido cargar la configuración de archivos."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const response = await fetch("/api/settings/files", {
        method: "PATCH",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ max_file_bytes: selectedMax }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(
          body?.error === "Invalid max_file_bytes"
            ? "El tamaño máximo por archivo no es válido."
            : "No se ha podido guardar el tamaño máximo."
        );
      }
      const body = (await response.json()) as FilesSettingsResponse;
      setSettings(body);
      setSelectedMax(body.max_file_bytes);
      setSaveOk(true);
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : "No se ha podido guardar el tamaño máximo."
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <LoadingState label="Cargando almacenamiento…" />;
  }

  if (loadError || !settings) {
    return (
      <ErrorState
        title="No se pudo cargar"
        description={loadError ?? "Configuración no disponible."}
        onRetry={() => void load()}
      />
    );
  }

  const available = availableStorageBytes(
    settings.reserved_bytes,
    settings.storage_limit_bytes
  );
  const percent = storageUsagePercent(
    settings.reserved_bytes,
    settings.storage_limit_bytes
  );

  return (
    <div className="grid gap-4">
      <SectionCard
        title="Almacenamiento"
        description="Uso del espacio de archivos de la organización. La cuota comercial la define el plan; no se puede cambiar desde aquí."
        bodyClassName="p-5 sm:p-6"
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Uso</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              {settings.quota_configured && settings.storage_limit_bytes !== null
                ? `${formatBinaryStorage(settings.reserved_bytes)} / ${formatBinaryStorage(settings.storage_limit_bytes)}`
                : formatBinaryStorage(settings.reserved_bytes)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Límite</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              {settings.quota_configured && settings.storage_limit_bytes !== null
                ? formatBinaryStorage(settings.storage_limit_bytes)
                : "Sin cuota configurada"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Disponible</dt>
            <dd className="mt-1 text-base font-medium text-foreground">
              {available === null
                ? "—"
                : formatBinaryStorage(available)}
            </dd>
          </div>
          {percent !== null ? (
            <div>
              <dt className="text-muted-foreground">Porcentaje de uso</dt>
              <dd className="mt-1 text-base font-medium text-foreground">
                {percent.toLocaleString("es-ES")} %
              </dd>
            </div>
          ) : null}
        </dl>

        <div className="mt-5 grid gap-2 border-t pt-4 text-sm">
          <p className="font-medium text-foreground">Detalle</p>
          <ul className="grid gap-1.5 text-muted-foreground">
            <li>
              Archivos activos:{" "}
              <span className="text-foreground">{settings.file_count}</span>
            </li>
            <li>
              Bytes listos:{" "}
              <span className="text-foreground">
                {formatBinaryStorage(settings.ready_bytes)}
              </span>
            </li>
            <li>
              Bytes pendientes / reservados:{" "}
              <span className="text-foreground">
                {formatBinaryStorage(settings.pending_bytes)}
              </span>
            </li>
            <li>
              Cuota total:{" "}
              <span className="text-foreground">
                {settings.quota_configured &&
                settings.storage_limit_bytes !== null
                  ? formatBinaryStorage(settings.storage_limit_bytes)
                  : "Sin cuota configurada"}
              </span>
            </li>
          </ul>
        </div>
      </SectionCard>

      <SectionCard
        title="Tamaño máximo por archivo"
        description="Límite operativo de esta organización. No puede superar el techo de plataforma (100 MiB)."
        bodyClassName="p-5 sm:p-6"
      >
        <form onSubmit={onSubmit} className="grid gap-4">
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">Máximo por archivo</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {MAX_FILE_BYTES_PRESETS.map((preset) => (
                <label
                  key={preset}
                  className="flex items-center gap-2 rounded-[var(--radius)] border px-3 py-2.5 text-sm"
                >
                  <input
                    type="radio"
                    name="max_file_bytes"
                    value={preset}
                    checked={selectedMax === preset}
                    disabled={saving}
                    onChange={() => {
                      setSaveOk(false);
                      setSelectedMax(preset);
                    }}
                  />
                  {maxFileBytesLabel(preset)}
                </label>
              ))}
            </div>
          </fieldset>

          {saveError ? (
            <p className="text-sm text-destructive">{saveError}</p>
          ) : null}
          {saveOk ? (
            <p className="text-sm text-muted-foreground">Guardado.</p>
          ) : null}

          <div>
            <Button
              type="submit"
              disabled={saving || selectedMax === settings.max_file_bytes}
            >
              {saving ? "Guardando…" : "Guardar"}
            </Button>
          </div>
        </form>
      </SectionCard>
    </div>
  );
}
