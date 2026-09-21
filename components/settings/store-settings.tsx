"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import type { Store, StorePayload } from "@/lib/stores/types";

type StoreListResponse = {
  tenant: string;
  stores: Store[];
};

type StoreEditor =
  | { mode: "create"; store: null }
  | { mode: "edit"; store: Store };

type StoreFormState = {
  name: string;
  code: string;
  active: boolean;
};

function formForStore(store: Store | null): StoreFormState {
  return {
    name: store?.name ?? "",
    code: store?.code ?? "",
    active: store?.active ?? true,
  };
}

function StoreEditorModal({
  editor,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  editor: StoreEditor;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: StorePayload) => void;
}) {
  const [form, setForm] = useState<StoreFormState>(() =>
    formForStore(editor.store)
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = form.name.trim();
    if (!name || saving) {
      return;
    }

    onSubmit({
      name,
      code: form.code.trim() || null,
      active: form.active,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={editor.mode === "create" ? "Nueva tienda" : "Editar tienda"}
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg"
      >
        <div className="mb-5">
          <h2 className="text-lg font-semibold">
            {editor.mode === "create" ? "Nueva tienda" : "Editar tienda"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            El código es opcional y sirve como identificador interno estable.
          </p>
        </div>

        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            Nombre *
            <input
              className="gc-field-control"
              value={form.name}
              disabled={saving}
              autoFocus
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>

          <label className="grid gap-1.5 text-sm">
            Código interno
            <input
              className="gc-field-control"
              value={form.code}
              disabled={saving}
              placeholder="Opcional"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  code: event.target.value,
                }))
              }
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              disabled={saving}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />
            Tienda activa
          </label>
        </div>

        {error ? (
          <p className="mt-4 text-sm text-destructive">{error}</p>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={onCancel}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={saving || !form.name.trim()}>
            {saving ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function StoreSettings() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<StoreEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadStores = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/stores?active=all", {
        cache: "no-store",
      });
      const result = (await response.json()) as StoreListResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(result.error || "No se pudieron cargar las tiendas");
      }

      setStores(result.stores ?? []);
    } catch (error) {
      setStores([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar las tiendas"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadStores();
    });
  }, [loadStores]);

  async function saveStore(payload: StorePayload) {
    if (!editor || saving) {
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const isCreate = editor.mode === "create";
      const response = await fetch(
        isCreate ? "/api/stores" : `/api/stores/${editor.store.id}`,
        {
          method: isCreate ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "No se pudo guardar la tienda");
      }

      setEditor(null);
      await loadStores();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "No se pudo guardar la tienda"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SectionCard
        title="Sedes disponibles"
        description="Las tiendas inactivas dejan de estar disponibles para nuevas asignaciones, pero siguen visibles en el histórico."
        actions={
          <Button
            type="button"
            onClick={() => {
              setFormError(null);
              setEditor({ mode: "create", store: null });
            }}
          >
            Nueva tienda
          </Button>
        }
      >
        {loading ? (
          <LoadingState label="Cargando tiendas..." />
        ) : loadError ? (
          <ErrorState
            title="No se pudieron cargar las tiendas"
            description={loadError}
            onRetry={() => void loadStores()}
          />
        ) : stores.length === 0 ? (
          <EmptyState
            title="No hay tiendas configuradas"
            description="Crea la primera sede para poder asignarla a los pedidos."
            action={
              <Button
                type="button"
                onClick={() => {
                  setFormError(null);
                  setEditor({ mode: "create", store: null });
                }}
              >
                Crear tienda
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-5 py-3 text-left font-medium sm:px-6">
                    Tienda
                  </th>
                  <th className="px-5 py-3 text-left font-medium sm:px-6">
                    Código
                  </th>
                  <th className="px-5 py-3 text-left font-medium sm:px-6">
                    Estado
                  </th>
                  <th className="px-5 py-3 text-right font-medium sm:px-6">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody>
                {stores.map((store) => (
                  <tr
                    key={store.id}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-4 font-medium sm:px-6">
                      {store.name}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground sm:px-6">
                      {store.code ?? "—"}
                    </td>
                    <td className="px-5 py-4 sm:px-6">
                      <span
                        className={
                          store.active
                            ? "rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-300"
                            : "rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                        }
                      >
                        {store.active ? "Activa" : "Inactiva"}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right sm:px-6">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setFormError(null);
                          setEditor({ mode: "edit", store });
                        }}
                      >
                        Editar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {editor ? (
        <StoreEditorModal
          key={editor.mode === "create" ? "create" : editor.store.id}
          editor={editor}
          saving={saving}
          error={formError}
          onCancel={() => {
            if (!saving) {
              setEditor(null);
              setFormError(null);
            }
          }}
          onSubmit={(payload) => void saveStore(payload)}
        />
      ) : null}
    </>
  );
}
