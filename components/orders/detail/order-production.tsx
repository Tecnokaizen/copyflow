import { useState } from "react";
import { DateTimePicker } from "@/components/gestcopy/date-time-picker";
import { SectionCard } from "@/components/gestcopy/section-card";
import { RichTextContent } from "@/components/rich-text/rich-text-content";
import { RichTextEditor } from "@/components/rich-text/rich-text-editor";
import { isRichTextEmpty } from "@/lib/rich-text/html";
import {
  DraftInput,
  DraftSelect,
  FactRow,
  FactValue,
} from "@/components/orders/detail/order-field";
import {
  OrderQuoteSituationField,
  OrderQuoteSituationValue,
} from "@/components/orders/detail/order-quote-situation";
import { formatFactLabel } from "@/lib/orders/fact-label";
import { resolveOrderQuoteSituation } from "@/lib/orders/quote-situation";
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
  SourceQuote,
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
  sourceQuote = null,
  sourceQuoteRestricted = false,
  onDraftChange,
  onDueAtInvalid,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  statuses: OrderStatus[];
  orderOptions: OrderOptionsResponse | null;
  orderOptionsLoading: boolean;
  managementOptions: ManagementOptionsResponse | null;
  managementOptionsLoading: boolean;
  /** Tenant-scoped source quote (order_source_quote_v2); source of truth when present. */
  sourceQuote?: SourceQuote | null;
  /** The order has a source quote this user cannot read. */
  sourceQuoteRestricted?: boolean;
  onDraftChange: (patch: Partial<OrderDraft>) => void;
  onDueAtInvalid?: (invalid: boolean) => void;
}) {
  const [rejectedLocal, setRejectedLocal] = useState<string | null>(null);
  const quoteSituation = resolveOrderQuoteSituation({
    sourceQuote,
    sourceQuoteRestricted,
    quoteStatus: order.quote_status,
    serviceRequiresQuote: order.service?.requires_quote === true,
    quoteStatusOptions: managementOptions?.quote_statuses,
  });

  if (editing && draft) {
    return (
      <SectionCard title="Producción" bodyClassName="px-5 py-2 sm:px-6">
        <FactRow label="Instrucciones">
          <RichTextEditor
            ariaLabel="Instrucciones"
            value={draft.description}
            onChange={(value) => onDraftChange({ description: value })}
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
        <FactRow label="Estado de archivos">
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
          <OrderQuoteSituationField
            situation={quoteSituation}
            value={draft.quote_status_id}
            storedId={order.quote_status_id}
            options={managementOptions?.quote_statuses}
            serviceRequiresQuote={order.service?.requires_quote === true}
            disabled={managementOptionsLoading}
            onChange={(value) => onDraftChange({ quote_status_id: value })}
          />
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
          <DateTimePicker
            value={rejectedLocal ?? toDateTimeLocalValue(draft.due_at)}
            disabled={orderOptionsLoading}
            onChange={(value) => {
              if (!value) {
                setRejectedLocal(null);
                onDueAtInvalid?.(false);
                onDraftChange({ due_at: null });
                return;
              }

              const iso = fromDateTimeLocalValue(value);
              if (!iso) {
                setRejectedLocal(value);
                onDueAtInvalid?.(true);
                return;
              }

              setRejectedLocal(null);
              onDueAtInvalid?.(false);
              onDraftChange({ due_at: iso });
            }}
          />
        </FactRow>
      </SectionCard>
    );
  }

  const serviceName = order.service?.name;

  return (
    <SectionCard title="Producción" bodyClassName="px-5 py-2 sm:px-6">
      <div className="border-b border-border/60 py-4">
        <div className="gc-fact-label">{formatFactLabel("Instrucciones")}</div>
        {isRichTextEmpty(order.description) ? (
          <p className="mt-1.5 text-base text-muted-foreground">
            Sin instrucciones
          </p>
        ) : (
          <RichTextContent
            value={order.description}
            className="gc-fact-value mt-1.5 text-base font-medium leading-relaxed"
          />
        )}
        {isRichTextEmpty(order.notes) ? null : (
          <p className="mt-2 text-sm text-muted-foreground">
            Hay notas internas más abajo.
          </p>
        )}
      </div>
      <FactRow label="Servicio">
        <FactValue value={serviceName} />
      </FactRow>
      <FactRow label="Estado de archivos">
        <FactValue value={order.file_status?.name} empty="Sin estado de archivo" />
      </FactRow>
      <FactRow label="Presupuesto">
        <OrderQuoteSituationValue situation={quoteSituation} />
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
