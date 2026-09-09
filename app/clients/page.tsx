"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AppNav } from "@/components/app-nav";
import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import {
  EMPTY_CLIENT_FORM,
  formatCreateDuplicateMessage,
  parseClientDuplicate,
  toClientPayload,
  type ClientDuplicate,
  type ClientListItem,
  type ClientListResponse,
} from "@/lib/clients/types";
import { canWriteClients } from "@/lib/auth/membership-roles";

type CustomerTypeOption = {
  id: string;
  name: string;
};

type ActiveFilter = "true" | "false" | "all";

function formatDate(value: string | null) {
  if (!value) return "Sin pedidos";

  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function contactLines(client: ClientListItem) {
  return [client.contact_name, client.email, client.phone].filter(
    (item): item is string => Boolean(item && item.trim())
  );
}

export default function ClientsPage() {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [customerTypeId, setCustomerTypeId] = useState("");
  const [active, setActive] = useState<ActiveFilter>("true");
  const [page, setPage] = useState(1);
  const [customerTypes, setCustomerTypes] = useState<CustomerTypeOption[]>([]);
  const [data, setData] = useState<ClientListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ClientDuplicate | null>(null);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    async function loadTypes() {
      const response = await fetch("/api/clients/options");
      const result = await response.json();
      if (response.ok) {
        setCustomerTypes(result.customer_types ?? []);
      }
    }

    async function loadContext() {
      const response = await fetch("/api/context");
      if (response.ok) {
        const context = await response.json();
        setCanWrite(canWriteClients(context?.membership?.role));
      }
    }

    void loadTypes();
    void loadContext();
  }, []);

  useEffect(() => {
    async function loadClients() {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          page: String(page),
          page_size: "25",
          active,
        });

        if (search) {
          params.set("search", search);
        }

        if (customerTypeId) {
          params.set("customer_type_id", customerTypeId);
        }

        const response = await fetch(`/api/clients/list?${params.toString()}`);
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error ?? "No se pudieron cargar los clientes");
        }

        setData(result);
      } catch (err) {
        setData(null);
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los clientes"
        );
      } finally {
        setLoading(false);
      }
    }

    loadClients();
  }, [search, customerTypeId, active, page]);

  const total = data?.total ?? 0;
  const pageSize = data?.page_size ?? 25;
  const currentPage = data?.page ?? page;
  const from = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, total);

  async function refreshList() {
    const params = new URLSearchParams({
      page: String(page),
      page_size: "25",
      active,
    });

    if (search) {
      params.set("search", search);
    }

    if (customerTypeId) {
      params.set("customer_type_id", customerTypeId);
    }

    const response = await fetch(`/api/clients/list?${params.toString()}`);
    const result = await response.json();
    if (response.ok) {
      setData(result);
    }
  }

  async function handleCreate(form: Parameters<typeof toClientPayload>[0]) {
    if (saving) return;

    setSaving(true);
    setCreateError(null);
    setDuplicate(null);

    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(toClientPayload(form)),
      });

      const result = await response.json();

      if (response.status === 409 && result.code === "client_duplicate") {
        const parsed = parseClientDuplicate(result.duplicate);
        setDuplicate(parsed);
        setCreateError(
          parsed
            ? formatCreateDuplicateMessage(parsed)
            : "Ya existe un cliente con estos datos."
        );
        return;
      }

      if (!response.ok) {
        throw new Error(result.error ?? "No se pudo crear el cliente");
      }

      setCreateOpen(false);
      await refreshList();
    } catch (err) {
      setCreateError(
        err instanceof Error ? err.message : "No se pudo crear el cliente"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background p-8">
      <div className="mx-auto max-w-7xl">
        <AppNav />

        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold">Clientes</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {total} clientes
            </p>
          </div>
          {canWrite ? (
            <Button
              type="button"
              onClick={() => {
                setCreateError(null);
                setDuplicate(null);
                setCreateOpen(true);
              }}
            >
              Nuevo cliente
            </Button>
          ) : null}
        </div>

        <div className="mb-6 grid gap-3 md:grid-cols-3">
          <input
            type="search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Buscar por nombre, empresa, contacto, email, teléfono, NIF/CIF..."
            className="rounded-md border bg-background px-3 py-2 text-sm md:col-span-1"
          />
          <select
            value={customerTypeId}
            onChange={(event) => {
              setCustomerTypeId(event.target.value);
              setPage(1);
            }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="">Todos los tipos</option>
            {customerTypes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
          <select
            value={active}
            onChange={(event) => {
              setActive(event.target.value as ActiveFilter);
              setPage(1);
            }}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
            <option value="all">Todos</option>
          </select>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">Cargando clientes...</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border bg-card">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">
                        Cliente
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Contacto
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Tipo</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Pedidos
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Último pedido
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.clients ?? []).map((client) => {
                      const contact = contactLines(client);

                      return (
                        <tr
                          key={client.id}
                          className="cursor-pointer border-b last:border-b-0 hover:bg-muted/30"
                          onClick={() => router.push(`/clients/${client.id}`)}
                        >
                          <td className="px-4 py-4">
                            <Link
                              href={`/clients/${client.id}`}
                              className="font-medium hover:underline"
                            >
                              {client.name}
                            </Link>
                            {client.company_name && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {client.company_name}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            {contact.length > 0 ? (
                              contact.map((line) => (
                                <div key={line}>{line}</div>
                              ))
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="px-4 py-4">
                            {client.customer_type_name ?? "Sin definir"}
                          </td>
                          <td className="px-4 py-4">{client.orders_count}</td>
                          <td className="px-4 py-4">
                            {formatDate(client.last_order_at)}
                          </td>
                          <td className="px-4 py-4">
                            {client.active ? "Activo" : "Inactivo"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-muted-foreground">
                Mostrando {from}–{to} de {total}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  disabled={!data?.has_more && currentPage >= (data?.total_pages ?? 1)}
                  onClick={() => setPage((current) => current + 1)}
                  className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
                >
                  Siguiente
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {canWrite && createOpen && (
        <ClientModal>
          <ClientForm
            title="Nuevo cliente"
            initialValues={EMPTY_CLIENT_FORM}
            submitting={saving}
            error={createError}
            duplicate={duplicate}
            duplicateActionLabel="Ver cliente existente"
            onCancel={() => {
              if (saving) return;
              setCreateOpen(false);
            }}
            onSubmit={handleCreate}
            onUseDuplicate={(clientId) => {
              router.push(`/clients/${clientId}`);
            }}
          />
        </ClientModal>
      )}
    </main>
  );
}
