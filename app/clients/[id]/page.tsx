"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import { AppShell } from "@/components/gestcopy/app-shell";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { PageHeader } from "@/components/gestcopy/page-header";
import {
  clientToForm,
  duplicateMatchLabels,
  parseClientDuplicate,
  toClientPayload,
  type ClientDetail,
  type ClientDetailResponse,
  type ClientDuplicate,
  type ClientOrderSummary,
} from "@/lib/clients/types";
import { canWriteClients } from "@/lib/auth/membership-roles";

function formatDate(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function formatDateTime(value: string | null) {
  if (!value) return "—";

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatPriority(value: string) {
  switch (value) {
    case "high":
      return "Alta";
    case "urgent":
      return "Urgente";
    default:
      return "Normal";
  }
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="grid gap-1 border-b py-4 last:border-b-0 md:grid-cols-[220px_1fr]">
      <div className="text-sm font-medium text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

function ClientDetailContent() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<ClientDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ClientDuplicate | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const response = await fetch(`/api/clients/${params.id}`);
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error ?? "No se pudo cargar el cliente");
        }

        setData(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "No se pudo cargar el cliente"
        );
      } finally {
        setLoading(false);
      }
    }

    async function loadContext() {
      const response = await fetch("/api/context");
      if (response.ok) {
        const context = await response.json();
        setCanWrite(canWriteClients(context?.membership?.role));
      }
    }

    void load();
    void loadContext();
  }, [params.id]);

  async function handleEdit(form: Parameters<typeof toClientPayload>[0]) {
    const client = data?.client;
    if (!client || saving) return;

    setSaving(true);
    setEditError(null);
    setDuplicate(null);

    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toClientPayload(form)),
      });

      const result = await response.json();

      if (response.status === 409 && result.code === "client_duplicate") {
        const parsed = parseClientDuplicate(result.duplicate);
        setDuplicate(parsed);
        const matches = parsed ? duplicateMatchLabels(parsed) : [];
        const who = parsed?.client_name ? ` (${parsed.client_name})` : "";
        setEditError(
          `Ya existe otro cliente con estos datos${who}.${
            matches.length > 0 ? ` Coincidencia: ${matches.join(", ")}.` : ""
          }`
        );
        return;
      }

      if (!response.ok) {
        throw new Error(result.error ?? "No se pudo actualizar el cliente");
      }

      const refreshed = await fetch(`/api/clients/${client.id}`);
      const refreshedResult = await refreshed.json();
      if (refreshed.ok) {
        setData(refreshedResult);
      }
      setEditOpen(false);
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar el cliente"
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AppShell innerClassName="max-w-5xl">
        <AppNav />
        <LoadingState label="Cargando cliente..." />
      </AppShell>
    );
  }

  if (error || !data) {
    return (
      <AppShell innerClassName="max-w-5xl">
        <AppNav />
        <ErrorState title={error ?? "Cliente no encontrado"} />
      </AppShell>
    );
  }

  const client: ClientDetail = data.client;
  const orders: ClientOrderSummary[] = data.orders ?? [];

  return (
    <AppShell innerClassName="max-w-5xl">
      <AppNav />

      <Link
        href="/clients"
        className="mb-4 inline-block text-sm text-muted-foreground hover:underline"
      >
        ← Clientes
      </Link>

      <PageHeader
        title={client.name}
        description={`${client.customer_type_name ?? "Sin definir"} · ${
          client.active ? "Activo" : "Inactivo"
        }`}
        actions={
          canWrite ? (
            <button
              type="button"
              onClick={() => {
                setEditError(null);
                setDuplicate(null);
                setEditOpen(true);
              }}
              className="gc-action"
            >
              Editar cliente
            </button>
          ) : null
        }
      />

      <section className="rounded-lg border bg-card p-6">
        <h2 className="mb-2 text-lg font-semibold">Datos</h2>
        <DetailRow label="Nombre" value={client.name} />
        <DetailRow
          label="Empresa / razón social"
          value={client.company_name}
        />
        <DetailRow
          label="Persona de contacto"
          value={client.contact_name}
        />
        <DetailRow label="NIF/CIF" value={client.tax_id} />
        <DetailRow label="Email" value={client.email} />
        <DetailRow label="Teléfono" value={client.phone} />
        <DetailRow
          label="Tipo"
          value={client.customer_type_name ?? "Sin definir"}
        />
        <DetailRow label="Notas" value={client.notes} />
      </section>

      <section className="mt-6 rounded-lg border bg-card p-6">
        <h2 className="mb-2 text-lg font-semibold">Pedidos</h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Pedidos realizados: {data.orders_count} · Último pedido:{" "}
          {data.last_order_at
            ? formatDate(data.last_order_at)
            : "Sin pedidos"}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Pedido</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-left font-medium">
                  Prioridad
                </th>
                <th className="px-4 py-3 text-left font-medium">Entrega</th>
                <th className="px-4 py-3 text-left font-medium">Creado</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-4 text-muted-foreground"
                    colSpan={5}
                  >
                    Este cliente todavía no tiene pedidos.
                  </td>
                </tr>
              ) : (
                orders.map((order) => (
                  <tr
                    key={order.id}
                    className="border-b last:border-b-0 hover:bg-muted/30"
                  >
                    <td className="px-4 py-4">
                      <Link
                        href={`/orders/${order.id}`}
                        className="font-medium hover:underline"
                      >
                        {order.title}
                      </Link>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {order.reference}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {order.status?.name ?? "—"}
                    </td>
                    <td className="px-4 py-4">
                      {formatPriority(order.priority)}
                    </td>
                    <td className="px-4 py-4">
                      {formatDateTime(order.due_at)}
                    </td>
                    <td className="px-4 py-4">
                      {formatDateTime(order.created_at)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editOpen && (
        <ClientModal>
          <ClientForm
            title="Editar cliente"
            initialValues={clientToForm(client)}
            submitting={saving}
            error={editError}
            duplicate={duplicate}
            duplicateActionLabel="Ver cliente existente"
            onCancel={() => {
              if (saving) return;
              setEditOpen(false);
            }}
            onSubmit={handleEdit}
            onUseDuplicate={(clientId) => {
              router.push(`/clients/${clientId}`);
            }}
          />
        </ClientModal>
      )}
    </AppShell>
  );
}

export default function ClientDetailPage() {
  return (
    <Suspense
      fallback={
        <AppShell innerClassName="max-w-5xl">
          <AppNav />
          <LoadingState label="Cargando cliente..." />
        </AppShell>
      }
    >
      <ClientDetailContent />
    </Suspense>
  );
}
