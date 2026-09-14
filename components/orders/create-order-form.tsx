"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import { ClientSelector } from "@/components/clients/client-selector";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { SectionCard } from "@/components/gestcopy/section-card";
import {
  DraftInput,
  DraftSelect,
  DraftTextarea,
} from "@/components/orders/detail/order-field";
import {
  EMPTY_CLIENT_FORM,
  formatCreateDuplicateMessage,
  mapClientSummary,
  parseClientDuplicate,
  toClientPayload,
  type ClientDuplicate,
  type ClientFormData,
  type ClientSummary,
} from "@/lib/clients/types";
import {
  deriveOrderTitle,
  userFacingCreateOrderError,
} from "@/lib/orders/create";
import { fromDateTimeLocalValue } from "@/lib/orders/format";
import type { OrderOptionsResponse } from "@/lib/orders/types";

type CreateOrderFormProps = {
  onCancel: () => void;
};

export function CreateOrderForm({ onCancel }: CreateOrderFormProps) {
  const router = useRouter();
  const [options, setOptions] = useState<OrderOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsReload, setOptionsReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [selectedClient, setSelectedClient] = useState<ClientSummary | null>(
    null
  );
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [clientFormInitial, setClientFormInitial] =
    useState<ClientFormData>(EMPTY_CLIENT_FORM);
  const [savingClient, setSavingClient] = useState(false);
  const [clientActionError, setClientActionError] = useState<string | null>(
    null
  );
  const [clientDuplicate, setClientDuplicate] =
    useState<ClientDuplicate | null>(null);

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
          throw new Error(
            result.error ?? "No se pudieron cargar las opciones"
          );
        }

        setOptions({
          tenant: result.tenant,
          services: result.services ?? [],
          entry_channels: result.entry_channels ?? [],
          order_contexts: result.order_contexts ?? [],
          team_members: result.team_members ?? [],
        });
        setOptionsError(null);
      } catch (err) {
        setOptions(null);
        setOptionsError(
          err instanceof Error
            ? err.message
            : "Error al cargar las opciones del formulario"
        );
      } finally {
        setOptionsLoading(false);
      }
    }

    void loadOptions();
  }, [optionsReload]);

  const serviceName =
    options?.services.find((item) => item.id === serviceId)?.name ?? null;
  const derivedTitle = deriveOrderTitle({
    title,
    description,
    serviceName,
  });

  function openCreateClient(query: string) {
    setClientFormInitial({
      ...EMPTY_CLIENT_FORM,
      name: query,
    });
    setClientActionError(null);
    setClientDuplicate(null);
    setClientModalOpen(true);
  }

  function closeClientModal() {
    if (savingClient) return;
    setClientModalOpen(false);
    setClientActionError(null);
    setClientDuplicate(null);
  }

  async function selectClientById(clientId: string) {
    const response = await fetch(`/api/clients/${clientId}`);
    const result = await response.json();
    const summary = mapClientSummary(result.client);

    if (!response.ok || !summary) {
      throw new Error("No se pudo cargar el cliente");
    }

    setSelectedClient(summary);
    setClientModalOpen(false);
    setClientActionError(null);
    setClientDuplicate(null);
  }

  async function saveNewClient(form: ClientFormData) {
    if (savingClient) return;

    setSavingClient(true);
    setClientActionError(null);
    setClientDuplicate(null);

    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toClientPayload(form)),
      });
      const result = await response.json();

      if (response.status === 409 && result.code === "client_duplicate") {
        const duplicate = parseClientDuplicate(result.duplicate);
        setClientDuplicate(duplicate);
        setClientActionError(
          duplicate
            ? formatCreateDuplicateMessage(duplicate)
            : "Ya existe un cliente con estos datos."
        );
        return;
      }

      if (!response.ok) {
        throw new Error(
          userFacingCreateOrderError(
            result.error ?? "Could not create client"
          )
        );
      }

      const summary = mapClientSummary(result.client);
      if (!summary) {
        throw new Error("No se pudo crear el cliente");
      }

      setSelectedClient(summary);
      setClientModalOpen(false);
    } catch (err) {
      setClientActionError(
        err instanceof Error ? err.message : "No se pudo crear el cliente"
      );
    } finally {
      setSavingClient(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting) {
      return;
    }

    const dueAtIso = dueAt.trim() ? fromDateTimeLocalValue(dueAt) : null;
    if (dueAt.trim() && !dueAtIso) {
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

      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: derivedTitle,
          client_id: existingClientId,
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
        throw new Error(
          userFacingCreateOrderError(result.error ?? "Could not create order")
        );
      }

      if (!result.order?.id) {
        throw new Error("No se pudo crear el pedido");
      }

      router.push(`/orders/${result.order.id}?created=1`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo crear el pedido"
      );
      setSubmitting(false);
    }
  }

  return (
    <SectionCard
      title="Nuevo pedido"
      description="Datos mínimos para registrar el trabajo. El resto se puede completar en la ficha."
      className="mb-6"
      bodyClassName="px-5 py-5 sm:px-6"
    >
      {optionsLoading ? (
        <LoadingState label="Cargando opciones…" className="px-0 py-8" />
      ) : optionsError ? (
        <ErrorState
          title={userFacingCreateOrderError(optionsError)}
          className="px-0 py-6"
          onRetry={() => {
            setOptionsError(null);
            setOptionsLoading(true);
            setOptionsReload((current) => current + 1);
          }}
        />
      ) : (
        <form onSubmit={handleSubmit} className="grid gap-5">
          <label className="grid gap-2 text-sm font-medium text-foreground">
            Cliente
            <ClientSelector
              value={selectedClient}
              disabled={submitting}
              allowNoClient
              onChange={setSelectedClient}
              onCreateNew={openCreateClient}
            />
            <span className="text-xs font-normal text-muted-foreground">
              Busca por nombre, empresa o teléfono, o créalo sin salir.
            </span>
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Servicio
            <DraftSelect
              value={serviceId}
              disabled={submitting}
              className="max-w-none text-base"
              onChange={setServiceId}
            >
              <option value="">Sin servicio</option>
              {options?.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                </option>
              ))}
            </DraftSelect>
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Instrucciones
            <DraftTextarea
              value={description}
              disabled={submitting}
              rows={5}
              className="min-h-32 text-base"
              onChange={setDescription}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Entrega prevista
            <DraftInput
              type="datetime-local"
              value={dueAt}
              disabled={submitting}
              className="max-w-none text-base"
              onChange={setDueAt}
            />
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Responsable
            <DraftSelect
              value={assignedTeamMemberId}
              disabled={submitting}
              className="max-w-none text-base"
              onChange={setAssignedTeamMemberId}
            >
              <option value="">Sin asignar</option>
              {options?.team_members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </DraftSelect>
          </label>

          <label className="grid gap-2 text-sm font-medium text-foreground">
            Prioridad
            <DraftSelect
              value={priority}
              disabled={submitting}
              className="max-w-none text-base"
              onChange={(value) =>
                setPriority(value as "normal" | "high" | "urgent")
              }
            >
              <option value="normal">Normal</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </DraftSelect>
          </label>

          {(options?.entry_channels.length ?? 0) > 0 ? (
            <label className="grid gap-2 text-sm font-medium text-foreground">
              Canal de entrada
              <DraftSelect
                value={entryChannelId}
                disabled={submitting}
                className="max-w-none text-base"
                onChange={setEntryChannelId}
              >
                <option value="">Sin canal</option>
                {options?.entry_channels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    {channel.name}
                  </option>
                ))}
              </DraftSelect>
            </label>
          ) : null}

          <details className="rounded-md border border-border/70 bg-secondary/20 px-4 py-3">
            <summary className="min-h-11 cursor-pointer list-none text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
              Más opciones
            </summary>
            <div className="mt-4 grid gap-5">
              <label className="grid gap-2 text-sm font-medium text-foreground">
                Nombre del pedido
                <DraftInput
                  value={title}
                  disabled={submitting}
                  className="max-w-none text-base"
                  onChange={setTitle}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  {title.trim()
                    ? "Este nombre es el que verás en la ficha y en la lista."
                    : `Si lo dejas vacío se usará «${derivedTitle}».`}
                </span>
              </label>

              {(options?.order_contexts.length ?? 0) > 0 ? (
                <label className="grid gap-2 text-sm font-medium text-foreground">
                  Contexto
                  <DraftSelect
                    value={orderContextId}
                    disabled={submitting}
                    className="max-w-none text-base"
                    onChange={setOrderContextId}
                  >
                    <option value="">Sin contexto</option>
                    {options?.order_contexts.map((context) => (
                      <option key={context.id} value={context.id}>
                        {context.name}
                      </option>
                    ))}
                  </DraftSelect>
                </label>
              ) : null}

              <label className="grid gap-2 text-sm font-medium text-foreground">
                Notas internas
                <DraftTextarea
                  value={notes}
                  disabled={submitting}
                  rows={3}
                  className="text-base"
                  onChange={setNotes}
                />
              </label>
            </div>
          </details>

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <button
              type="submit"
              disabled={submitting}
              className="gc-cta min-h-11 w-full sm:w-auto disabled:opacity-50"
            >
              {submitting ? "Creando…" : "Crear pedido"}
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className="gc-action min-h-11 w-full sm:w-auto"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {clientModalOpen ? (
        <ClientModal>
          <ClientForm
            title="Crear cliente"
            initialValues={clientFormInitial}
            submitting={savingClient}
            error={clientActionError}
            duplicate={clientDuplicate}
            submitLabel="Crear cliente"
            onCancel={closeClientModal}
            onSubmit={saveNewClient}
            onUseDuplicate={(clientId) => {
              void selectClientById(clientId).catch((err: unknown) => {
                setClientActionError(
                  err instanceof Error
                    ? err.message
                    : "No se pudo usar el cliente existente"
                );
              });
            }}
          />
        </ClientModal>
      ) : null}
    </SectionCard>
  );
}
