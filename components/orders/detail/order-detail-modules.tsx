"use client";

import type { ReactNode } from "react";

import { ClientForm } from "@/components/clients/client-form";
import { ClientModal } from "@/components/clients/client-modal";
import { ClientSelector } from "@/components/clients/client-selector";
import { ConfirmDialog } from "@/components/gestcopy/confirm-dialog";
import { OrderFilesSection } from "@/components/files/order-files-section";
import { OrderActivity } from "@/components/orders/detail/order-activity";
import { OrderFulfillment } from "@/components/orders/detail/order-fulfillment";
import { OrderHeader } from "@/components/orders/detail/order-header";
import { OrderNotes } from "@/components/orders/detail/order-notes";
import { OrderProduction } from "@/components/orders/detail/order-production";
import { OrderSourceQuote } from "@/components/orders/detail/order-source-quote";
import { OrderSummary } from "@/components/orders/detail/order-summary";
import type { OrderWorkspaceController } from "@/components/orders/detail/use-order-workspace";
import type {
  OrderDetailFacts,
  OrderDetailModules,
} from "@/components/orders/detail/views/contract";
import {
  OrderPinnedNotesStrip,
  OrderStickyNotesPanel,
} from "@/components/orders/notes";
import { OrderWorkSequence } from "@/components/orders/work-sequence";
import { orderLabels } from "@/lib/orders/labels";
import { canMutateOrderActions } from "@/lib/orders/lifecycle-ux";
import { isOrderArchived } from "@/lib/orders/operational";
import type { Order } from "@/lib/orders/types";

// Order Detail Views V1 (F1): builds every module of the order page once,
// with the same props OrderWorkspace used before. Layouts only place them.

