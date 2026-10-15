export const ORDER_DRAFT_STORAGE_KEY = "gestcopy.order-draft.v1";
export const ORDER_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

export type DraftStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type OrderSessionDraft = {
  tenantSlug: string;
  userId: string;
  savedAt: number;
  hadFiles: boolean;
  title: string;
  clientId: string | null;
  clientName: string | null;
  serviceId: string;
  description: string;
  dueAt: string;
  entryChannelId: string;
  orderContextId: string;
  priority: "normal" | "high" | "urgent";
  assignedTeamMemberId: string;
  storeId: string;
  notes: string;
  fileStatusId: string;
};

const PRIORITIES = new Set(["normal", "high", "urgent"]);
const TEXT_LIMIT = 20_000;

function clip(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  return value.length > TEXT_LIMIT ? value.slice(0, TEXT_LIMIT) : value;
}

function optionalId(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 80) : null;
}

export function writeOrderDraft(storage: DraftStorage, draft: OrderSessionDraft) {
  const payload = {
    v: 1,
    tenantSlug: draft.tenantSlug,
    userId: draft.userId,
    savedAt: draft.savedAt,
    hadFiles: draft.hadFiles === true,
    title: clip(draft.title),
    clientId: optionalId(draft.clientId),
    clientName: clip(draft.clientName),
    serviceId: clip(draft.serviceId),
    description: clip(draft.description),
    dueAt: clip(draft.dueAt),
    entryChannelId: clip(draft.entryChannelId),
    orderContextId: clip(draft.orderContextId),
    priority: PRIORITIES.has(draft.priority) ? draft.priority : "normal",
    assignedTeamMemberId: clip(draft.assignedTeamMemberId),
    storeId: clip(draft.storeId),
    notes: clip(draft.notes),
    fileStatusId: clip(draft.fileStatusId),
  };

  try {
    storage.setItem(ORDER_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // A full or blocked tab store must not prevent the login prompt.
  }
}

export function readOrderDraft(
  storage: DraftStorage,
  input: { tenantSlug: string; userId: string; now: number }
): OrderSessionDraft | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(ORDER_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }

  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearOrderDraft(storage);
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    clearOrderDraft(storage);
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const savedAt = typeof record.savedAt === "number" ? record.savedAt : 0;
  const tenantSlug = typeof record.tenantSlug === "string" ? record.tenantSlug : "";
  const userId = typeof record.userId === "string" ? record.userId : "";

  if (
    record.v !== 1 ||
    !tenantSlug ||
    !userId ||
    tenantSlug !== input.tenantSlug ||
    userId !== input.userId ||
    input.now - savedAt > ORDER_DRAFT_TTL_MS ||
    savedAt > input.now + 60_000
  ) {
    clearOrderDraft(storage);
    return null;
  }

  const priority = PRIORITIES.has(String(record.priority))
    ? (record.priority as OrderSessionDraft["priority"])
    : "normal";

  return {
    tenantSlug,
    userId,
    savedAt,
    hadFiles: record.hadFiles === true,
    title: clip(record.title),
    clientId: optionalId(record.clientId),
    clientName: typeof record.clientName === "string" ? clip(record.clientName) : null,
    serviceId: clip(record.serviceId),
    description: clip(record.description),
    dueAt: clip(record.dueAt),
    entryChannelId: clip(record.entryChannelId),
    orderContextId: clip(record.orderContextId),
    priority,
    assignedTeamMemberId: clip(record.assignedTeamMemberId),
    storeId: clip(record.storeId),
    notes: clip(record.notes),
    fileStatusId: clip(record.fileStatusId),
  };
}

export function clearOrderDraft(storage: DraftStorage) {
  try {
    storage.removeItem(ORDER_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore a storage that is already gone.
  }
}
