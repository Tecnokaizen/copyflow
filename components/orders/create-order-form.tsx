"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientSelector } from "@/components/clients/client-selector";
import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import {
  EMPTY_CLIENT_FORM,
  parseClientDuplicate,
  summaryFromForm,
  toClientPayload,
  type ClientDuplicate,
  type ClientFormData,
  type ClientSummary,
} from "@/lib/clients/types";

type OptionItem = {
  id: string;
  name: string;
  code?: string;
};

type OrderOptionsResponse = {
  services: OptionItem[];
  entry_channels: OptionItem[];
  order_contexts: OptionItem[];
  team_members: OptionItem[];
};

type CreateOrderFormProps = {
  onCancel: () => void;
};

const selectClassName =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50";

function datetimeLocalToIso(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

export function CreateOrderForm({ onCancel }: CreateOrderFormProps) {
  const router = useRouter();
  const [options, setOptions] = useState<OrderOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(
    null
  );
  const [pendingNewClient, setPendingNewClient] =
    useState<ClientFormData | null>(null);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientFormInitial, setClientFormInitial] =
    useState<ClientFormData>(EMPTY_CLIENT_FORM);

  const [serviceId, setServiceId] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [entryChannelId, setEntryChannelId] = useState("");
  const [orderContextId, setOrderContextId] = useState("");
  const [priority, setPriority] = useState<"normal" | "high" | "urgent">(
    "normal"
  );
  const [assignedTeamMemberId, setAssignedTeamMemberId] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    async function loadOptions() {
      try {
        const response = await fetch("/api/orders/options");
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error ?? "No se pudieron cargar las opciones");
        }

        setOptions({
          services: result.services ?? [],
          entry_channels: result.entry_channels ?? [],
          order_contexts: result.order_contexts ?? [],
          team_members: result.team_members ?? [],
        });
      } catch (err) {
        setOptionsError(
          err instanceof Error
            ? err.message
            : "Error al cargar las opciones del formulario"
        );
      } finally {
        setOptionsLoading(false);
      }
    }

    loadOptions();
  }, []);

  function openCreateClient(query: string) {
    setClientFormInitial({
      ...EMPTY_CLIENT_FORM,
      name: query,
    });
    setClientModalOpen(true);
  }

  function keepPendingClient(form: ClientFormData) {
    setPendingNewClient(form);
    setSelectedClient(summaryFromForm(form, null));
    setClientModalOpen(false);
  }

  async function createOrder(clientId: string | null) {
    const trimmedTitle = title.trim();
    let dueAtIso: string | null = null;
    if (dueAt.trim()) {
      dueAtIso = datetimeLocalToIso(dueAt);
      if (!dueAtIso) {
        throw new Error("La fecha prevista no es válida");
      }
    }

    const response = await fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: trimmedTitle,
        client_id: clientId,
        service_id: serviceId || null,
        description: description.trim() || null,
        due_at: dueAtIso,
        entry_channel_id: entryChannelId || null,
        order_context_id: orderContextId || null,
        priority,
        assigned_team_member_id: assignedTeamMemberId || null,
        notes: notes.trim() || null,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error ?? "No se pudo crear el pedido");
    }

    if (!result.order?.id) {
      throw new Error("No se pudo crear el pedido");
    }

    return result.order.id as string;
  }

  async function assignExistingClient(orderId: string, clientId: string) {
    const response = await fetch(`/api/orders/${orderId}/client`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ client_id: clientId }),
    });

    if (!response.ok) {
      return false;
    }

    return true;
  }

  async function createAndAssignClient(
    orderId: string,
    form: ClientFormData
  ): Promise<{ ok: true } | { duplicate: ClientDuplicate } | { failed: true }> {
    const response = await fetch(`/api/orders/${orderId}/client`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(toClientPayload(form)),
    });

    const result = await response.json();

    if (response.status === 409 && result.code === "client_duplicate") {
      const duplicate = parseClientDuplicate(result.duplicate);
      if (duplicate) {
        return { duplicate };
      }
    }

    if (!response.ok) {
      return { failed: true };
    }

    return { ok: true };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("El nombre del pedido es obligatorio");
      return;
    }

    if (dueAt.trim() && !datetimeLocalToIso(dueAt)) {
      setError("La fecha prevista no es válida");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const existingClientId =
        selectedClient && selectedClient.id !== "pending"
          ? selectedClient.id
          : null;

      const orderId = await createOrder(existingClientId);

      if (pendingNewClient && !existingClientId) {
        const created = await createAndAssignClient(orderId, pendingNewClient);

        if ("duplicate" in created) {
          await assignExistingClient(orderId, created.duplicate.client_id);
        }
      }

      router.push(`/orders/${orderId}`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Error al crear el pedido"
      );
      setSubmitting(false);
    }
  }

  return (
    <section className="mb-6 rounded-lg border bg-card p-6">
      <h2 className="mb-4 text-lg font-semibold">Nuevo pedido</h2>

      {optionsLoading ? (
        <p className="text-sm text-muted-foreground">Cargando opciones...</p>
      ) : optionsError ? (
        <div className="grid gap-4">
          <p className="text-sm text-red-600">{optionsError}</p>
          <div>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="order-title">Nombre del pedido</Label>
            <Input
              id="order-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              disabled={submitting}
            />
          </div>

          <div className="grid gap-2 md:col-span-2">
            <Label>Cliente</Label>
            <ClientSelector
              value={selectedClient}
              disabled={submitting}
              allowNoClient
              onChange={(client) => {
                setSelectedClient(client);
                setPendingNewClient(null);
              }}
              onCreateNew={openCreateClient}
            />
            <p className="text-xs text-muted-foreground">
              Puedes registrar el pedido sin cliente y asignarlo después.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="order-service">Servicio</Label>
            <select
              id="order-service"
              value={serviceId}
              onChange={(event) => setServiceId(event.target.value)}
              disabled={submitting}
              className={selectClassName}
            >
              <option value="">Sin servicio</option>
              {options?.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="order-description">Descripción</Label>
            <textarea
              id="order-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={submitting}
              className={textareaClassName}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="order-due-at">Fecha prevista</Label>
            <Input
              id="order-due-at"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="order-channel">Canal de entrada</Label>
            <select
              id="order-channel"
              value={entryChannelId}
              onChange={(event) => setEntryChannelId(event.target.value)}
              disabled={submitting}
              className={selectClassName}
            >
              <option value="">Sin canal</option>
              {options?.entry_channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="order-context">Contexto</Label>
            <select
              id="order-context"
              value={orderContextId}
              onChange={(event) => setOrderContextId(event.target.value)}
              disabled={submitting}
              className={selectClassName}
            >
              <option value="">Sin contexto</option>
              {options?.order_contexts.map((context) => (
                <option key={context.id} value={context.id}>
                  {context.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="order-priority">Prioridad</Label>
            <select
              id="order-priority"
              value={priority}
              onChange={(event) =>
                setPriority(event.target.value as "normal" | "high" | "urgent")
              }
              disabled={submitting}
              className={selectClassName}
            >
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="order-assignee">Responsable</Label>
            <select
              id="order-assignee"
              value={assignedTeamMemberId}
              onChange={(event) => setAssignedTeamMemberId(event.target.value)}
              disabled={submitting}
              className={selectClassName}
            >
              <option value="">Sin asignar</option>
              {options?.team_members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-2 md:col-span-2">
            <Label htmlFor="order-notes">Observaciones</Label>
            <textarea
              id="order-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={submitting}
              className={textareaClassName}
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 md:col-span-2">{error}</p>
          )}

          <div className="flex flex-wrap gap-3 md:col-span-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creando..." : "Crear pedido"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={submitting}
            >
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {clientModalOpen && (
        <ClientModal>
          <ClientForm
            title="Crear cliente"
            initialValues={clientFormInitial}
            onCancel={() => {
              setClientModalOpen(false);
            }}
            onSubmit={keepPendingClient}
          />
        </ClientModal>
      )}
    </section>
  );
}
