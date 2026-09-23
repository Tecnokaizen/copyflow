"use client";

import Link from "next/link";
import { CreateOrderFiles } from "@/components/files/create-order-files";
import { OrderFilesSection } from "@/components/files/order-files-section";
import { type ClientUploadItem, MAX_ORDER_FILE_BYTES } from "@/lib/files/client";
import { createOrderUploadQueue } from "@/lib/files/create-order-queue";
import { Fragment, FormEvent, useEffect, useRef, useState } from "react";
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
import {
  buildCreateOrderPayload,
} from "@/lib/orders/create-form";
import {
  defaultSingleCatalogId,
  isQuickCreateMode,
  quickFieldIsAvailable,
  shouldStayOnCreateForm,
  showEntryChannelInMainForm,
  suggestedAssigneeId,
} from "@/lib/orders/create-form-layout";
import { fromDateTimeLocalValue } from "@/lib/orders/format";
import type { OrderOptionsResponse } from "@/lib/orders/types";
import { fetchLive } from "@/lib/refresh/fetch-live";
import {
  DEFAULT_QUICK_ORDER_LAYOUT,
  fieldsForPlacement,
  type QuickOrderField,
  type QuickOrderLayout,
} from "@/lib/settings/quick-order-layout";
import { defaultActiveStoreId } from "@/lib/stores/scope";

type CreateOrderFormProps = {
  mode?: "full" | "quick";
  fromCounter?: boolean;
  onCancel: () => void;
};

type CreatedOrder = {
  id: string;
  reference: string;
};

type QuickOrderOptionsResponse = OrderOptionsResponse & {
  quick_order_layout: QuickOrderLayout;
  file_statuses: { id: string; code: string; name: string }[];
  max_file_bytes: number;
};

