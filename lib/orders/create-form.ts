import { persistRichText } from "@/lib/rich-text/html";

export type CreateOrderPayloadInput = {
  title: string;
  clientId: string | null;
  serviceId: string;
  description: string;
  dueAtIso: string | null;
  entryChannelId: string;
  orderContextId: string;
  priority: "normal" | "high" | "urgent";
  assignedTeamMemberId: string;
  storeId: string;
  notes: string;
  fileStatusId?: string;
};

/** Shared POST /api/orders body for full and quick create modes. */
export function buildCreateOrderPayload(input: CreateOrderPayloadInput) {
  return {
    title: input.title,
    client_id: input.clientId,
    service_id: input.serviceId || null,
    description: persistRichText(input.description),
    due_at: input.dueAtIso,
    entry_channel_id: input.entryChannelId || null,
    order_context_id: input.orderContextId || null,
    priority: input.priority,
    assigned_team_member_id: input.assignedTeamMemberId || null,
    store_id: input.storeId || null,
    notes: persistRichText(input.notes),
    ...(input.fileStatusId !== undefined ? { file_status_id: input.fileStatusId || null } : {}),
  };
}
