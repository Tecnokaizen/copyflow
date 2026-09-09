"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { EmptyState } from "@/components/gestcopy/empty-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import { SectionCard } from "@/components/gestcopy/section-card";
import { StatusBadge } from "@/components/gestcopy/status-badge";
import type {
  DashboardAttentionOrder,
  DashboardResponse,
  DashboardUpcomingOrder,
  DashboardWorkloadMember,
} from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";

function formatOperativeDate(localDate: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    return localDate;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day, 12));

  const formatted = new Intl.DateTimeFormat("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);

  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function formatDueTime(value: string | null) {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("es-ES", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function priorityTone(
  priority: string
): "neutral" | "warning" | "danger" | "brand" {
  if (priority === "urgent") return "danger";
  if (priority === "high") return "warning";
  return "neutral";
}

function priorityLabel(priority: string) {
  if (priority === "urgent") return "Urgente";
  if (priority === "high") return "Alta";
  return "Normal";
}

function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="dark gc-page gc-dashboard">
      <div className="gc-page-inner">{children}</div>
    </main>
  );
}

function KpiLink({
  label,
  value,
  href,
  valueClassName,
}: {
  label: string;
  value: number;
  href: string;
  valueClassName?: string;
}) {
  return (
    <Link href={href} className="gc-kpi">
      <p className="gc-kpi-label">{label}</p>
      <p className={cn("gc-kpi-value", valueClassName)}>{value}</p>
    </Link>
  );
}

function UpcomingRow({ order }: { order: DashboardUpcomingOrder }) {
  return (
    <Link href={`/orders/${order.id}`} className="gc-list-row">
      <div className="flex items-start gap-3.5">
        <div className="w-[6.25rem] shrink-0 text-[0.9375rem] font-bold tabular-nums leading-snug text-foreground">
          {formatDueTime(order.due_at)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.975rem] font-semibold text-foreground">
            {order.title}
          </p>
          <p className="mt-1 truncate text-[0.8125rem] text-muted-foreground">
            {order.reference}
            {order.assigned_team_member?.name
              ? ` · ${order.assigned_team_member.name}`
              : ""}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {order.priority !== "normal" ? (
              <StatusBadge tone={priorityTone(order.priority)}>
                {priorityLabel(order.priority)}
              </StatusBadge>
            ) : null}
            {order.status?.name ? (
              <StatusBadge tone={order.status.is_ready ? "brand" : "neutral"}>
                {order.status.name}
              </StatusBadge>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

function AttentionRow({ order }: { order: DashboardAttentionOrder }) {
  return (
    <Link href={`/orders/${order.id}`} className="gc-list-row">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.8125rem] font-medium text-muted-foreground">
            {order.reference}
          </p>
          <p className="mt-1 truncate text-[0.975rem] font-semibold text-foreground">
            {order.title}
          </p>
          <p className="mt-1 truncate text-[0.8125rem] text-muted-foreground">
            {order.assigned_team_member?.name ?? "Sin asignar"}
            {order.due_at ? ` · ${formatDueTime(order.due_at)}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {order.priority !== "normal" ? (
            <StatusBadge tone={priorityTone(order.priority)}>
              {priorityLabel(order.priority)}
            </StatusBadge>
          ) : null}
          {order.status?.name ? (
            <StatusBadge tone="brand">{order.status.name}</StatusBadge>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

function WorkloadRow({
  member,
  maxCount,
}: {
  member: DashboardWorkloadMember;
  maxCount: number;
}) {
  const ratio =
    maxCount > 0 ? Math.min(1, member.active_orders_count / maxCount) : 0;

  return (
    <Link
      href={`/orders?view=list&assigned_team_member_id=${member.id}`}
      className="gc-list-row"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{member.name}</p>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {member.job_title ?? "Sin puesto"}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
          {member.active_orders_count}
        </span>
      </div>
      <div className="gc-workload-track" aria-hidden>
        <div
          className="gc-workload-fill"
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </div>
    </Link>
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

    void loadDashboard();
  }, []);

  const workloadMax = useMemo(() => {
    const members = data?.workload.members ?? [];
    return members.reduce(
      (max, member) => Math.max(max, member.active_orders_count),
      0
    );
  }, [data?.workload.members]);

  if (loading && !data) {
    return (
      <DashboardShell>
        <AppNav />
        <div className="space-y-4">
          <div className="h-12 w-72 animate-pulse rounded-md bg-muted" />
          <div className="h-6 w-56 animate-pulse rounded-md bg-muted" />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="h-28 animate-pulse rounded-[var(--radius)] bg-muted"
              />
            ))}
          </div>
        </div>
      </DashboardShell>
    );
  }

  if (error && !data) {
    return (
      <DashboardShell>
        <AppNav />
        <div className="gc-card px-5 py-10 text-center">
          <p className="text-base font-medium text-foreground">
            No se pudo cargar el panel
          </p>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">{error}</p>
        </div>
      </DashboardShell>
    );
  }

  const counts = data?.counts;
  const members = data?.workload.members ?? [];
  const upcoming = data?.upcoming_orders ?? [];
  const attentionOrders = data?.attention_orders ?? [];
  const attentionCount = counts?.needs_attention ?? 0;
  const dateLabel = data?.local_date
    ? formatOperativeDate(data.local_date)
    : "";

  return (
    <DashboardShell>
      <AppNav />

      <PageHeader
        title="GESTCOPY · Panel diario"
        description={dateLabel || undefined}
        className="mb-7 sm:mb-8"
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiLink
          label="Pedidos activos"
          value={counts?.active ?? 0}
          href="/orders?view=list&filter=active"
        />
        <KpiLink
          label="Urgentes"
          value={counts?.urgent ?? 0}
          href="/orders?view=list&filter=urgent"
          valueClassName="gc-kpi-value-urgent"
        />
        <KpiLink
          label="Retrasados"
          value={counts?.overdue ?? 0}
          href="/orders?view=list&filter=overdue"
          valueClassName="gc-kpi-value-warning"
        />
        <KpiLink
          label="Entregas hoy"
          value={counts?.due_today ?? 0}
          href="/orders?view=calendar&scope=today"
          valueClassName="gc-kpi-value-info"
        />
      </div>

      <div className="mt-7 grid gap-4 sm:mt-8 lg:grid-cols-3 lg:gap-5">
        <SectionCard
          title="Próximas entregas"
          description="Entregas posteriores a hoy."
          bodyClassName="space-y-2.5 p-4 sm:p-5"
        >
          {upcoming.length === 0 ? (
            <EmptyState
              title="No hay entregas próximas."
              className="rounded-[calc(var(--radius)-4px)] bg-secondary/25 px-4 py-8 text-muted-foreground"
            />
          ) : (
            upcoming.map((order) => (
              <UpcomingRow key={order.id} order={order} />
            ))
          )}
        </SectionCard>

        <SectionCard
          title="Necesitan atención"
          description="Trabajos listos pendientes de completar."
          actions={
            attentionCount > attentionOrders.length ? (
              <Link
                href="/orders?view=list&filter=attention"
                className="text-sm font-medium text-primary hover:underline"
              >
                Ver todos
              </Link>
            ) : null
          }
          bodyClassName="space-y-2.5 p-4 sm:p-5"
        >
          {attentionCount === 0 ? (
            <EmptyState
              title="No hay pedidos pendientes de atención."
              className="rounded-[calc(var(--radius)-4px)] bg-secondary/25 px-4 py-8 text-muted-foreground"
            />
          ) : (
            attentionOrders.map((order) => (
              <AttentionRow key={order.id} order={order} />
            ))
          )}
        </SectionCard>

        <SectionCard
          title="Carga del equipo"
          description="Pedidos activos por persona"
          bodyClassName="space-y-2.5 p-4 sm:p-5"
        >
          {members.length === 0 ? (
            <EmptyState
              title="No hay miembros activos."
              className="rounded-[calc(var(--radius)-4px)] bg-secondary/25 px-4 py-8 text-muted-foreground"
            />
          ) : (
            members.map((member) => (
              <WorkloadRow
                key={member.id}
                member={member}
                maxCount={workloadMax}
              />
            ))
          )}
        </SectionCard>
      </div>
    </DashboardShell>
  );
}
