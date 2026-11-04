import { SectionCard } from "@/components/gestcopy/section-card";
import { OrderCollection } from "@/components/orders/detail/order-collection";
import {
  DraftSelect,
  FactRow,
  FactValue,
} from "@/components/orders/detail/order-field";
import {
  formatCustomerNotificationStatus,
  formatDate,
} from "@/lib/orders/format";
import type { OrderCollection as OrderCollectionData } from "@/lib/orders/collection";
import {
  formatInvoiceFlag,
  invoiceFromSelectValue,
  invoiceSelectValue,
} from "@/lib/orders/invoice";
import type { OrderLabels } from "@/lib/orders/labels";
import type {
  ManagementOptionsResponse,
  Order,
  OrderDraft,
} from "@/lib/orders/types";

export function OrderFulfillment({
  order,
  draft,
  editing,
  managementOptions,
  managementOptionsLoading,
  canWrite,
  onCollectionChanged,
  onDraftChange,
  labels,
  onCollectionLoaded,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  managementOptions: ManagementOptionsResponse | null;
  managementOptionsLoading: boolean;
  canWrite: boolean;
  onCollectionChanged: () => void;
  onDraftChange: (patch: Partial<OrderDraft>) => void;
  labels?: OrderLabels;
  onCollectionLoaded?: (collection: OrderCollectionData) => void;
}) {
  if (editing && draft) {
    return (
      <SectionCard title="Cobro y entrega" bodyClassName="px-5 py-2 sm:px-6">
        <FactRow label="Pago">
          <DraftSelect
            value={draft.payment_status_id ?? ""}
            disabled={managementOptionsLoading}
            onChange={(value) =>
              onDraftChange({ payment_status_id: value || null })
            }
          >
            <option value="">— Sin definir —</option>
            {managementOptions?.payment_statuses.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </DraftSelect>
        </FactRow>
        <FactRow label="Método de entrega">
          <DraftSelect
            value={draft.delivery_method_id ?? ""}
            disabled={managementOptionsLoading}
            onChange={(value) =>
              onDraftChange({ delivery_method_id: value || null })
            }
          >
            <option value="">— Sin definir —</option>
            {managementOptions?.delivery_methods.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </DraftSelect>
        </FactRow>
        <FactRow label="Aviso al cliente">
          <DraftSelect
            value={draft.customer_notification_status}
            onChange={(value) =>
              onDraftChange({ customer_notification_status: value })
            }
          >
            <option value="not_notified">No avisado</option>
            <option value="notified">Avisado</option>
            <option value="notified_no_pickup">Avisado pero no viene</option>
          </DraftSelect>
        </FactRow>
        <FactRow label="Requiere factura">
          <DraftSelect
            value={invoiceSelectValue(draft.invoice_required)}
            onChange={(value) => {
              const required = invoiceFromSelectValue(value);
              // Sí → No / Sin indicar: delivery no longer applies.
              onDraftChange({
                invoice_required: required,
                invoice_delivered: required === true ? draft.invoice_delivered : null,
              });
            }}
          >
            <option value="">— Sin indicar —</option>
            <option value="yes">Sí</option>
            <option value="no">No</option>
          </DraftSelect>
        </FactRow>
        {draft.invoice_required === true ? (
          <FactRow label="Factura entregada">
            <DraftSelect
              value={invoiceSelectValue(draft.invoice_delivered)}
              onChange={(value) =>
                onDraftChange({ invoice_delivered: invoiceFromSelectValue(value) })
              }
            >
              <option value="">— Sin indicar —</option>
              <option value="yes">Sí</option>
              <option value="no">No</option>
            </DraftSelect>
          </FactRow>
        ) : null}
        <FactRow label="Fecha prevista" emphasis>
          <FactValue value={formatDate(draft.due_at)} />
        </FactRow>
        <FactRow label="Terminado">
          <FactValue value={formatDate(order.ready_at)} />
        </FactRow>
        <FactRow label="Entregado">
          <FactValue value={formatDate(order.delivered_at)} />
        </FactRow>
        <OrderCollection
          key={order.id}
          orderId={order.id}
          canWrite={canWrite}
          archived={Boolean(order.archived_at)}
          editing
          onChanged={onCollectionChanged}
          labels={labels}
          onCollectionLoaded={onCollectionLoaded}
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Cobro y entrega" bodyClassName="px-5 py-2 sm:px-6">
      <FactRow label="Pago">
        <FactValue value={order.payment_status?.name} />
      </FactRow>
      <FactRow label="Método de entrega">
        <FactValue value={order.delivery_method?.name} />
      </FactRow>
      <FactRow label="Aviso al cliente">
        <FactValue
          value={formatCustomerNotificationStatus(
            order.customer_notification_status
          )}
        />
      </FactRow>
      <FactRow label="Requiere factura">
        <FactValue value={formatInvoiceFlag(order.invoice_required)} />
      </FactRow>
      {order.invoice_required === true ? (
        <FactRow label="Factura entregada">
          <FactValue value={formatInvoiceFlag(order.invoice_delivered)} />
        </FactRow>
      ) : null}
      <FactRow label="Terminado">
        <FactValue value={formatDate(order.ready_at)} />
      </FactRow>
      <FactRow label="Entregado">
        <FactValue value={formatDate(order.delivered_at)} />
      </FactRow>
      <OrderCollection
        key={order.id}
        orderId={order.id}
        canWrite={canWrite}
        archived={Boolean(order.archived_at)}
        editing={false}
        onChanged={onCollectionChanged}
        labels={labels}
        onCollectionLoaded={onCollectionLoaded}
      />
    </SectionCard>
  );
}
