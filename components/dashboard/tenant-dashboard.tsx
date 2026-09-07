"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import type { DashboardResponse } from "@/lib/dashboard/types";

function formatDueAt(value: string | null) {
  if (!value) return "Sin fecha";

  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function KpiCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint?: string;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-2 text-3xl font-bold">{value}</p>
      {hint ? (
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </section>
  );
}

export function TenantDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch("/api/dashboard");

        if (!response.ok) {
          throw new Error("No se pudo cargar el panel");
        }

        const result = (await response.json()) as DashboardResponse;
        setData(result);
      } catch (err) {
        setData(null);
        setError(
          err instanceof Error ? err.message : "No se pudo cargar el panel"
        );
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  if (loading && !data) {
    return (
      <main className="p-8">
        <p>Cargando panel...</p>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="p-8">
        <p className="text-red-600">{error}</p>
      </main>
    );
  }

  const counts = data?.counts;
  const members = data?.workload.members ?? [];
  const upcoming = data?.upcoming_orders ?? [];

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl">
        <AppNav />

        <div className="mb-8">
          <h1 className="text-3xl font-bold">Panel</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Día operativo {data?.local_date ?? ""} · {data?.timezone ?? ""}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="Pedidos activos" value={counts?.active ?? 0} />
          <KpiCard label="Urgentes" value={counts?.urgent ?? 0} />
          <KpiCard label="Retrasados" value={counts?.overdue ?? 0} />
          <KpiCard label="Entregas de hoy" value={counts?.due_today ?? 0} />
          <KpiCard label="Próximas entregas" value={counts?.upcoming ?? 0} />
          <KpiCard
            label="Necesitan atención"
            value={counts?.needs_attention ?? 0}
            hint="Pedidos listos pendientes de cierre. Archivos, presupuesto y bloqueos no entran todavía."
          />
        </div>

        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Próximas entregas</h2>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No hay entregas posteriores a hoy
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {upcoming.map((order) => (
                  <Link
                    key={order.id}
                    href={`/orders/${order.id}`}
                    className="block rounded-md border bg-background p-3 text-sm hover:bg-muted/40"
                  >
                    <div className="font-medium">{order.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {order.reference} · {formatDueAt(order.due_at)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {order.assigned_team_member?.name ?? "Sin asignar"}
                      {order.status?.name ? ` · ${order.status.name}` : ""}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border bg-card p-4">
            <h2 className="text-sm font-medium">Carga de trabajo</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {data?.workload.active_orders_count ?? 0} pedidos activos asignados
            </p>
            {members.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No hay miembros activos
              </p>
            ) : (
              <div className="mt-3 grid gap-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <div>
                      <div className="font-medium">{member.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {member.job_title ?? "Sin puesto"}
                      </div>
                    </div>
                    <span className="text-sm font-medium">
                      {member.active_orders_count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
