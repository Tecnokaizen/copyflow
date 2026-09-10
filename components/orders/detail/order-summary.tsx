import { SectionCard } from "@/components/gestcopy/section-card";
import {
  DraftInput,
  DraftSelect,
  DraftTextarea,
  FactRow,
  FactValue,
} from "@/components/orders/detail/order-field";
import {
  displayValue,
  formatDate,
} from "@/lib/orders/format";
import type {
  Order,
  OrderDraft,
  OrderOptionsResponse,
} from "@/lib/orders/types";

export function OrderSummary({
  order,
  draft,
  editing,
  orderOptions,
  orderOptionsLoading,
  onDraftChange,
  clientActions,
}: {
  order: Order;
  draft: OrderDraft | null;
  editing: boolean;
  orderOptions: OrderOptionsResponse | null;
  orderOptionsLoading: boolean;
  onDraftChange: (patch: Partial<OrderDraft>) => void;
  clientActions?: React.ReactNode;
}) {
  const client = order.client_id && order.client?.id ? order.client : null;
  const description =
    editing && draft ? draft.description : (order.description ?? "");
  const serviceName =
    editing && draft
      ? orderOptions?.services.find((item) => item.id === draft.service_id)
          ?.name ?? (draft.service_id ? "—" : null)
      : order.service?.name;
  const channelName =
    editing && draft
      ? orderOptions?.entry_channels.find(
          (item) => item.id === draft.entry_channel_id
        )?.name ?? null
      : order.entry_channel?.name;
  const contextName =
    editing && draft
      ? orderOptions?.order_contexts.find(
          (item) => item.id === draft.order_context_id
        )?.name ?? null
      : order.order_context?.name;

  return (
    <SectionCard title="Resumen" bodyClassName="px-5 py-2 sm:px-6">
      {editing && draft ? (
        <>
          <FactRow label="Título">
            <DraftInput
              value={draft.title}
              onChange={(value) => onDraftChange({ title: value })}
            />
          </FactRow>
          <FactRow label="Descripción">
            <DraftTextarea
              value={draft.description}
              onChange={(value) => onDraftChange({ description: value })}
              rows={3}
            />
          </FactRow>
          <FactRow label="Servicio">
            <DraftSelect
              value={draft.service_id ?? ""}
              disabled={orderOptionsLoading}
              onChange={(value) =>
                onDraftChange({ service_id: value || null })
              }
            >
              <option value="">— Sin definir —</option>
              {orderOptions?.services.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </DraftSelect>
          </FactRow>
          <FactRow label="Canal">
            <DraftSelect
              value={draft.entry_channel_id ?? ""}
              disabled={orderOptionsLoading}
              onChange={(value) =>
                onDraftChange({ entry_channel_id: value || null })
              }
            >
              <option value="">— Sin definir —</option>
              {orderOptions?.entry_channels.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </DraftSelect>
          </FactRow>
          <FactRow label="Contexto">
            <DraftSelect
              value={draft.order_context_id ?? ""}
              disabled={orderOptionsLoading}
              onChange={(value) =>
                onDraftChange({ order_context_id: value || null })
              }
            >
              <option value="">— Sin definir —</option>
              {orderOptions?.order_contexts.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </DraftSelect>
          </FactRow>
        </>
      ) : (
        <>
          <FactRow label="Servicio">
            <FactValue value={serviceName} />
          </FactRow>
          <FactRow label="Descripción">
            <FactValue value={description} empty="Sin descripción" />
          </FactRow>
          <FactRow label="Canal">
            <FactValue value={channelName} />
          </FactRow>
          <FactRow label="Contexto">
            <FactValue value={contextName} />
          </FactRow>
        </>
      )}

      <FactRow label="Cliente">
        {client ? (
          <div className="space-y-1">
            <div className="font-medium">{client.name}</div>
            {client.company_name ? (
              <div className="text-muted-foreground">{client.company_name}</div>
            ) : null}
            {client.contact_name ? (
              <div className="text-muted-foreground">
                Contacto: {client.contact_name}
              </div>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">Sin cliente</span>
        )}
      </FactRow>

      <FactRow label="Contacto">
        {client ? (
          <div className="space-y-1">
            <div>{displayValue(client.email)}</div>
            <div>{displayValue(client.phone)}</div>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </FactRow>

      <FactRow label="Recepción">
        <FactValue value={formatDate(order.received_at)} />
      </FactRow>

      {editing && clientActions ? (
        <div className="flex flex-wrap gap-2 border-t border-border/60 py-4">
          {clientActions}
        </div>
      ) : null}
    </SectionCard>
  );
}
