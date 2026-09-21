"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { Button } from "@/components/ui/button";
import {
  SETTINGS_CATALOGS,
  SETTINGS_CATALOG_KEYS,
  type SettingsCatalogItem,
  type SettingsCatalogKey,
  type SettingsCatalogPayload,
} from "@/lib/settings/catalogs";
import { cn } from "@/lib/utils";

type CatalogResponse = {
  items?: SettingsCatalogItem[];
  error?: string;
};

type Editor =
  | { mode: "create"; item: null }
  | { mode: "edit"; item: SettingsCatalogItem };

type FormState = {
  name: string;
  active: boolean;
  sort_order: string;
};

const GROUP_LABELS = {
  customers: "Cliente y recepción",
  management: "Producción, cobro y entrega",
  services: "Servicios",
} as const;

function formForItem(item: SettingsCatalogItem | null): FormState {
  return {
    name: item?.name ?? "",
    active: item?.active ?? true,
    sort_order: String(item?.sort_order ?? 0),
  };
}

function CatalogEditorModal({
  catalog,
  editor,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  catalog: SettingsCatalogKey;
  editor: Editor;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: SettingsCatalogPayload) => void;
}) {
  const definition = SETTINGS_CATALOGS[catalog];
  const [form, setForm] = useState<FormState>(() => formForItem(editor.item));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = form.name.trim();
    const sortOrder = Number(form.sort_order);
    if (
      !name ||
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      saving
    ) {
      return;
    }

    onSubmit({
      name,
      active: form.active,
      sort_order: sortOrder,
    });
  }

  const isKiosk =
    catalog === "entry_channels" &&
    editor.mode === "edit" &&
    editor.item.code === "kiosk";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg"
      >
        <div className="mb-5">
          <h2 className="text-lg font-semibold">
            {editor.mode === "create"
              ? `Nuevo ${definition.singular}`
              : `Editar ${definition.singular}`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Desactiva opciones antiguas para conservar el histórico.
          </p>
        </div>

        <div className="grid gap-4">
          <label className="grid gap-1.5 text-sm">
            Nombre *
            <input
              className="gc-field-control"
              value={form.name}
              disabled={saving}
              maxLength={100}
              autoFocus
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.active}
              disabled={saving || isKiosk}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />
            Activo
          </label>

          {isKiosk ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              La activación del canal Kiosk pertenece al módulo Kiosk y no se
              cambia desde los catálogos generales.
            </p>
          ) : null}

          <label className="grid gap-1.5 text-sm">
            Orden
            <input
              type="number"
              min="0"
              max="100000"
              step="1"
              className="gc-field-control"
              value={form.sort_order}
              disabled={saving}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  sort_order: event.target.value,
                }))
              }
            />
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

export function CatalogSettings() {
  const [catalog, setCatalog] =
    useState<SettingsCatalogKey>("customer_types");
  const [items, setItems] = useState<SettingsCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const definition = SETTINGS_CATALOGS[catalog];

  const groups = useMemo(
    () =>
      (["customers", "management", "services"] as const).map((group) => ({
        group,
        items: SETTINGS_CATALOG_KEYS.filter(
          (key) => SETTINGS_CATALOGS[key].group === group
        ),
      })),
    []
  );

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch(`/api/settings/catalogs/${catalog}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as CatalogResponse;
      if (!response.ok) {
        throw new Error(result.error || "No se pudo cargar el catálogo");
      }
      setItems(result.items ?? []);
    } catch (error) {
      setItems([]);
      setLoadError(
        error instanceof Error ? error.message : "No se pudo cargar el catálogo"
      );
    } finally {
      setLoading(false);
    }
  }, [catalog]);

  useEffect(() => {
    queueMicrotask(() => {
      setEditor(null);
      setFormError(null);
      void loadItems();
    });
  }, [loadItems]);

  async function saveItem(payload: SettingsCatalogPayload) {
    if (!editor || saving) return;

    setSaving(true);
    setFormError(null);

    try {
      const create = editor.mode === "create";
      const response = await fetch(
        create
          ? `/api/settings/catalogs/${catalog}`
          : `/api/settings/catalogs/${catalog}/${editor.item.id}`,
        {
          method: create ? "POST" : "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "No se pudo guardar el elemento");
      }

      setEditor(null);
      await loadItems();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "No se pudo guardar el elemento"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        {groups.map(({ group, items: keys }) => (
          <SectionCard
            key={group}
            title={GROUP_LABELS[group]}
            bodyClassName="p-3"
          >
            <div className="grid gap-1">
              {keys.map((key) => {
                const selected = key === catalog;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setCatalog(key)}
                    className={cn(
                      "rounded-md px-3 py-2.5 text-left text-sm transition-colors",
                      selected
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    )}
                  >
                    {SETTINGS_CATALOGS[key].label}
                  </button>
                );
              })}
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard
        title={definition.label}
        description={definition.description}
        actions={
          <Button
            type="button"
            onClick={() => {
              setFormError(null);
              setEditor({ mode: "create", item: null });
            }}
          >
            Añadir
          </Button>
        }
      >
        {loading ? (
          <LoadingState label="Cargando catálogo..." />
        ) : loadError ? (
          <ErrorState
            title="No se pudo cargar el catálogo"
            description={loadError}
            onRetry={() => void loadItems()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="No hay elementos configurados"
            description="Añade la primera opción de este catálogo."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-5 py-3 text-left font-medium sm:px-6">
                    Nombre
                  </th>
                  {definition.hasCode ? (
                    <th className="px-5 py-3 text-left font-medium sm:px-6">
                      Código
                    </th>
                  ) : null}
                  <th className="px-5 py-3 text-left font-medium sm:px-6">
                    Activo
                  </th>
                  <th className="px-5 py-3 text-left font-medium sm:px-6">
                    Orden
                  </th>
                  <th className="px-5 py-3 text-right font-medium sm:px-6">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-4 font-medium sm:px-6">
                      {item.name}
                    </td>
                    {definition.hasCode ? (
                      <td className="px-5 py-4 text-muted-foreground sm:px-6">
                        {item.code ?? "—"}
                      </td>
                    ) : null}
                    <td className="px-5 py-4 sm:px-6">
                      {item.active ? "Sí" : "No"}
                    </td>
                    <td className="px-5 py-4 sm:px-6">
                      {item.sort_order}
                    </td>
                    <td className="px-5 py-4 text-right sm:px-6">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setFormError(null);
                          setEditor({ mode: "edit", item });
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
        <CatalogEditorModal
          key={
            editor.mode === "create"
              ? `create-${catalog}`
              : `${catalog}-${editor.item.id}`
          }
          catalog={catalog}
          editor={editor}
          saving={saving}
          error={formError}
          onCancel={() => {
            if (!saving) {
              setEditor(null);
              setFormError(null);
            }
          }}
          onSubmit={(payload) => void saveItem(payload)}
        />
      ) : null}
    </>
  );
}
