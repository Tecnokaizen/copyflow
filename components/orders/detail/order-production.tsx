import { SectionCard } from "@/components/gestcopy/section-card";
import {
  DraftInput,
  DraftSelect,
  FactRow,
  FactValue,
} from "@/components/orders/detail/order-field";
import {
  formatDate,
  formatPriority,
  fromDateTimeLocalValue,
  toDateTimeLocalValue,
} from "@/lib/orders/format";
import type {
  ManagementOptionsResponse,
  Order,
  OrderDraft,
  OrderOptionsResponse,
  OrderStatus,
} from "@/lib/orders/types";

export function OrderProduction({
  order,
  draft,
  editing,
  statuses,
  orderOptions,
  orderOptionsLoading,
  managementOptions,
  managementOptionsLoading,
  onDraftChange,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  statuses: OrderStatus[];
  orderOptions: OrderOptionsResponse | null;
  orderOptionsLoading: boolean;
  managementOptions: ManagementOptionsResponse | null;
  managementOptionsLoading: boolean;
  onDraftChange: (patch: Partial<OrderDraft>) => void;
}) {
  if (editing && draft) {
    return (
      <SectionCard title="Producción" bodyClassName="px-5 py-2 sm:px-6">
        <FactRow label="Estado">
          <DraftSelect
            value={
              draft.status_id ||
              statuses.find((item) => item.code === order.status?.code)?.id ||
              ""
            }
            onChange={(value) => onDraftChange({ status_id: value })}
          >
            {statuses.map((status) => (
              <option key={status.id} value={status.id}>
                {status.name}
              </option>
            ))}
          </DraftSelect>
        </FactRow>
        <FactRow label="Prioridad">
          <DraftSelect
            value={draft.priority}
            onChange={(value) => onDraftChange({ priority: value })}
          >
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </DraftSelect>
        </FactRow>
        <FactRow label="Responsable">
          <DraftSelect
            value={draft.assigned_team_member_id ?? ""}
            disabled={orderOptionsLoading}
            onChange={(value) =>
              onDraftChange({ assigned_team_member_id: value || null })
            }
          >
            <option value="">— Sin definir —</option>
            {orderOptions?.team_members.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </DraftSelect>
        </FactRow>
        <FactRow label="Archivos">
          <DraftSelect
            value={draft.file_status_id ?? ""}
            disabled={managementOptionsLoading}
            onChange={(value) =>
              onDraftChange({ file_status_id: value || null })
            }
          >
            <option value="">— Sin definir —</option>
            {managementOptions?.file_statuses.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </DraftSelect>
        </FactRow>
        <FactRow label="Presupuesto">
          <DraftSelect
            value={draft.quote_status_id ?? ""}
            disabled={managementOptionsLoading}
            onChange={(value) =>
              onDraftChange({ quote_status_id: value || null })
            }
          >
            <option value="">— Sin definir —</option>
            {managementOptions?.quote_statuses.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </DraftSelect>
        </FactRow>
        <FactRow label="Entrega prevista">
          <DraftInput
            type="datetime-local"
            value={toDateTimeLocalValue(draft.due_at)}
            disabled={orderOptionsLoading}
            onChange={(value) =>
              onDraftChange({ due_at: fromDateTimeLocalValue(value) })
            }
          />
        </FactRow>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Producción" bodyClassName="px-5 py-2 sm:px-6">
      <FactRow label="Responsable">
        <FactValue value={order.assigned_team_member?.name} empty="Sin responsable" />
      </FactRow>
      <FactRow label="Servicio">
        <FactValue value={order.service?.name} />
      </FactRow>
      <FactRow label="Archivos">
        <FactValue value={order.file_status?.name} />
      </FactRow>
      <FactRow label="Presupuesto">
        <FactValue value={order.quote_status?.name} />
      </FactRow>
      <FactRow label="Prioridad">
        <FactValue value={formatPriority(order.priority)} />
      </FactRow>
      <FactRow label="Estado">
        <FactValue value={order.status?.name} />
      </FactRow>
      <FactRow label="Entrega prevista">
        <FactValue value={formatDate(order.due_at)} />
      </FactRow>
    </SectionCard>
  );
}
