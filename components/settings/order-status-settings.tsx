"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import { Button } from "@/components/ui/button";
import {
  ORDER_STATUS_EDITABLE_KINDS,
  ORDER_STATUS_KIND_LABELS,
  orderStatusKindFromFlags,
  type OrderStatusEditableKind,
  type OrderStatusItem,
  type OrderStatusPayload,
} from "@/lib/settings/order-statuses";

type StatusListResponse = {
  statuses: OrderStatusItem[];
  error?: string;
};

type Editor =
  | { mode: "create"; status: null }
  | { mode: "edit"; status: OrderStatusItem };

type FormState = {
  name: string;
  kind: OrderStatusEditableKind;
  active: boolean;
  sort_order: string;
};

function formForStatus(status: OrderStatusItem | null): FormState {
  const kind = status
    ? orderStatusKindFromFlags(status)
    : "in_progress";

  return {
    name: status?.name ?? "",
    kind:
      kind === "initial"
        ? "in_progress"
        : (kind as OrderStatusEditableKind),
    active: status?.active ?? true,
    sort_order: String(status?.sort_order ?? 0),
  };
}

function patchPayloadForStatus(
  status: OrderStatusItem,
  overrides: Partial<Pick<OrderStatusPayload, "active" | "name" | "sort_order" | "kind">> = {}
): OrderStatusPayload {
  const kind = orderStatusKindFromFlags(status);
  return {
    name: overrides.name ?? status.name,
    kind:
      overrides.kind ??
      (kind === "initial" ? "in_progress" : (kind as OrderStatusEditableKind)),
    active: overrides.active ?? status.active,
    sort_order: overrides.sort_order ?? status.sort_order,
  };
}

