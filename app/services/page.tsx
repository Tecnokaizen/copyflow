"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { AppNav } from "@/components/app-nav";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { ServiceForm } from "@/components/services/service-form";
import { ServiceModal } from "@/components/services/service-modal";
import { canWriteServices } from "@/lib/auth/membership-roles";
import {
  EMPTY_SERVICE_FORM,
  formToServicePayload,
  formatLeadTimeMinutes,
  serviceToForm,
  type ServiceCategory,
  type ServiceFormData,
  type ServiceItem,
  type ServiceListResponse,
} from "@/lib/services/types";

type ActiveFilter = "true" | "false" | "all";

function requirementLabels(service: ServiceItem) {
  const labels: string[] = [];

  if (service.requires_file) {
    labels.push("Archivo");
  }

  if (service.requires_design) {
    labels.push("Diseño");
  }

  if (service.requires_quote) {
    labels.push("Presupuesto");
  }

  return labels;
}

export default function ServicesPage() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [active, setActive] = useState<ActiveFilter>("true");
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [data, setData] = useState<ServiceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ServiceItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    async function loadContextAndCategories() {
      const [contextResponse, categoriesResponse] = await Promise.all([
        fetch("/api/context"),
        fetch("/api/services/categories"),
      ]);

      if (contextResponse.ok) {
        const context = await contextResponse.json();
        setCanWrite(canWriteServices(context?.membership?.role));
      }

      if (categoriesResponse.ok) {
        const result = await categoriesResponse.json();
        setCategories(result.categories ?? []);
      }
    }

    loadContextAndCategories();
  }, []);

  useEffect(() => {
    async function loadServices() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          active,
        });

        if (search) {
          params.set("search", search);
        }

        if (categoryId) {
          params.set("category_id", categoryId);
        }

        const response = await fetch(`/api/services?${params.toString()}`);
        const result = await response.json();

        if (!response.ok) {
          throw new Error("No se pudieron cargar los servicios");
        }

        setData(result);
      } catch {
        setData(null);
        setError("No se pudieron cargar los servicios");
      } finally {
        setLoading(false);
      }
    }

    loadServices();
  }, [search, categoryId, active, reloadToken]);

  async function refreshList() {
    const params = new URLSearchParams({
      active,
    });

    if (search) {
      params.set("search", search);
    }

    if (categoryId) {
      params.set("category_id", categoryId);
    }

    const response = await fetch(`/api/services?${params.toString()}`);
    const result = await response.json();
    if (response.ok) {
      setData(result);
    }
  }

  async function submitService(
    form: ServiceFormData,
    method: "POST" | "PATCH",
    id?: string
  ) {
    const parsed = formToServicePayload(form);
    if (!parsed.ok) {
      setFormError("Revisa los datos del servicio.");
      return;
    }

    if (saving) return;

    setSaving(true);
    setFormError(null);

    try {
      const response = await fetch(
        method === "POST" ? "/api/services" : `/api/services/${id}`,
        {
          method,
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(parsed.data),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error ??
            (method === "POST"
              ? "No se pudo crear el servicio"
              : "No se pudo actualizar el servicio")
        );
      }

      setCreateOpen(false);
      setEditing(null);
      await refreshList();
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : "No se pudo guardar el servicio"
      );
    } finally {
      setSaving(false);
    }
  }

  const total = data?.total ?? 0;
  const services = data?.services ?? [];
  const hasListFilters =
    Boolean(search) || Boolean(categoryId) || active !== "true";

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <AppNav />

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Servicios</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {total} servicios
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Plazo estándar medio:{" "}
              {formatLeadTimeMinutes(
                data?.average_standard_lead_time_minutes ?? null
              )}
            </p>
          </div>
          {canWrite && (
            <Button
              type="button"
              onClick={() => {
                setFormError(null);
                setEditing(null);
                setCreateOpen(true);
              }}
            >
              Nuevo servicio
            </Button>
          )}
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar por nombre, descripción o categoría..."
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Todas las categorías</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            value={active}
            onChange={(event) =>
              setActive(event.target.value as ActiveFilter)
            }
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>

        {loading ? (
          <LoadingState label="Cargando servicios..." />
        ) : error ? (
          <ErrorState
            title="No se pudieron cargar los servicios"
            onRetry={() => setReloadToken((token) => token + 1)}
          />
        ) : services.length === 0 ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <EmptyState
              title={
                hasListFilters
                  ? "No hay servicios con estos filtros"
                  : "No hay servicios todavía"
              }
              description={
                hasListFilters
                  ? "Prueba a cambiar la búsqueda o los filtros."
                  : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">
                      Servicio
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Categoría
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Plazo estándar
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Pedidos
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Requisitos
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Estado
                    </th>
                    {canWrite && (
                      <th className="px-4 py-3 text-left font-medium">
                        Acción
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {services.map((service) => {
                    const requirements = requirementLabels(service);

                    return (
                      <tr
                        key={service.id}
                        className="border-b last:border-b-0 hover:bg-muted/30"
                      >
                        <td className="px-4 py-4">
                          <div className="font-medium">{service.name}</div>
                          {service.description && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {service.description}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {service.category_name ?? "Sin categoría"}
                        </td>
                        <td className="px-4 py-4">
                          {formatLeadTimeMinutes(
                            service.standard_lead_time_minutes
                          )}
                        </td>
                        <td className="px-4 py-4">{service.orders_count}</td>
                        <td className="px-4 py-4">
                          {requirements.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {requirements.map((label) => (
                                <span
                                  key={label}
                                  className="rounded-md border px-2 py-0.5 text-xs"
                                >
                                  {label}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {service.active ? "Activo" : "Inactivo"}
                        </td>
                        {canWrite && (
                          <td className="px-4 py-4">
                            <button
                              type="button"
                              onClick={() => {
                                setFormError(null);
                                setCreateOpen(false);
                                setEditing(service);
                              }}
                              className="rounded-md border bg-background px-3 py-2 text-sm"
                            >
                              Editar
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {createOpen && (
        <ServiceModal>
          <ServiceForm
            key="create"
            title="Nuevo servicio"
            initialValues={EMPTY_SERVICE_FORM}
            submitting={saving}
            error={formError}
            onCancel={() => {
              if (saving) return;
              setCreateOpen(false);
            }}
            onSubmit={(form) => submitService(form, "POST")}
          />
        </ServiceModal>
      )}

      {editing && (
        <ServiceModal>
          <ServiceForm
            key={editing.id}
            title="Editar servicio"
            initialValues={serviceToForm(editing)}
            currentCategoryName={editing.category_name}
            submitting={saving}
            error={formError}
            onCancel={() => {
              if (saving) return;
              setEditing(null);
            }}
            onSubmit={(form) => submitService(form, "PATCH", editing.id)}
          />
        </ServiceModal>
      )}
    </main>
  );
}
