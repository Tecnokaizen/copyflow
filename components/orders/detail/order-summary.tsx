import { SectionCard } from "@/components/gestcopy/section-card";
import {
  DraftInput,
  DraftSelect,
  FactRow,
  FactValue,
} from "@/components/orders/detail/order-field";
import {
  displayValue,
  formatDate,
  formatPriority,
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
  const storeName =
    editing && draft
      ? orderOptions?.stores.find((item) => item.id === draft.store_id)
          ?.name ??
        (draft.store_id ? order.store?.name ?? "—" : null)
      : order.store?.name;
  const assigneeName =
    editing && draft
      ? orderOptions?.team_members.find(
          (item) => item.id === draft.assigned_team_member_id
        )?.name ?? null
      : order.assigned_team_member?.name;
  const dueAt = editing && draft ? draft.due_at : order.due_at;
  const priority = editing && draft ? draft.priority : order.priority;
  const hasContact = Boolean(client?.email?.trim() || client?.phone?.trim());

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
          <FactRow label="Tienda">
            <DraftSelect
              value={draft.store_id ?? ""}
              disabled={orderOptionsLoading}
              onChange={(value) =>
                onDraftChange({ store_id: value || null })
              }
            >
              <option value="">— Sin tienda —</option>
              {orderOptions?.stores.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </DraftSelect>
          </FactRow>
        </>
      ) : (
        <>
          <FactRow label="Cliente" emphasis>
            {client ? (
              <div className="space-y-1">
                <div>{client.name}</div>
                {client.company_name ? (
                  <div className="text-sm font-normal text-muted-foreground">
                    {client.company_name}
                  </div>
                ) : null}
                {client.contact_name ? (
                  <div className="text-sm font-normal text-muted-foreground">
                    Contacto: {client.contact_name}
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="font-normal text-muted-foreground">
                Sin cliente
              </span>
            )}
          </FactRow>
          {hasContact ? (
            <FactRow label="Contacto">
              <div className="space-y-1">
                {client?.phone?.trim() ? <div>{client.phone}</div> : null}
                {client?.email?.trim() ? (
                  <div>{displayValue(client.email)}</div>
                ) : null}
              </div>
            </FactRow>
          ) : null}
          <FactRow label="Canal">
            <FactValue value={channelName} />
          </FactRow>
          <FactRow label="Tienda">
            <FactValue value={storeName} empty="Sin tienda" />
          </FactRow>
          <FactRow label="Servicio">
            <FactValue value={serviceName} />
          </FactRow>
          <FactRow label="Recepción">
            <FactValue value={formatDate(order.received_at)} />
          </FactRow>
          <FactRow label="Entrega prevista" emphasis>
            <FactValue value={formatDate(dueAt)} />
          </FactRow>
          <FactRow label="Responsable" emphasis>
            <FactValue value={assigneeName} empty="Sin responsable" />
          </FactRow>
          <FactRow label="Prioridad" emphasis>
            <FactValue value={formatPriority(priority)} />
          </FactRow>
          {contextName ? (
            <FactRow label="Contexto">
              <FactValue value={contextName} />
            </FactRow>
          ) : null}
        </>
      )}

      {editing ? (
        <>
          <FactRow label="Cliente" emphasis>
            {client ? (
              <div className="space-y-1">
                <div>{client.name}</div>
                {client.company_name ? (
                  <div className="text-sm font-normal text-muted-foreground">
                    {client.company_name}
                  </div>
                ) : null}
                {client.contact_name ? (
                  <div className="text-sm font-normal text-muted-foreground">
                    Contacto: {client.contact_name}
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="font-normal text-muted-foreground">
                Sin cliente
              </span>
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
        </>
      ) : null}

      {editing && clientActions ? (
        <div className="border-t border-border/60 py-4">{clientActions}</div>
      ) : null}
    </SectionCard>
  );
}
