import { SectionCard } from "@/components/gestcopy/section-card";
import {
  DraftSelect,
  FactRow,
  FactValue,
} from "@/components/orders/detail/order-field";
import {
  formatCustomerNotificationStatus,
  formatDate,
} from "@/lib/orders/format";
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
  onDraftChange,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  managementOptions: ManagementOptionsResponse | null;
  managementOptionsLoading: boolean;
  onDraftChange: (patch: Partial<OrderDraft>) => void;
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
        <FactRow label="Fecha prevista">
          <FactValue value={formatDate(draft.due_at)} />
        </FactRow>
        <FactRow label="Terminado">
          <FactValue value={formatDate(order.ready_at)} />
        </FactRow>
        <FactRow label="Entregado">
          <FactValue value={formatDate(order.delivered_at)} />
        </FactRow>
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
      <FactRow label="Fecha prevista">
        <FactValue value={formatDate(order.due_at)} />
      </FactRow>
      <FactRow label="Terminado">
        <FactValue value={formatDate(order.ready_at)} />
      </FactRow>
      <FactRow label="Entregado">
        <FactValue value={formatDate(order.delivered_at)} />
      </FactRow>
    </SectionCard>
  );
}