export function buildOrderDetailModules(
  ctl: OrderWorkspaceController,
  order: Order
): { modules: OrderDetailModules; facts: OrderDetailFacts; dialogs: ReactNode } {
  const {
    features,
    canWrite,
    error,
    showCreated,
    saveMessage,
    draft,
    editing,
    saving,
    quickSaving,
    clientSavedDuringEdit,
    statuses,
    orderOptions,
    orderOptionsLoading,
    managementOptions,
    managementOptionsLoading,
    sourceQuote,
    sourceQuoteRestricted,
    dueAtInvalid,
    editSession,
    collection,
    activity,
    activityLoading,
    noteComposeRequest,
    savingClient,
    confirmRemoveClient,
    clientUiMode,
    clientActionError,
    clientDuplicate,
    clientFormInitial,
    draftTerminalConfirm,
  } = ctl;

  // SUR4 (contract §5): SUR4's names only with order_custom_labels.
  const labels = orderLabels({ custom: features.customLabels });

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
              onClick={ctl.openEditClient}
              className="gc-action min-h-11"
            >
              Editar cliente
            </button>
            <button
              type="button"
              onClick={ctl.openChangeClient}
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
                  onClick={() => void ctl.assignExistingClient(null)}
                  className="gc-action-danger min-h-11 disabled:opacity-50"
                >
                  Sí, quitar
                </button>
                <button
                  type="button"
                  onClick={() => ctl.setConfirmRemoveClient(false)}
                  className="gc-action min-h-11"
                >
                  No quitar
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => ctl.setConfirmRemoveClient(true)}
                className="gc-action min-h-11"
              >
                Quitar cliente
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={ctl.openAssignClient}
            className="gc-action min-h-11"
          >
            Asignar cliente
          </button>
        )}
      </div>
    </div>
  );

  const notices = (
    <>
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
    </>
  );

  const headerProps = {
    order,
    draft,
    editing,
    canWrite,
    saving,
    quickSaving,
    clientSavedDuringEdit,
    statuses,
    orderOptions,
    orderOptionsLoading,
    onEdit: ctl.startEditing,
    onCancel: ctl.cancelEditing,
    onSave: () => void ctl.saveEditing(),
    saveBlocked: dueAtInvalid,
    onQuickStatus: ctl.saveQuickStatus,
    onQuickAssignee: ctl.saveQuickAssignee,
    onQuickNote: ctl.saveQuickNote,
    onArchive: ctl.archiveOrder,
    labels,
    collection,
    onNoteRequest: features.stickyNotes
      ? () => ctl.setNoteComposeRequest((request) => request + 1)
      : undefined,
  };

  const modules: OrderDetailModules = {
    notices,
    header: <OrderHeader {...headerProps} />,
    headerCompact: <OrderHeader {...headerProps} density="compact" />,

    // SUR4 E6: pinned post-its, only with order_sticky_notes.
    pinnedNotes: features.stickyNotes ? <OrderPinnedNotesStrip /> : null,

    // SUR4 E8: work sequence, only with order_work_sequence.
    sequence: features.workSequence ? (
      <OrderWorkSequence
        orderId={order.id}
        orderVersion={order.version}
        canWrite={canWrite}
        archived={isOrderArchived(order)}
        assignableMembers={orderOptions?.team_members}
        onOrderVersionChange={(version) => {
          ctl.setOrder((current) => (current ? { ...current, version } : current));
          ctl.setActivityTick((tick) => tick + 1);
        }}
        onOrderConflict={() => void ctl.loadOrder({ silent: true })}
      />
    ) : null,

    // Visual tracking (PR #153) plugs in here once it is integrated.
    tracking: null,

    sourceQuote: sourceQuote ? <OrderSourceQuote quote={sourceQuote} /> : null,

    production: (
      <OrderProduction
        key={editSession}
        order={order}
        draft={draft}
        editing={editing}
        statuses={statuses}
        orderOptions={orderOptions}
        orderOptionsLoading={orderOptionsLoading}
        managementOptions={managementOptions}
        managementOptionsLoading={managementOptionsLoading}
        sourceQuote={sourceQuote}
        sourceQuoteRestricted={sourceQuoteRestricted}
        onDraftChange={ctl.patchDraft}
        onDueAtInvalid={ctl.handleDueAtInvalid}
        labels={labels}
        stickyNotes={features.stickyNotes}
      />
    ),

    files: (
      <OrderFilesSection
        key={order.id}
        orderId={order.id}
        canMutate={canMutateOrderActions({
          canWrite,
          archived_at: order.archived_at,
        })}
        archived={isOrderArchived(order)}
        onChanged={() => ctl.setActivityTick((tick) => tick + 1)}
      />
    ),

    stickyNotes: features.stickyNotes ? (
      <OrderStickyNotesPanel
        archived={isOrderArchived(order)}
        composeRequest={noteComposeRequest}
      />
    ) : null,

    legacyNotes: (
      <OrderNotes
        order={order}
        draft={draft}
        editing={editing}
        onDraftChange={ctl.patchDraft}
        stickyNotes={features.stickyNotes}
        canWrite={canWrite}
        archived={isOrderArchived(order)}
        onLegacyNotesConverted={({ version }) => {
          ctl.setOrder((current) =>
            current ? { ...current, version, notes: null } : current
          );
          ctl.setDraft((current) =>
            current ? { ...current, notes: "" } : current
          );
          ctl.setActivityTick((tick) => tick + 1);
        }}
      />
    ),

    activity: <OrderActivity activity={activity} loading={activityLoading} />,

    summary: (
      <OrderSummary
        order={order}
        draft={draft}
        editing={editing}
        orderOptions={orderOptions}
        orderOptionsLoading={orderOptionsLoading}
        onDraftChange={ctl.patchDraft}
        clientActions={clientActions}
      />
    ),

    fulfillment: (
      <OrderFulfillment
        order={order}
        draft={draft}
        editing={editing}
        managementOptions={managementOptions}
        managementOptionsLoading={managementOptionsLoading}
        canWrite={canWrite}
        onCollectionChanged={() => {
          ctl.setActivityTick((current) => current + 1);
          ctl.setReloadToken((current) => current + 1);
        }}
        onDraftChange={ctl.patchDraft}
        labels={labels}
        onCollectionLoaded={ctl.setCollection}
      />
    ),
  };

  const facts: OrderDetailFacts = {
    order,
    labels,
    features,
    collection,
    statuses,
    canMutate: canMutateOrderActions({
      canWrite,
      archived_at: order.archived_at,
    }),
    archived: isOrderArchived(order),
    editing,
  };

  const dialogs = (
    <>
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
            ctl.draftTerminalConfirmedRef.current = false;
            ctl.setDraftTerminalConfirm(null);
          }}
          onConfirm={() => void ctl.confirmDraftTerminalSave()}
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
                void ctl.assignExistingClient(client.id, client);
              }
            }}
            onCreateNew={ctl.openCreateClient}
          />
          {clientActionError ? (
            <p className="mt-3 text-sm text-destructive">{clientActionError}</p>
          ) : null}
          <div className="mt-4">
            <button
              type="button"
              disabled={savingClient}
              onClick={ctl.closeClientUi}
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
                  ctl.setClientActionError(null);
                  ctl.setClientDuplicate(null);
                  ctl.setClientUiMode(currentClient ? "change" : "assign");
                  return;
                }
                ctl.closeClientUi();
              }}
              onSubmit={ctl.saveClientForm}
              onUseDuplicate={
                clientUiMode === "create"
                  ? (clientId) => {
                      void ctl.assignExistingClient(clientId);
                    }
                  : undefined
              }
            />
          </ClientModal>
        )}
    </>
  );

  return { modules, facts, dialogs };
}