export function CreateOrderForm({
  mode = "full",
  fromCounter = false,
  onCancel,
}: CreateOrderFormProps) {
  const router = useRouter();
  const isQuick = isQuickCreateMode(mode);
  const [options, setOptions] =
    useState<QuickOrderOptionsResponse | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsReload, setOptionsReload] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedOrder | null>(null);

  const submitLock = useRef(false);
  const [uploads, setUploads] = useState<ClientUploadItem[]>([]);
  const [uploadQueue] = useState(() => createOrderUploadQueue(setUploads));
  const maxFileBytes = options?.max_file_bytes ?? MAX_ORDER_FILE_BYTES;
  const pendingUploads = uploads.some((item) => item.phase !== "success");
  const [fileStatusId, setFileStatusId] = useState("");

  useEffect(() => {
    if (!pendingUploads) return;
    function warnOnLeave(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", warnOnLeave);
    return () => window.removeEventListener("beforeunload", warnOnLeave);
  }, [pendingUploads]);

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
  const [storeId, setStoreId] = useState("");
  const [notes, setNotes] = useState("");

  function applyCatalogDefaults(nextOptions: OrderOptionsResponse) {
    setStoreId((current) => {
      if (current) {
        return current;
      }
      return defaultActiveStoreId(nextOptions.stores) ?? "";
    });

    if (!isQuick) {
      return;
    }

    setAssignedTeamMemberId((current) =>
      suggestedAssigneeId({
        currentAssigneeId: current,
        role: nextOptions.actor_role,
        sessionTeamMemberId: nextOptions.current_team_member?.id,
        availableMemberIds: nextOptions.team_members.map((member) => member.id),
      })
    );
    setEntryChannelId((current) => {
      if (current) {
        return current;
      }
      return defaultSingleCatalogId(nextOptions.entry_channels) ?? "";
    });
  }

  function resetQuickForm(nextOptions: OrderOptionsResponse | null) {
    uploadQueue.clear();
    setFileStatusId("");
    setTitle("");
    setSelectedClient(null);
    setServiceId("");
    setDescription("");
    setDueAt("");
    setEntryChannelId("");
    setOrderContextId("");
    setPriority("normal");
    setAssignedTeamMemberId("");
    setStoreId("");
    setNotes("");
    setError(null);
    setCreated(null);
    setSubmitting(false);
    if (nextOptions) {
      applyCatalogDefaults(nextOptions);
    }
  }

  useEffect(() => {
    async function loadOptions() {
      try {
        const response = await fetchLive("/api/orders/options");
        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ?? "No se pudieron cargar las opciones"
          );
        }

        const nextOptions = {
          tenant: result.tenant,
          services: result.services ?? [],
          file_statuses: result.file_statuses ?? [],
          max_file_bytes: result.max_file_bytes ?? MAX_ORDER_FILE_BYTES,
          entry_channels: result.entry_channels ?? [],
          order_contexts: result.order_contexts ?? [],
          team_members: result.team_members ?? [],
          stores: result.stores ?? [],
          actor_role:
            typeof result.actor_role === "string" ? result.actor_role : null,
          current_team_member: result.current_team_member ?? null,
          quick_order_layout:
            result.quick_order_layout ?? DEFAULT_QUICK_ORDER_LAYOUT,
        };
        setOptions(nextOptions);
        applyCatalogDefaults(nextOptions);
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
    // Defaults depend on the form mode, not on changing handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsReload, isQuick]);

  const serviceName =
    options?.services.find((item) => item.id === serviceId)?.name ?? null;
  const derivedTitle = deriveOrderTitle({
    title,
    description,
    serviceName,
  });
  const channelCount = options?.entry_channels.length ?? 0;
  const showChannelInMain = showEntryChannelInMainForm(mode, channelCount);
  const quickLayout =
    options?.quick_order_layout ?? DEFAULT_QUICK_ORDER_LAYOUT;
  const quickCatalogCounts = {
    stores: options?.stores.length ?? 0,
    entryChannels: channelCount,
    orderContexts: options?.order_contexts.length ?? 0,
  };
  const quickPrimaryFields = fieldsForPlacement(
    quickLayout,
    "primary"
  ).filter((field) => quickFieldIsAvailable(field, quickCatalogCounts));
  const quickMoreFields = fieldsForPlacement(quickLayout, "more").filter(
    (field) => quickFieldIsAvailable(field, quickCatalogCounts)
  );

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

    if (submitLock.current || created) {
      return;
    }

    const dueAtIso = dueAt.trim() ? fromDateTimeLocalValue(dueAt) : null;
    if (dueAt.trim() && !dueAtIso) {
      setError("La fecha prevista no es válida");
      return;
    }

    if (uploads.some((item) => item.errorKind === "client")) {
      setError("Quita los archivos no válidos de la cola antes de crear el pedido.");
      return;
    }
    submitLock.current = true;
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
        body: JSON.stringify(
          buildCreateOrderPayload({
            title: derivedTitle,
            clientId: existingClientId,
            serviceId,
            description,
            dueAtIso,
            entryChannelId,
            orderContextId,
            priority,
            assignedTeamMemberId,
            storeId,
            notes,
            fileStatusId,
          })
        ),
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

      // Remember the saved order before any upload; failures only retry its queue.
      const savedOrder = {
        id: result.order.id as string,
        reference: typeof result.order.reference === "string" ? result.order.reference : "Pedido",
      };
      setCreated(savedOrder);
      const allUploaded = await uploadQueue.upload(savedOrder.id, maxFileBytes);
      if (!allUploaded) {
        setError("El pedido está creado. Algunos archivos no se han podido subir; reinténtalos aquí.");
      } else if (!shouldStayOnCreateForm(mode)) {
        router.push(`/orders/${savedOrder.id}?created=1`);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo crear el pedido"
      );
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  }

  async function retryUploads() {
    if (!created || submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const complete = await uploadQueue.upload(created.id, maxFileBytes);
      if (!complete) setError("Quedan archivos pendientes. Puedes volver a reintentar.");
      else if (!shouldStayOnCreateForm(mode)) router.push(`/orders/${created.id}?created=1`);
    } catch {
      setError("No se han podido completar los archivos. El pedido ya está creado.");
    } finally {
      setSubmitting(false);
      submitLock.current = false;
    }
  }

  function renderFilesField() {
    return (
      <CreateOrderFiles
        items={uploads}
        busy={submitting}
        saved={Boolean(created)}
        maxFileBytes={maxFileBytes}
        onAdd={(files) => uploadQueue.add(files, maxFileBytes)}
        onRemove={(id) => uploadQueue.remove(id)}
      />
    );
  }

  function renderFileStatusField() {
    return (
      <label className="grid gap-2 text-sm font-medium text-foreground">
        Estado de archivos
        <DraftSelect value={fileStatusId} disabled={submitting} className="max-w-none text-base" onChange={setFileStatusId}>
          <option value="">Sin estado de archivos</option>
          {options?.file_statuses.map((status) => <option key={status.id} value={status.id}>{status.name}</option>)}
        </DraftSelect>
        <span className="text-xs font-normal text-muted-foreground">Estado operativo del material. Adjuntar un archivo no cambia este estado.</span>
      </label>
    );
  }

  function renderChannelField() {
    if ((options?.entry_channels.length ?? 0) === 0) {
      return null;
    }

    return (
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
    );
  }

  function renderStoreField() {
    if ((options?.stores.length ?? 0) === 0) {
      return null;
    }

    return (
      <label className="grid gap-2 text-sm font-medium text-foreground">
        Tienda
        <DraftSelect
          value={storeId}
          disabled={submitting}
          className="max-w-none text-base"
          onChange={setStoreId}
        >
          <option value="">Sin tienda</option>
          {options?.stores.map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </DraftSelect>
      </label>
    );
  }

  function renderClientField() {
    return (
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
    );
  }

  function renderServiceField() {
    return (
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
    );
  }

  function renderQuickDescriptionField() {
    return (
      <label className="grid gap-2 text-sm font-medium text-foreground">
        Descripción
        <DraftTextarea
          value={description}
          disabled={submitting}
          rows={4}
          className="min-h-28 text-base"
          onChange={setDescription}
        />
      </label>
    );
  }

  function renderFullDescriptionField() {
    return (
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
    );
  }

  function renderDueAtField() {
    return (
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
    );
  }

  function renderAssigneeField() {
    return (
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
    );
  }

  function renderPriorityField() {
    return (
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
    );
  }

  function renderTitleField() {
    return (
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
    );
  }

  function renderContextField() {
    if ((options?.order_contexts.length ?? 0) === 0) {
      return null;
    }

    return (
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
    );
  }

  function renderNotesField() {
    return (
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
    );
  }

  function renderQuickField(field: QuickOrderField) {
    switch (field) {
      case "client":
        return renderClientField();
      case "service":
        return renderServiceField();
      case "description":
        return renderQuickDescriptionField();
      case "store":
        return renderStoreField();
      case "due_at":
        return renderDueAtField();
      case "priority":
        return renderPriorityField();
      case "assigned_team_member":
        return renderAssigneeField();
      case "entry_channel":
        return renderChannelField();
      case "title":
        return renderTitleField();
      case "order_context":
        return renderContextField();
      case "notes":
        return renderNotesField();
      case "file_status":
        return renderFileStatusField();
      case "files":
        return renderFilesField();
    }
  }

  const clientModal = clientModalOpen ? (
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
  ) : null;

  if (created) {
    return (
      <SectionCard
        title={submitting ? "Completando pedido…" : "Pedido creado"}
        description={`${created.reference} ya está registrado.`}
        className="mb-6"
        bodyClassName="px-5 py-5 sm:px-6"
      >
        <div className="mb-5 grid gap-3" aria-live="polite">
          {uploads.length > 0 && (pendingUploads || submitting) ? renderFilesField() : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {pendingUploads && !submitting ? <button type="button" className="gc-cta min-h-11" onClick={() => void retryUploads()}>Reintentar archivos pendientes</button> : null}
          {!submitting && uploads.some((item) => item.phase === "success") ? (
            <OrderFilesSection key={uploads.filter((item) => item.phase === "success").length} orderId={created.id} canMutate={false} archived={false} />
          ) : null}
          {pendingUploads && !submitting ? <p className="text-sm text-muted-foreground">Los archivos pendientes siguen en esta pantalla. Si sales, tendrás que seleccionarlos de nuevo en la ficha.</p> : null}
        </div>
        {!submitting ? <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            href={`/orders/${created.id}`}
            className="gc-cta min-h-11 w-full sm:w-auto"
          >
            Abrir pedido
          </Link>
          <button
            type="button"
            disabled={pendingUploads}
            onClick={() => resetQuickForm(options)}
            className="gc-action min-h-11 w-full sm:w-auto"
          >
            Crear otro
          </button>
          {fromCounter ? (
            <Link
              href="/counter"
              className="gc-action min-h-11 w-full sm:w-auto"
            >
              Volver a Mostrador
            </Link>
          ) : null}
        </div> : null}
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title={isQuick ? "Pedido rápido" : "Nuevo pedido"}
      description={
        isQuick
          ? "Cliente, servicio y lo imprescindible para dejarlo apuntado."
          : "Datos mínimos para registrar el trabajo. El resto se puede completar en la ficha."
      }
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
          {isQuick ? (
            <>
              {quickPrimaryFields.map((field) => (
                <Fragment key={field}>{renderQuickField(field)}</Fragment>
              ))}
              {quickMoreFields.length > 0 ? (
                <details className="rounded-md border border-border/70 bg-secondary/20 px-4 py-3">
                  <summary className="min-h-11 cursor-pointer list-none text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                    Más opciones
                  </summary>
                  <div className="mt-4 grid gap-5">
                    {quickMoreFields.map((field) => (
                      <Fragment key={field}>
                        {renderQuickField(field)}
                      </Fragment>
                    ))}
                  </div>
                </details>
              ) : null}
            </>
          ) : (
            <>
              {renderClientField()}
              {renderStoreField()}
              {renderServiceField()}
              {renderFullDescriptionField()}
              {renderDueAtField()}
              {renderAssigneeField()}
              {renderPriorityField()}
              {renderFileStatusField()}
              {renderFilesField()}
              {showChannelInMain ? renderChannelField() : null}
              <details className="rounded-md border border-border/70 bg-secondary/20 px-4 py-3">
                <summary className="min-h-11 cursor-pointer list-none text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">
                  Más opciones
                </summary>
                <div className="mt-4 grid gap-5">
                  {renderTitleField()}
                  {renderContextField()}
                  {renderNotesField()}
                </div>
              </details>
            </>
          )}

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

      {clientModal}
    </SectionCard>
  );
}
