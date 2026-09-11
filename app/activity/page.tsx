"use client";

import { useEffect, useMemo, useState } from "react";
import { AppNav } from "@/components/app-nav";
import { ActivityEventCard } from "@/components/activity/activity-event-card";
import { AppShell } from "@/components/gestcopy/app-shell";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { actionsForEntity } from "@/lib/activity/format";
import { canViewActivity } from "@/lib/auth/membership-roles";
import {
  ENTITY_TYPE_OPTIONS,
  type ActivityResponse,
} from "@/lib/activity/types";

export default function ActivityPage() {
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [roleReady, setRoleReady] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const actionOptions = useMemo(
    () => actionsForEntity(entityType),
    [entityType]
  );

  useEffect(() => {
    async function loadRole() {
      const response = await fetch("/api/context");
      if (response.ok) {
        const context = await response.json();
        const allowed = canViewActivity(context?.membership?.role);
        setForbidden(!allowed);
      } else {
        setForbidden(true);
      }
      setRoleReady(true);
    }

    loadRole();
  }, []);

  useEffect(() => {
    if (!roleReady || forbidden) {
      return;
    }

    async function loadActivity() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: "25",
        });

        if (entityType) {
          params.set("entity_type", entityType);
        }

        if (action) {
          params.set("action", action);
        }

        if (from) {
          params.set("from", new Date(`${from}T00:00:00`).toISOString());
        }

        if (to) {
          params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
        }

        const response = await fetch(`/api/activity?${params.toString()}`);
        const result = await response.json();

        if (response.status === 403 || response.status === 401) {
          setForbidden(true);
          return;
        }

        if (!response.ok) {
          throw new Error("No se pudo cargar el registro de actividad");
        }

        setData(result);
      } catch {
        setData(null);
        setError("No se pudo cargar el registro de actividad");
      } finally {
        setLoading(false);
      }
    }

    loadActivity();
  }, [roleReady, forbidden, entityType, action, from, to, page, reloadToken]);

  const total = data?.total ?? 0;
  const events = data?.events ?? [];
  const pageSize = data?.page_size ?? 25;
  const currentPage = data?.page ?? page;
  const fromItem = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const toItem = Math.min(currentPage * pageSize, total);
  const hasListFilters = Boolean(entityType || action || from || to);

  return (
    <AppShell innerClassName="max-w-5xl">
      <AppNav />

      <PageHeader
        title="Registro de actividad"
        description="Historial de cambios realizados en Copyflow"
      />

        {!roleReady ? (
          <LoadingState label="Cargando actividad..." />
        ) : forbidden ? (
          <div className="overflow-hidden rounded-lg border bg-card">
            <EmptyState title="No tienes permiso para ver el registro de actividad." />
          </div>
        ) : (
          <>
            <div className="mb-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <select
                value={entityType}
                onChange={(event) => {
                  setEntityType(event.target.value);
                  setAction("");
                  setPage(1);
                }}
                className="gc-field-control"
              >
                <option value="">Todas las entidades</option>
                {ENTITY_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <select
                value={action}
                onChange={(event) => {
                  setAction(event.target.value);
                  setPage(1);
                }}
                className="gc-field-control"
              >
                <option value="">Todas las acciones</option>
                {actionOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <input
                type="date"
                value={from}
                onChange={(event) => {
                  setFrom(event.target.value);
                  setPage(1);
                }}
                className="gc-field-control"
                aria-label="Fecha desde"
              />

              <input
                type="date"
                value={to}
                onChange={(event) => {
                  setTo(event.target.value);
                  setPage(1);
                }}
                className="gc-field-control"
                aria-label="Fecha hasta"
              />
            </div>

            {loading ? (
              <LoadingState label="Cargando actividad..." />
            ) : error ? (
              <ErrorState
                title="No se pudo cargar el registro de actividad"
                onRetry={() => setReloadToken((token) => token + 1)}
              />
            ) : events.length === 0 ? (
              <div className="overflow-hidden rounded-lg border bg-card">
                <EmptyState
                  title={
                    hasListFilters
                      ? "No hay eventos con estos filtros"
                      : "No hay eventos todavía"
                  }
                  description={
                    hasListFilters
                      ? "Prueba a cambiar los filtros o el rango de fechas."
                      : undefined
                  }
                />
              </div>
            ) : (
              <>
                <div className="overflow-hidden rounded-lg border bg-card">
                  {events.map((event) => (
                    <ActivityEventCard key={event.id} event={event} />
                  ))}
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                  <p className="text-muted-foreground">
                    Mostrando {fromItem}–{toItem} de {total}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() =>
                        setPage((current) => Math.max(1, current - 1))
                      }
                      className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
                    >
                      Anterior
                    </button>
                    <button
                      type="button"
                      disabled={
                        !data?.has_more &&
                        currentPage >= (data?.total_pages ?? 1)
                      }
                      onClick={() => setPage((current) => current + 1)}
                      className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
                    >
                      Siguiente
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
    </AppShell>
  );
}
