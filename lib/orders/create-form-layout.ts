import type { QuickOrderField } from "@/lib/settings/quick-order-layout";

export type CreateOrderFormMode = "full" | "quick";

type QuickCatalogCounts = {
  stores: number;
  entryChannels: number;
  orderContexts: number;
};

export function quickFieldIsAvailable(
  field: QuickOrderField,
  counts: QuickCatalogCounts
) {
  if (field === "store") {
    return counts.stores > 0;
  }
  if (field === "entry_channel") {
    return counts.entryChannels > 1;
  }
  if (field === "order_context") {
    return counts.orderContexts > 0;
  }
  return true;
}

export function isQuickCreateMode(
  mode: CreateOrderFormMode | null | undefined
) {
  return mode === "quick";
}

export function shouldStayOnCreateForm(
  mode: CreateOrderFormMode | null | undefined
) {
  return isQuickCreateMode(mode);
}

export function defaultSingleCatalogId(
  items: ReadonlyArray<{ id: string }>
): string | null {
  return items.length === 1 ? items[0].id : null;
}

export function showEntryChannelInMainForm(
  mode: CreateOrderFormMode | null | undefined,
  channelCount: number
) {
  return !isQuickCreateMode(mode) && channelCount > 0;
}

export function showEntryChannelInMoreOptions(
  mode: CreateOrderFormMode | null | undefined,
  channelCount: number
) {
  return isQuickCreateMode(mode) && channelCount > 1;
}

export function suggestedAssigneeId(input: {
  currentAssigneeId: string;
  role: string | null | undefined;
  sessionTeamMemberId: string | null | undefined;
  availableMemberIds: readonly string[];
}) {
  if (input.currentAssigneeId) {
    return input.currentAssigneeId;
  }

  if (input.role !== "staff") {
    return "";
  }

  const sessionId = input.sessionTeamMemberId?.trim() ?? "";
  if (!sessionId) {
    return "";
  }

  return input.availableMemberIds.includes(sessionId) ? sessionId : "";
}