function StatusEditorModal({
  editor,
  saving,
  error,
  onCancel,
  onSubmit,
}: {
  editor: Editor;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (payload: OrderStatusPayload) => void;
}) {
  const [form, setForm] = useState<FormState>(() =>
    formForStatus(editor.status)
  );

  const editingCurrentInitial =
    editor.mode === "edit" && editor.status.is_initial;

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
      kind: form.kind,
      active: editingCurrentInitial ? true : form.active,
      sort_order: sortOrder,
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={
        editor.mode === "create" ? "Nuevo estado" : "Editar estado"
      }
    >
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg"
      >
        <div className="mb-5">
          <h2 className="text-lg font-semibold">
            {editor.mode === "create" ? "Nuevo estado" : "Editar estado"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            El tipo define la semántica del estado en el flujo de pedidos.
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
              maxLength={100}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>

          {editingCurrentInitial ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              Este es el estado Inicial del tenant. Para cambiar cuál es el
              inicial, usa «Establecer como inicial» en otro estado activo.
            </p>
          ) : (
            <label className="grid gap-1.5 text-sm">
              Tipo
              <select
                className="gc-field-control"
                value={form.kind}
                disabled={saving}
                onChange={(event) => {
                  const kind = event.target.value as OrderStatusEditableKind;
                  setForm((current) => ({
                    ...current,
                    kind,
                  }));
                }}
              >
                {ORDER_STATUS_EDITABLE_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {ORDER_STATUS_KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editingCurrentInitial ? true : form.active}
              disabled={saving || editingCurrentInitial}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  active: event.target.checked,
                }))
              }
            />
            Estado activo
          </label>

          {editingCurrentInitial ? (
            <p className="text-sm text-muted-foreground">
              Debes establecer otro estado inicial antes de desactivar este
              estado.
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

export function OrderStatusSettings() {
  const [statuses, setStatuses] = useState<OrderStatusItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadStatuses = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const response = await fetch("/api/order-statuses", {
        cache: "no-store",
      });
      const result = (await response.json()) as StatusListResponse;

      if (!response.ok) {
        throw new Error(result.error || "No se pudieron cargar los estados");
      }

      setStatuses(result.statuses ?? []);
    } catch (error) {
      setStatuses([]);
      setLoadError(
        error instanceof Error
          ? error.message
          : "No se pudieron cargar los estados"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadStatuses();
    });
  }, [loadStatuses]);

  async function saveStatus(payload: OrderStatusPayload) {
    if (!editor || saving) {
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const create = editor.mode === "create";
      const response = await fetch(
        create
          ? "/api/order-statuses"
          : `/api/order-statuses/${editor.status.id}`,
        {
          method: create ? "POST" : "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "No se pudo guardar el estado");
      }

      setEditor(null);
      await loadStatuses();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "No se pudo guardar el estado"
      );
    } finally {
      setSaving(false);
    }
  }

  async function setAsInitial(status: OrderStatusItem) {
    if (busyId || status.is_initial || !status.active) {
      return;
    }

    setBusyId(status.id);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/order-statuses/${status.id}/set-initial`,
        { method: "POST" }
      );
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.error || "No se pudo establecer el estado inicial"
        );
      }
      await loadStatuses();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudo establecer el estado inicial"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(status: OrderStatusItem) {
    if (busyId || status.is_initial) {
      return;
    }

    setBusyId(status.id);
    setActionError(null);

    try {
      const response = await fetch(`/api/order-statuses/${status.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          patchPayloadForStatus(status, { active: !status.active })
        ),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || "No se pudo actualizar el estado");
      }
      await loadStatuses();
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el estado"
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <SectionCard
        title="Flujo de estados"
        description="Desactiva estados que ya no uses en lugar de eliminarlos. Los pedidos históricos conservan su estado."
        actions={
          <Button
            type="button"
            onClick={() => {
              setFormError(null);
              setEditor({ mode: "create", status: null });
            }}
          >
            Nuevo estado
          </Button>
        }
      >
        {loading ? (
          <LoadingState label="Cargando estados..." />
        ) : loadError ? (
          <ErrorState
            title="No se pudieron cargar los estados"
            description={loadError}
            onRetry={() => void loadStatuses()}
          />
        ) : statuses.length === 0 ? (
          <EmptyState
            title="No hay estados configurados"
            description="Debe existir al menos un estado Inicial activo antes de crear pedidos."
          />
        ) : (
          <div className="overflow-x-auto">
            {actionError ? (
              <p className="border-b px-5 py-3 text-sm text-destructive sm:px-6">
                {actionError}
              </p>
            ) : null}
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-5 py-3 text-left font-medium sm:px-6">
                    Estado
                  </th>
                  <th className="px-5 py-3 text-left font-medium sm:px-6">
                    Tipo
                  </th>
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
                {statuses.map((status) => {
                  const kind = orderStatusKindFromFlags(status);
                  const busy = busyId === status.id;

                  return (
                    <tr
                      key={status.id}
                      className="border-b last:border-b-0 hover:bg-muted/30"
                    >
                      <td className="px-5 py-4 sm:px-6">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge status={status} />
                          {status.is_initial ? (
                            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                              Inicial
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 font-medium">{status.name}</div>
                      </td>
                      <td className="px-5 py-4 sm:px-6">
                        {ORDER_STATUS_KIND_LABELS[kind]}
                      </td>
                      <td className="px-5 py-4 sm:px-6">
                        {status.active ? "Sí" : "No"}
                      </td>
                      <td className="px-5 py-4 sm:px-6">
                        {status.sort_order}
                      </td>
                      <td className="px-5 py-4 text-right sm:px-6">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => {
                              setFormError(null);
                              setEditor({ mode: "edit", status });
                            }}
                          >
                            Editar
                          </Button>
                          {!status.is_initial ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy || !status.active}
                              title={
                                status.active
                                  ? undefined
                                  : "Reactiva el estado antes de marcarlo como inicial"
                              }
                              onClick={() => void setAsInitial(status)}
                            >
                              Establecer como inicial
                            </Button>
                          ) : null}
                          {status.is_initial ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled
                              title="Debes establecer otro estado inicial antes de desactivar este estado."
                            >
                              Desactivar
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => void toggleActive(status)}
                            >
                              {status.active ? "Desactivar" : "Activar"}
                            </Button>
                          )}
                        </div>
                        {status.is_initial ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Debes establecer otro estado inicial antes de
                            desactivar este estado.
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {editor ? (
        <StatusEditorModal
          key={editor.mode === "create" ? "create" : editor.status.id}
          editor={editor}
          saving={saving}
          error={formError}
          onCancel={() => {
            if (!saving) {
              setEditor(null);
              setFormError(null);
            }
          }}
          onSubmit={(payload) => void saveStatus(payload)}
        />
      ) : null}
    </>
  );
}
