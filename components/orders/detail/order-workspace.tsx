"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import { ClientSelector } from "@/components/clients/client-selector";
import { OrderActivity } from "@/components/orders/detail/order-activity";
import { OrderFulfillment } from "@/components/orders/detail/order-fulfillment";
import { OrderHeader } from "@/components/orders/detail/order-header";
import { OrderNotes } from "@/components/orders/detail/order-notes";
import { OrderProduction } from "@/components/orders/detail/order-production";
import { OrderSummary } from "@/components/orders/detail/order-summary";
import { canWriteOrders } from "@/lib/auth/membership-roles";
import {
  EMPTY_CLIENT_FORM,
  clientToForm,
  duplicateMatchLabels,
  formatCreateDuplicateMessage,
  mapClientSummary,
  parseClientDuplicate,
  toClientPayload,
  type ClientDuplicate,
  type ClientFormData,
  type ClientSummary,
} from "@/lib/clients/types";
import {
  buildDraftSaveSteps,
  createOrderDraft,
  isDraftTitleValid,
  resolveOrderStatusId,
  type DraftSaveStep,
} from "@/lib/orders/draft";
import type {
  ActivityItem,
  ActivityResponse,
  ClientUiMode,
  ManagementOptionsResponse,
  Order,
  OrderDraft,
  OrderOptionsResponse,
  OrderResponse,
  OrderStatus,
} from "@/lib/orders/types";

function normalizeLoadedOrder(order: Order): Order {
  return {
    ...order,
    client:
      order.client_id && order.client?.id ? order.client : null,
  };
}

