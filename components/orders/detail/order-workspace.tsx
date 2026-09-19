"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import { ClientSelector } from "@/components/clients/client-selector";
import { AppShell } from "@/components/gestcopy/app-shell";
import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { ErrorState } from "@/components/gestcopy/error-state";
import { LoadingState } from "@/components/gestcopy/loading-state";
import { OrderFilesSection } from "@/components/files/order-files-section";
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
import {
  applyReturnedVersion,
  staleSaveMessage,
} from "@/lib/orders/concurrency";
import {
  archiveOrderPath,
  canMutateOrderActions,
  isArchivedApiError,
  isStaleApiError,
  lifecycleUxErrorMessage,
  mergeArchivedOrderResult,
  OrderArchivedError,
  OrderStaleError,
  ORDER_ARCHIVED_CODE,
  parseLifecycleApiError,
  planStatusSave,
  type ConfirmCopy,
} from "@/lib/orders/lifecycle-ux";
import { appendOrderNote } from "@/lib/orders/notes";
import { isOrderArchived } from "@/lib/orders/operational";
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
import { isAbortError, nextLoadSignal } from "@/lib/refresh/abort";
import { fetchLive, type SilentLoadOptions } from "@/lib/refresh/fetch-live";
import { shouldApplyLiveOrderSnapshot } from "@/lib/refresh/order-snapshot";
import { useLiveRefresh } from "@/lib/refresh/use-live-refresh";

function normalizeLoadedOrder(order: Order): Order {
  return {
    ...order,
    archived_at: order.archived_at ?? null,
    client:
      order.client_id && order.client?.id ? order.client : null,
  };
}

function mapOrderStatusPayload(
  status: unknown,
  fallback: Order["status"]
): Order["status"] {
  if (!status || typeof status !== "object") {
    return fallback;
  }
  const record = status as Record<string, unknown>;
  const name = typeof record.name === "string" ? record.name : fallback?.name;
  const code = typeof record.code === "string" ? record.code : fallback?.code;
  if (!name || !code) {
    return fallback;
  }
  return {
    name,
    code,
    is_initial: record.is_initial === true,
    is_ready: record.is_ready === true,
    is_closed: record.is_closed === true,
    is_cancelled: record.is_cancelled === true,
  };
}

