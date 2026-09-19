import { SectionCard } from "@/components/gestcopy/section-card";
import {
  DraftInput,
  DraftSelect,
  DraftTextarea,
  FactRow,
  FactValue,
} from "@/components/orders/detail/order-field";
import { formatFactLabel } from "@/lib/orders/fact-label";
import {
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
        <FactRow label="Instrucciones">
          <DraftTextarea
            value={draft.description}
            onChange={(value) => onDraftChange({ description: value })}
            rows={4}
          />
        </FactRow>
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
        <FactRow label="Prioridad" emphasis>
          <DraftSelect
            value={draft.priority}
            onChange={(value) => onDraftChange({ priority: value })}
          >
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
            <option value="urgent">Urgente</option>
          </DraftSelect>
        </FactRow>
        <FactRow label="Responsable" emphasis>
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
        <FactRow label="Enlace a Drive">
          <DraftInput
            type="url"
            value={draft.external_folder_url}
            placeholder="https://drive.google.com/..."
            onChange={(value) => onDraftChange({ external_folder_url: value })}
          />
        </FactRow>
        <FactRow label="Entrega prevista" emphasis>
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

  const description = order.description?.trim();
  const hasNotes = Boolean(order.notes?.trim());
  const serviceName = order.service?.name;

  return (
    <SectionCard title="Producción" bodyClassName="px-5 py-2 sm:px-6">
      <div className="border-b border-border/60 py-4">
        <div className="gc-fact-label">{formatFactLabel("Instrucciones")}</div>
        {description ? (
          <p className="gc-fact-value mt-1.5 whitespace-pre-wrap break-words text-base font-medium leading-relaxed">
            {description}
          </p>
        ) : (
          <p className="mt-1.5 text-base text-muted-foreground">
            Sin instrucciones
          </p>
        )}
        {hasNotes ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Hay notas internas más abajo.
          </p>
        ) : null}
      </div>
      <FactRow label="Servicio">
        <FactValue value={serviceName} />
      </FactRow>
      <FactRow label="Archivos">
        <FactValue value={order.file_status?.name} empty="Sin estado de archivo" />
      </FactRow>
      <FactRow label="Presupuesto">
        <FactValue value={order.quote_status?.name} />
      </FactRow>
      <FactRow label="Enlace a Drive">
        {order.external_folder_url?.trim() ? (
          <div className="space-y-1">
            <a
              href={order.external_folder_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Abrir carpeta externa
            </a>
            <div className="break-all text-sm font-normal text-muted-foreground">
              {order.external_folder_url}
            </div>
          </div>
        ) : (
          <FactValue value={null} empty="Sin enlace externo" />
        )}
      </FactRow>
    </SectionCard>
  );
}