export function OrderWorkspace() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [managementOptions, setManagementOptions] =
    useState<ManagementOptionsResponse | null>(null);
  const [managementOptionsLoading, setManagementOptionsLoading] =
    useState(true);
  const [orderOptions, setOrderOptions] =
    useState<OrderOptionsResponse | null>(null);
  const [orderOptionsLoading, setOrderOptionsLoading] = useState(true);
  const [canWrite, setCanWrite] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<OrderDraft | null>(null);
  const [saving, setSaving] = useState(false);

  const [clientUiMode, setClientUiMode] = useState<ClientUiMode | null>(null);
  const [savingClient, setSavingClient] = useState(false);
  const [clientFormInitial, setClientFormInitial] =
    useState<ClientFormData>(EMPTY_CLIENT_FORM);
  const [clientActionError, setClientActionError] = useState<string | null>(
    null
  );
  const [clientDuplicate, setClientDuplicate] =
    useState<ClientDuplicate | null>(null);
  const [confirmRemoveClient, setConfirmRemoveClient] = useState(false);

  async function loadActivity() {
    try {
      const response = await fetch(`/api/orders/${params.id}/activity`);

      if (!response.ok) {
        setActivity([]);
        return;
      }

      const result: ActivityResponse = await response.json();
      setActivity(result.activity ?? []);
    } catch {
      setActivity([]);
    } finally {
      setActivityLoading(false);
    }
  }

  useEffect(() => {
    async function loadOrder() {
      try {
        const response = await fetch(`/api/orders/${params.id}`);
        const result: OrderResponse = await response.json();

        if (!response.ok) {
          throw new Error("No se pudo cargar el pedido");
        }

        if (!result.order) {
          throw new Error("Pedido no encontrado");
        }

        setOrder(normalizeLoadedOrder(result.order));
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al cargar el pedido"
        );
      } finally {
        setLoading(false);
      }
    }

    async function loadContext() {
      const response = await fetch("/api/context");
      if (response.ok) {
        const context = await response.json();
        setCanWrite(canWriteOrders(context?.membership?.role));
      }
    }

    void loadOrder();
    void loadContext();
  }, [params.id]);

  useEffect(() => {
    async function loadStatuses() {
      try {
        const response = await fetch("/api/order-statuses");
        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error ?? "No se pudieron cargar los estados");
        }

        setStatuses(result.statuses ?? []);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Error al cargar los estados"
        );
      }
    }

    void loadStatuses();
  }, []);

  useEffect(() => {
    async function loadManagementOptions() {
      try {
        const response = await fetch("/api/orders/management-options");
        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ?? "No se pudieron cargar las opciones de gestión"
          );
        }

        setManagementOptions(result);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Error al cargar las opciones de gestión"
        );
      } finally {
        setManagementOptionsLoading(false);
      }
    }

    void loadManagementOptions();
  }, []);

  useEffect(() => {
    async function loadOrderOptions() {
      try {
        const response = await fetch("/api/orders/options");
        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ?? "No se pudieron cargar las opciones del pedido"
          );
        }

        setOrderOptions({
          tenant: result.tenant,
          services: result.services ?? [],
          entry_channels: result.entry_channels ?? [],
          order_contexts: result.order_contexts ?? [],
          team_members: result.team_members ?? [],
        });
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Error al cargar las opciones del pedido"
        );
      } finally {
        setOrderOptionsLoading(false);
      }
    }

    void loadOrderOptions();
  }, []);

  useEffect(() => {
    async function loadOrderActivity() {
      try {
        const response = await fetch(`/api/orders/${params.id}/activity`);

        if (!response.ok) {
          setActivity([]);
          return;
        }

        const result: ActivityResponse = await response.json();
        setActivity(result.activity ?? []);
      } catch {
        setActivity([]);
      } finally {
        setActivityLoading(false);
      }
    }

    void loadOrderActivity();
  }, [params.id]);

  function patchDraft(patch: Partial<OrderDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function startEditing() {
    if (!order || !canWrite) return;
    setSaveMessage(null);
    setError(null);
    setDraft(createOrderDraft(order, statuses));
    setEditing(true);
  }

  function cancelEditing() {
    if (saving) return;
    setDraft(null);
    setEditing(false);
    setSaveMessage(null);
    setError(null);
    setConfirmRemoveClient(false);
    setClientUiMode(null);
  }

  async function applySaveStep(
    current: Order,
    step: DraftSaveStep
  ): Promise<Order> {
    if (step.kind === "status") {
      const response = await fetch(`/api/orders/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status_id: step.status_id }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "No se pudo actualizar el estado");
      }
      return {
        ...current,
        status_id: step.status_id,
        status: result.status ?? current.status,
        ready_at: result.order?.ready_at ?? current.ready_at,
        delivered_at: result.order?.delivered_at ?? current.delivered_at,
      };
    }

    if (step.kind === "content") {
      const response = await fetch(`/api/orders/${current.id}/content`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: step.field, value: step.value }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudo actualizar el contenido del pedido"
        );
      }
      if (step.field === "title") {
        return { ...current, title: result.order.title };
      }
      if (step.field === "description") {
        return { ...current, description: result.order.description };
      }
      return { ...current, notes: result.order.notes };
    }

    if (step.kind === "detail") {
      const response = await fetch(`/api/orders/${current.id}/details`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: step.field, value: step.value }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudieron actualizar los datos del pedido"
        );
      }
      const nextValue = result.value ?? null;
      if (step.field === "priority") {
        return { ...current, priority: result.order.priority };
      }
      if (step.field === "service_id") {
        return {
          ...current,
          service_id: result.order.service_id,
          service: nextValue,
        };
      }
      if (step.field === "entry_channel_id") {
        return {
          ...current,
          entry_channel_id: result.order.entry_channel_id,
          entry_channel: nextValue,
        };
      }
      if (step.field === "assigned_team_member_id") {
        return {
          ...current,
          assigned_team_member_id: result.order.assigned_team_member_id,
          assigned_team_member: nextValue,
        };
      }
      if (step.field === "order_context_id") {
        return {
          ...current,
          order_context_id: result.order.order_context_id,
          order_context: nextValue,
        };
      }
      return { ...current, due_at: result.order.due_at };
    }

    if (step.kind === "management") {
      const response = await fetch(`/api/orders/${current.id}/management`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field: step.field, value_id: step.value_id }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(
          result.error ?? "No se pudo actualizar la gestión del pedido"
        );
      }
      const nextValue = result.value ?? null;
      if (step.field === "file_status_id") {
        return {
          ...current,
          file_status_id: result.order.file_status_id,
          file_status: nextValue,
        };
      }
      if (step.field === "quote_status_id") {
        return {
          ...current,
          quote_status_id: result.order.quote_status_id,
          quote_status: nextValue,
        };
      }
      if (step.field === "payment_status_id") {
        return {
          ...current,
          payment_status_id: result.order.payment_status_id,
          payment_status: nextValue,
        };
      }
      return {
        ...current,
        delivery_method_id: result.order.delivery_method_id,
        delivery_method: nextValue,
      };
    }

    const response = await fetch(`/api/orders/${current.id}/notification`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        notification_status: step.notification_status,
      }),
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(
        result.error ?? "No se pudo actualizar el aviso al cliente"
      );
    }
    return {
      ...current,
      customer_notification_status: result.order.customer_notification_status,
    };
  }

  async function saveEditing() {
    if (!order || !draft || saving) return;

    const readyDraft = draft.status_id
      ? draft
      : {
          ...draft,
          status_id: resolveOrderStatusId(order, statuses),
        };

    if (!isDraftTitleValid(readyDraft)) {
      setError("El título no puede estar vacío");
      return;
    }

    const steps = buildDraftSaveSteps(order, readyDraft, statuses);
    if (steps.length === 0) {
      setEditing(false);
      setDraft(null);
      setSaveMessage(null);
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    setSaveMessage(null);

    let working = order;
    const succeeded: string[] = [];
    const failed: string[] = [];

    for (const step of steps) {
      try {
        working = await applySaveStep(working, step);
        setOrder(working);
        succeeded.push(step.label);
      } catch (err) {
        failed.push(
          `${step.label}: ${
            err instanceof Error ? err.message : "Error al guardar"
          }`
        );
      }
    }

    await loadActivity();
    setSaving(false);

    if (failed.length === 0) {
      setEditing(false);
      setDraft(null);
      setSaveMessage(
        succeeded.length === 1
          ? "Cambios guardados"
          : `${succeeded.length} cambios guardados`
      );
      return;
    }

    setDraft(createOrderDraft(working, statuses));
    setOrder(working);

    if (succeeded.length > 0) {
      setError(
        `Guardado parcial. OK: ${succeeded.join(", ")}. Fallos: ${failed.join(
          " · "
        )}`
      );
    } else {
      setError(`No se pudieron guardar los cambios. ${failed.join(" · ")}`);
    }
  }

  function closeClientUi() {
    if (savingClient) return;
    setClientUiMode(null);
    setClientActionError(null);
    setClientDuplicate(null);
  }

  function applyClientToOrder(
    clientId: string | null,
    client: ClientSummary | null
  ) {
    setOrder((current) => {
      if (!current) return current;
      return {
        ...current,
        client_id: clientId,
        client:
          client && client.id !== "pending"
            ? {
                id: client.id,
                customer_type_id: client.customer_type_id,
                name: client.name,
                contact_name: client.contact_name,
                company_name: client.company_name,
                tax_id: client.tax_id,
                email: client.email,
                phone: client.phone,
                notes: client.notes,
              }
            : null,
      };
    });
  }

  function openEditClient() {
    const client = order?.client_id && order.client?.id ? order.client : null;
    if (!client) return;
    setClientFormInitial(clientToForm(client));
    setClientActionError(null);
    setClientDuplicate(null);
    setClientUiMode("edit");
  }

  function openCreateClient(query = "") {
    setClientFormInitial({ ...EMPTY_CLIENT_FORM, name: query });
    setClientActionError(null);
    setClientDuplicate(null);
    setClientUiMode("create");
  }

  function openAssignClient() {
    setClientActionError(null);
    setClientDuplicate(null);
    setClientUiMode("assign");
  }

  function openChangeClient() {
    setClientActionError(null);
    setClientDuplicate(null);
    setClientUiMode("change");
  }

  async function assignExistingClient(
    clientId: string | null,
    selected?: ClientSummary | null
  ) {
    if (!order || savingClient) return;

    setSavingClient(true);
    setClientActionError(null);

    try {
      const response = await fetch(`/api/orders/${order.id}/client`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error ?? "No se pudo asignar el cliente");
      }
      applyClientToOrder(
        result.order?.client_id ?? clientId,
        mapClientSummary(result.client) ?? selected ?? null
      );
      setConfirmRemoveClient(false);
      setClientUiMode(null);
      setClientDuplicate(null);
      await loadActivity();
    } catch (err) {
      setClientActionError(
        err instanceof Error ? err.message : "Error al asignar el cliente"
      );
    } finally {
      setSavingClient(false);
    }
  }

  async function saveClientForm(form: ClientFormData) {
    if (!order || savingClient) return;

    const editingClient =
      order.client_id && order.client?.id ? order.client : null;

    if (clientUiMode === "edit" && !editingClient) return;

    setSavingClient(true);
    setClientActionError(null);
    setClientDuplicate(null);

    try {
      if (clientUiMode === "edit") {
        if (!editingClient) return;

        const response = await fetch(`/api/clients/${editingClient.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(toClientPayload(form)),
        });
        const result = await response.json();

        if (response.status === 409 && result.code === "client_duplicate") {
          const duplicate = parseClientDuplicate(result.duplicate);
          setClientDuplicate(duplicate);
          const matches = duplicate ? duplicateMatchLabels(duplicate) : [];
          const who = duplicate?.client_name
            ? ` (${duplicate.client_name})`
            : "";
          setClientActionError(
            `Ya existe otro cliente con estos datos${who}.${
              matches.length > 0 ? ` Coincidencia: ${matches.join(", ")}.` : ""
            }`
          );
          return;
        }

        if (!response.ok) {
          throw new Error(result.error ?? "No se pudo actualizar el cliente");
        }

        const summary = mapClientSummary(result.client);
        if (summary) {
          applyClientToOrder(order.client_id, summary);
        } else {
          setOrder((current) =>
            current ? { ...current, client: result.client } : current
          );
        }
        setClientUiMode(null);
        await loadActivity();
        return;
      }

      const response = await fetch(`/api/orders/${order.id}/client`, {
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
        throw new Error(result.error ?? "No se pudo crear el cliente");
      }

      applyClientToOrder(
        result.order?.client_id ?? null,
        mapClientSummary(result.client)
      );
      setClientUiMode(null);
      await loadActivity();
    } catch (err) {
      setClientActionError(
        err instanceof Error ? err.message : "Error al guardar el cliente"
      );
    } finally {
      setSavingClient(false);
    }
  }

  if (loading) {
    return (
      <main className="gc-page">
        <div className="gc-page-inner">
          <AppNav />
          <p className="text-muted-foreground">Cargando pedido…</p>
        </div>
      </main>
    );
  }

  if (!order) {
    return (
      <main className="gc-page">
        <div className="gc-page-inner">
          <AppNav />
          <p className="text-destructive">{error ?? "Pedido no encontrado"}</p>
        </div>
      </main>
    );
  }

  const currentClient =
    order.client_id && order.client?.id ? order.client : null;

  const clientActions = (
    <>
      {currentClient ? (
        <>
          <button
            type="button"
            onClick={openEditClient}
            className="gc-action"
          >
            Editar cliente
          </button>
          <button
            type="button"
            onClick={openChangeClient}
            className="gc-action"
          >
            Cambiar cliente
          </button>
          {confirmRemoveClient ? (
            <>
              <span className="self-center text-sm text-muted-foreground">
                ¿Quitar el cliente de este pedido?
              </span>
              <button
                type="button"
                disabled={savingClient}
                onClick={() => void assignExistingClient(null)}
                className="gc-action-danger disabled:opacity-50"
              >
                Sí, quitar
              </button>
              <button
                type="button"
                onClick={() => setConfirmRemoveClient(false)}
                className="gc-action"
              >
                Cancelar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmRemoveClient(true)}
              className="gc-action"
            >
              Quitar cliente
            </button>
          )}
        </>
      ) : (
        <button type="button" onClick={openAssignClient} className="gc-action">
          Asignar cliente
        </button>
      )}
    </>
  );

  return (
    <main className="gc-page">
      <div className="gc-page-inner max-w-5xl">
        <AppNav />

        {!canWrite ? (
          <p className="mb-4 text-sm text-muted-foreground">Solo lectura</p>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {saveMessage ? (
          <div className="mb-4 rounded-[var(--radius)] border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground">
            {saveMessage}
          </div>
        ) : null}

        <OrderHeader
          order={order}
          draft={draft}
          editing={editing}
          canWrite={canWrite}
          saving={saving}
          statuses={statuses}
          orderOptions={orderOptions}
          onEdit={startEditing}
          onCancel={cancelEditing}
          onSave={() => void saveEditing()}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <OrderSummary
            order={order}
            draft={draft}
            editing={editing}
            orderOptions={orderOptions}
            orderOptionsLoading={orderOptionsLoading}
            onDraftChange={patchDraft}
            clientActions={clientActions}
          />
          <OrderProduction
            order={order}
            draft={draft}
            editing={editing}
            statuses={statuses}
            orderOptions={orderOptions}
            orderOptionsLoading={orderOptionsLoading}
            managementOptions={managementOptions}
            managementOptionsLoading={managementOptionsLoading}
            onDraftChange={patchDraft}
          />
          <OrderFulfillment
            order={order}
            draft={draft}
            editing={editing}
            managementOptions={managementOptions}
            managementOptionsLoading={managementOptionsLoading}
            onDraftChange={patchDraft}
          />
          <OrderNotes
            order={order}
            draft={draft}
            editing={editing}
            onDraftChange={patchDraft}
          />
        </div>

        <div className="mt-6">
          <OrderActivity activity={activity} loading={activityLoading} />
        </div>
      </div>

      {canWrite && editing && (clientUiMode === "assign" || clientUiMode === "change") && (
        <ClientModal>
          <h2 className="mb-4 text-lg font-semibold">
            {clientUiMode === "change" ? "Cambiar cliente" : "Asignar cliente"}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Busca un cliente existente o crea uno nuevo para este pedido.
          </p>
          <ClientSelector
            value={null}
            disabled={savingClient}
            initiallyOpen
            onChange={(client) => {
              if (client) {
                void assignExistingClient(client.id, client);
              }
            }}
            onCreateNew={openCreateClient}
          />
          {clientActionError ? (
            <p className="mt-3 text-sm text-destructive">{clientActionError}</p>
          ) : null}
          <div className="mt-4">
            <button
              type="button"
              disabled={savingClient}
              onClick={closeClientUi}
              className="gc-action disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </ClientModal>
      )}

      {canWrite &&
        editing &&
        (clientUiMode === "edit" || clientUiMode === "create") && (
          <ClientModal>
            <ClientForm
              title={
                clientUiMode === "edit" ? "Editar cliente" : "Crear cliente"
              }
              initialValues={clientFormInitial}
              submitting={savingClient}
              error={clientActionError}
              duplicate={clientDuplicate}
              onCancel={() => {
                if (savingClient) return;
                if (clientUiMode === "create") {
                  setClientActionError(null);
                  setClientDuplicate(null);
                  setClientUiMode(currentClient ? "change" : "assign");
                  return;
                }
                closeClientUi();
              }}
              onSubmit={saveClientForm}
              onUseDuplicate={
                clientUiMode === "create"
                  ? (clientId) => {
                      void assignExistingClient(clientId);
                    }
                  : undefined
              }
            />
          </ClientModal>
        )}
    </main>
  );
}