export function OrderWorkspace() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [showCreated] = useState(
    () => searchParams.get("created") === "1"
  );
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<OrderStatus[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityTick, setActivityTick] = useState(0);
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
  const [quickSaving, setQuickSaving] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [clientSavedDuringEdit, setClientSavedDuringEdit] = useState(false);

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
  const [draftTerminalConfirm, setDraftTerminalConfirm] =
    useState<ConfirmCopy | null>(null);
  const draftTerminalConfirmedRef = useRef(false);
  const orderAbortRef = useRef<AbortController | null>(null);
  const activityAbortRef = useRef<AbortController | null>(null);
  const orderRef = useRef<Order | null>(null);
  const editingRef = useRef(false);
  const savingRef = useRef(false);
  const quickSavingRef = useRef(false);

  useLayoutEffect(() => {
    orderRef.current = order;
    editingRef.current = editing;
    savingRef.current = saving;
    quickSavingRef.current = quickSaving;
  });

  const loadActivity = useCallback(
    async (opts?: SilentLoadOptions) => {
      const silent = opts?.silent === true;
      const { controller, signal } = nextLoadSignal(
        activityAbortRef.current,
        opts?.signal
      );
      activityAbortRef.current = controller;

      try {
        const response = await fetchLive(`/api/orders/${params.id}/activity`, {
          signal,
        });

        if (!response.ok) {
          if (!silent) {
            setActivity([]);
            setActivityLoading(false);
          }
          return;
        }

        const result: ActivityResponse = await response.json();
        setActivity(result.activity ?? []);
        setActivityLoading(false);
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        if (!silent) {
          setActivity([]);
          setActivityLoading(false);
        }
      }
    },
    [params.id]
  );

  const loadOrder = useCallback(
    async (opts?: SilentLoadOptions) => {
      const silent = opts?.silent === true;
      const { controller, signal } = nextLoadSignal(
        orderAbortRef.current,
        opts?.signal
      );
      orderAbortRef.current = controller;

      try {
        const response = await fetchLive(`/api/orders/${params.id}`, {
          signal,
        });
        const result: OrderResponse = await response.json();

        if (!response.ok) {
          throw new Error("No se pudo cargar el pedido");
        }

        if (!result.order) {
          throw new Error("Pedido no encontrado");
        }

        if (
          silent &&
          !shouldApplyLiveOrderSnapshot({
            editing: editingRef.current,
            saving: savingRef.current,
            quickSaving: quickSavingRef.current,
          })
        ) {
          return;
        }

        setOrder(normalizeLoadedOrder(result.order));
        setError(null);
        setLoading(false);
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        if (silent && orderRef.current) {
          return;
        }
        setOrder(null);
        setError(
          err instanceof Error ? err.message : "Error al cargar el pedido"
        );
        setLoading(false);
      }
    },
    [params.id]
  );

  useEffect(() => {
    async function loadContext() {
      const response = await fetch("/api/context");
      if (response.ok) {
        const context = await response.json();
        setCanWrite(canWriteOrders(context?.membership?.role));
      }
    }

    void loadOrder();
    void loadContext();
    return () => {
      orderAbortRef.current?.abort();
    };
  }, [loadOrder, reloadToken]);

  useLiveRefresh({
    onRefresh: async (signal) => {
      await Promise.all([
        loadOrder({ silent: true, signal }),
        loadActivity({ silent: true, signal }),
      ]);
    },
  });

  useEffect(() => {
    if (!showCreated) return;
    router.replace(`/orders/${params.id}`);
  }, [showCreated, params.id, router]);

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
          stores: result.stores ?? [],
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
      const { controller, signal } = nextLoadSignal(activityAbortRef.current);
      activityAbortRef.current = controller;

      try {
        const response = await fetchLive(`/api/orders/${params.id}/activity`, {
          signal,
        });

        if (!response.ok) {
          setActivity([]);
          return;
        }

        const result: ActivityResponse = await response.json();
        setActivity(result.activity ?? []);
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        setActivity([]);
      } finally {
        setActivityLoading(false);
      }
    }

    void loadOrderActivity();
    return () => {
      activityAbortRef.current?.abort();
    };
  }, [params.id, activityTick]);

  function patchDraft(patch: Partial<OrderDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function startEditing() {
    if (!order || !canMutateOrderActions({ canWrite, archived_at: order.archived_at })) {
      return;
    }
    setSaveMessage(null);
    setError(null);
    setClientSavedDuringEdit(false);
    setDraft(createOrderDraft(order, statuses));
    setEditing(true);
  }

  function cancelEditing() {
    if (saving) return;
    setDraft(null);
    setEditing(false);
    setClientSavedDuringEdit(false);
    setSaveMessage(null);
    setError(null);
    setConfirmRemoveClient(false);
    setClientUiMode(null);
    draftTerminalConfirmedRef.current = false;
    setDraftTerminalConfirm(null);
  }

  /**
   * Single mutating request of a save step.
   * Turns the archived-order conflict into OrderArchivedError so callers can
   * stop mutating instead of pushing the remaining steps at the server.
   */
  async function requestSaveStep(
    path: string,
    body: unknown,
    fallbackMessage: string
  ) {
    const response = await fetch(path, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    if (!response.ok) {
      if (isArchivedApiError(result)) {
        throw new OrderArchivedError();
      }
      if (isStaleApiError(result)) {
        throw new OrderStaleError();
      }

      throw new Error(
        parseLifecycleApiError(result, result.error ?? fallbackMessage)
      );
    }

    return result;
  }

  async function applySaveStep(
    current: Order,
    step: DraftSaveStep
  ): Promise<Order> {
    if (step.kind === "status") {
      const result = await requestSaveStep(
        `/api/orders/${current.id}`,
        { status_id: step.status_id, expected_version: current.version },
        "No se pudo actualizar el estado"
      );
      const nextOrder =
        result.order && typeof result.order === "object"
          ? (result.order as Partial<Order>)
          : null;
      return applyReturnedVersion(
        {
          ...current,
          status_id: step.status_id,
          status: mapOrderStatusPayload(result.status, current.status),
          ready_at: nextOrder?.ready_at ?? current.ready_at,
          delivered_at: nextOrder?.delivered_at ?? current.delivered_at,
          archived_at: nextOrder?.archived_at ?? current.archived_at,
        },
        result
      );
    }

    if (step.kind === "content") {
      const result = await requestSaveStep(
        `/api/orders/${current.id}/content`,
        { field: step.field, value: step.value, expected_version: current.version },
        "No se pudo actualizar el contenido del pedido"
      );
      if (step.field === "title") {
        return applyReturnedVersion({ ...current, title: result.order.title }, result);
      }
      if (step.field === "description") {
        return applyReturnedVersion(
          { ...current, description: result.order.description },
          result
        );
      }
      return applyReturnedVersion({ ...current, notes: result.order.notes }, result);
    }

    if (step.kind === "detail") {
      const result = await requestSaveStep(
        `/api/orders/${current.id}/details`,
        { field: step.field, value: step.value, expected_version: current.version },
        "No se pudieron actualizar los datos del pedido"
      );
      const nextValue = result.value ?? null;
      if (step.field === "priority") {
        return applyReturnedVersion(
          { ...current, priority: result.order.priority },
          result
        );
      }
      if (step.field === "service_id") {
        return applyReturnedVersion(
          {
            ...current,
            service_id: result.order.service_id,
            service: nextValue,
          },
          result
        );
      }
      if (step.field === "entry_channel_id") {
        return applyReturnedVersion(
          {
            ...current,
            entry_channel_id: result.order.entry_channel_id,
            entry_channel: nextValue,
          },
          result
        );
      }
      if (step.field === "assigned_team_member_id") {
        return applyReturnedVersion(
          {
            ...current,
            assigned_team_member_id: result.order.assigned_team_member_id,
            assigned_team_member: nextValue,
          },
          result
        );
      }
      if (step.field === "order_context_id") {
        return applyReturnedVersion(
          {
            ...current,
            order_context_id: result.order.order_context_id,
            order_context: nextValue,
          },
          result
        );
      }
      if (step.field === "store_id") {
        return applyReturnedVersion(
          {
            ...current,
            store_id: result.order.store_id,
            store: nextValue,
          },
          result
        );
      }
      return applyReturnedVersion({ ...current, due_at: result.order.due_at }, result);
    }

    if (step.kind === "management") {
      const result = await requestSaveStep(
        `/api/orders/${current.id}/management`,
        {
          field: step.field,
          value_id: step.value_id,
          expected_version: current.version,
        },
        "No se pudo actualizar la gestión del pedido"
      );
      const nextValue = result.value ?? null;
      if (step.field === "file_status_id") {
        return applyReturnedVersion(
          {
            ...current,
            file_status_id: result.order.file_status_id,
            file_status: nextValue,
          },
          result
        );
      }
      if (step.field === "quote_status_id") {
        return applyReturnedVersion(
          {
            ...current,
            quote_status_id: result.order.quote_status_id,
            quote_status: nextValue,
          },
          result
        );
      }
      if (step.field === "payment_status_id") {
        return applyReturnedVersion(
          {
            ...current,
            payment_status_id: result.order.payment_status_id,
            payment_status: nextValue,
          },
          result
        );
      }
      return applyReturnedVersion(
        {
          ...current,
          delivery_method_id: result.order.delivery_method_id,
          delivery_method: nextValue,
        },
        result
      );
    }

    const result = await requestSaveStep(
      `/api/orders/${current.id}/notification`,
      {
        notification_status: step.notification_status,
        expected_version: current.version,
      },
      "No se pudo actualizar el aviso al cliente"
    );
    return applyReturnedVersion(
      {
        ...current,
        customer_notification_status: result.order.customer_notification_status,
      },
      result
    );
  }

  /**
   * Another writer changed the order while we were mutating it.
   * Keep the draft and editing session, refresh the server snapshot,
   * and do not retry or merge automatically.
   */
  async function recoverFromStale(succeededCount: number) {
    setSaveMessage(null);
    setDraftTerminalConfirm(null);
    await Promise.all([loadOrder(), loadActivity()]);
    setError(staleSaveMessage(succeededCount));
  }

  /**
   * The order was archived by someone else while we were mutating it.
   * Drop the draft, resync the ficha from the server and let the normal
   * archived rendering take over. No browser reload.
   */
  async function recoverFromArchivedRace() {
    setEditing(false);
    setDraft(null);
    setClientSavedDuringEdit(false);
    setClientUiMode(null);
    setConfirmRemoveClient(false);
    setDraftTerminalConfirm(null);
    draftTerminalConfirmedRef.current = false;
    setSaveMessage(null);
    setError(lifecycleUxErrorMessage(ORDER_ARCHIVED_CODE));

    await Promise.all([loadOrder(), loadActivity()]);
  }

  async function saveEditing() {
    if (!order || !draft || saving) return;

    // Revalidate before mutating: the ficha may have been archived since the
    // draft was opened (live refresh is suppressed while editing).
    if (!canMutateOrderActions({ canWrite, archived_at: order.archived_at })) {
      await recoverFromArchivedRace();
      return;
    }

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
      draftTerminalConfirmedRef.current = false;
      setDraftTerminalConfirm(null);
      return;
    }

    const statusStep = steps.find((step) => step.kind === "status");
    if (statusStep && statusStep.kind === "status") {
      const nextStatus =
        statuses.find((item) => item.id === statusStep.status_id) ?? null;
      const plan = planStatusSave({
        currentStatusId: resolveOrderStatusId(order, statuses),
        nextStatusId: statusStep.status_id,
        nextStatus,
        terminalConfirmed: draftTerminalConfirmedRef.current,
      });
      if (plan.type === "require_terminal_confirm") {
        setDraftTerminalConfirm(plan.copy);
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSaveMessage(null);
    setDraftTerminalConfirm(null);

    let working = order;
    const succeeded: string[] = [];
    const failed: string[] = [];

    let archivedRace = false;
    let staleRace = false;

    for (const step of steps) {
      try {
        working = await applySaveStep(working, step);
        setOrder(working);
        succeeded.push(step.label);
      } catch (err) {
        if (err instanceof OrderArchivedError) {
          // Lost the race: stop here instead of pushing the remaining steps.
          archivedRace = true;
          break;
        }
        if (err instanceof OrderStaleError) {
          staleRace = true;
          break;
        }
        failed.push(
          `${step.label}: ${
            err instanceof Error ? err.message : "Error al guardar"
          }`
        );
      }
    }

    if (archivedRace) {
      setSaving(false);
      await recoverFromArchivedRace();
      return;
    }

    if (staleRace) {
      setSaving(false);
      await recoverFromStale(succeeded.length);
      return;
    }

    await loadActivity();
    setSaving(false);
    draftTerminalConfirmedRef.current = false;

    if (failed.length === 0) {
      setEditing(false);
      setDraft(null);
      setClientSavedDuringEdit(false);
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

  async function confirmDraftTerminalSave() {
    draftTerminalConfirmedRef.current = true;
    setDraftTerminalConfirm(null);
    await saveEditing();
  }

  async function runQuickSave(
    label: string,
    step: DraftSaveStep
  ): Promise<void> {
    if (!order || quickSaving) return;

    // Revalidate before mutating, same rule as the draft path.
    if (!canMutateOrderActions({ canWrite, archived_at: order.archived_at })) {
      await recoverFromArchivedRace();
      return;
    }

    setQuickSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const next = await applySaveStep(order, step);
      setOrder(next);
      await loadActivity();
      setSaveMessage(label);
    } catch (err) {
      if (err instanceof OrderArchivedError) {
        setQuickSaving(false);
        await recoverFromArchivedRace();
        return;
      }
      if (err instanceof OrderStaleError) {
        setQuickSaving(false);
        await recoverFromStale(0);
        return;
      }
      setError(
        err instanceof Error ? err.message : "No se pudo guardar el cambio"
      );
      throw err;
    } finally {
      setQuickSaving(false);
    }
  }

  async function saveQuickStatus(statusId: string) {
    await runQuickSave("Estado actualizado", {
      kind: "status",
      status_id: statusId,
      label: "Estado",
    });
  }

  async function saveQuickAssignee(memberId: string | null) {
    await runQuickSave("Responsable actualizado", {
      kind: "detail",
      field: "assigned_team_member_id",
      value: memberId,
      label: "Responsable",
    });
  }

  async function saveQuickNote(note: string) {
    if (!order) return;

    const nextNotes = appendOrderNote(order.notes, note);
    await runQuickSave("Nota añadida", {
      kind: "content",
      field: "notes",
      value: nextNotes,
      label: "Notas",
    });
  }

  async function archiveOrder() {
    if (!order || quickSaving) return;

    setQuickSaving(true);
    setError(null);
    setSaveMessage(null);

    try {
      const response = await fetch(archiveOrderPath(order.id), {
        method: "PATCH",
      });
      const result = await response.json();
      if (!response.ok) {
        if (isArchivedApiError(result)) {
          setQuickSaving(false);
          await recoverFromArchivedRace();
          return;
        }
        throw new Error(
          parseLifecycleApiError(
            result,
            result.error ?? "No se pudo archivar el pedido"
          )
        );
      }

      setOrder((current) => {
        if (!current) {
          return current;
        }
        return normalizeLoadedOrder(
          mergeArchivedOrderResult(current, result.order)
        );
      });
      setEditing(false);
      setDraft(null);
      await loadActivity();
      setSaveMessage(
        result.replay === true ? "Pedido ya archivado" : "Pedido archivado"
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo archivar el pedido"
      );
      throw err;
    } finally {
      setQuickSaving(false);
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
    client: ClientSummary | null,
    result?: unknown
  ) {
    setOrder((current) => {
      if (!current) return current;
      const next = {
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
      return result ? applyReturnedVersion(next, result) : next;
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
        body: JSON.stringify({
          client_id: clientId,
          expected_version: order.version,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        if (isArchivedApiError(result)) {
          setSavingClient(false);
          await recoverFromArchivedRace();
          return;
        }
        if (isStaleApiError(result)) {
          setSavingClient(false);
          await recoverFromStale(0);
          return;
        }
        throw new Error(result.error ?? "No se pudo asignar el cliente");
      }
      applyClientToOrder(
        result.order?.client_id ?? clientId,
        mapClientSummary(result.client) ?? selected ?? null,
        result
      );
      if (editing) {
        setClientSavedDuringEdit(true);
      }
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
        if (editing) {
          setClientSavedDuringEdit(true);
        }
        setClientUiMode(null);
        await loadActivity();
        return;
      }

      const response = await fetch(`/api/orders/${order.id}/client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toClientPayload(form),
          expected_version: order.version,
        }),
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
        if (isArchivedApiError(result)) {
          setSavingClient(false);
          await recoverFromArchivedRace();
          return;
        }
        if (isStaleApiError(result)) {
          setSavingClient(false);
          await recoverFromStale(0);
          return;
        }
        throw new Error(result.error ?? "No se pudo crear el cliente");
      }

      applyClientToOrder(
        result.order?.client_id ?? null,
        mapClientSummary(result.client),
        result
      );
      if (editing) {
        setClientSavedDuringEdit(true);
      }
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

  if (loading && !order) {
    return (
      <AppShell>
        <AppNav />
        <LoadingState label="Cargando pedido…" />
      </AppShell>
    );
  }

  if (!order) {
    return (
      <AppShell>
        <AppNav />
        <ErrorState
          title={error ?? "Pedido no encontrado"}
          onRetry={() => {
            setError(null);
            setLoading(true);
            setReloadToken((current) => current + 1);
          }}
        />
      </AppShell>
    );
  }

  const currentClient =
    order.client_id && order.client?.id ? order.client : null;

  const clientActions = (
    <div className="flex w-full flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Los cambios de cliente se guardan al confirmar; no forman parte del
        borrador del pedido.
      </p>
      <div className="flex flex-wrap gap-2">
        {currentClient ? (
          <>
            <button
              type="button"
              onClick={openEditClient}
              className="gc-action min-h-11"
            >
              Editar cliente
            </button>
            <button
              type="button"
              onClick={openChangeClient}
              className="gc-action min-h-11"
            >
              Cambiar cliente
            </button>
            {confirmRemoveClient ? (
              <>
                <span className="self-center text-sm text-muted-foreground">
                  ¿Quitar el cliente de este pedido? Se guarda al confirmar.
                </span>
                <button
                  type="button"
                  disabled={savingClient}
                  onClick={() => void assignExistingClient(null)}
                  className="gc-action-danger min-h-11 disabled:opacity-50"
                >
                  Sí, quitar
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmRemoveClient(false)}
                  className="gc-action min-h-11"
                >
                  No quitar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmRemoveClient(true)}
                className="gc-action min-h-11"
              >
                Quitar cliente
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={openAssignClient}
            className="gc-action min-h-11"
          >
            Asignar cliente
          </button>
        )}
      </div>
    </div>
  );

  return (
    <AppShell innerClassName="max-w-5xl">
      <AppNav />

        {!canWrite ? (
          <p className="mb-4 text-sm text-muted-foreground">Solo lectura</p>
        ) : order && isOrderArchived(order) ? (
          <p className="mb-4 text-sm text-muted-foreground">
            Pedido archivado · solo consulta
          </p>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {showCreated || saveMessage ? (
          <div className="mb-4 rounded-[var(--radius)] border border-border bg-secondary/40 px-4 py-3 text-sm text-foreground">
            {saveMessage ?? "Pedido creado. Ya puedes completar el resto en la ficha."}
          </div>
        ) : null}

        <OrderHeader
          order={order}
          draft={draft}
          editing={editing}
          canWrite={canWrite}
          saving={saving}
          quickSaving={quickSaving}
          clientSavedDuringEdit={clientSavedDuringEdit}
          statuses={statuses}
          orderOptions={orderOptions}
          orderOptionsLoading={orderOptionsLoading}
          onEdit={startEditing}
          onCancel={cancelEditing}
          onSave={() => void saveEditing()}
          onQuickStatus={saveQuickStatus}
          onQuickAssignee={saveQuickAssignee}
          onQuickNote={saveQuickNote}
          onArchive={archiveOrder}
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
          <OrderFilesSection
            orderId={order.id}
            canMutate={canMutateOrderActions({
              canWrite,
              archived_at: order.archived_at,
            })}
            archived={isOrderArchived(order)}
            onChanged={() => setActivityTick((tick) => tick + 1)}
          />
        </div>

        <div className="mt-6">
          <OrderActivity activity={activity} loading={activityLoading} />
        </div>

      {draftTerminalConfirm ? (
        <ConfirmDialog
          title={draftTerminalConfirm.title}
          description={draftTerminalConfirm.description}
          confirmLabel={draftTerminalConfirm.confirmLabel}
          destructive={
            draftTerminalConfirm.confirmLabel === "Confirmar cancelación"
          }
          busy={saving}
          onCancel={() => {
            if (saving) return;
            draftTerminalConfirmedRef.current = false;
            setDraftTerminalConfirm(null);
          }}
          onConfirm={() => void confirmDraftTerminalSave()}
        />
      ) : null}

      {canWrite && editing && (clientUiMode === "assign" || clientUiMode === "change") && (
        <ClientModal>
          <h2 className="mb-4 text-lg font-semibold">
            {clientUiMode === "change" ? "Cambiar cliente" : "Asignar cliente"}
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Al confirmar, el cliente se guarda de inmediato. No forma parte del
            borrador del pedido.
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
            <p className="mb-3 text-sm text-muted-foreground">
              Al confirmar, el cliente se guarda de inmediato. No forma parte del
              borrador del pedido.
            </p>
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
    </AppShell>
  );
}
