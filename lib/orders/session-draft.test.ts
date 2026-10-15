import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ORDER_DRAFT_STORAGE_KEY,
  ORDER_DRAFT_TTL_MS,
  clearOrderDraft,
  readOrderDraft,
  writeOrderDraft,
  type DraftStorage,
  type OrderSessionDraft,
} from "@/lib/orders/session-draft";

function memoryStorage(): DraftStorage & { dump: () => string | null } {
  const values = new Map<string, string>();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    dump() {
      return values.get(ORDER_DRAFT_STORAGE_KEY) ?? null;
    },
  };
}

function draft(overrides: Partial<OrderSessionDraft> = {}): OrderSessionDraft {
  return {
    tenantSlug: "sur4",
    userId: "user-raquel",
    savedAt: 1_000,
    hadFiles: false,
    title: "Carteles feria",
    clientId: "client-1",
    clientName: "AMPA Rosa Montero",
    serviceId: "service-1",
    description: "Dos copias",
    dueAt: "2026-10-14T10:00",
    entryChannelId: "channel-1",
    orderContextId: "",
    priority: "high",
    assignedTeamMemberId: "member-1",
    storeId: "store-1",
    notes: "Recoger en tienda",
    fileStatusId: "",
    ...overrides,
  };
}

describe("order session draft", () => {
  it("restores the fields for the same user and tenant", () => {
    const storage = memoryStorage();
    writeOrderDraft(storage, draft());
    const restored = readOrderDraft(storage, {
      tenantSlug: "sur4",
      userId: "user-raquel",
      now: 1_000 + 60_000,
    });
    assert.equal(restored?.title, "Carteles feria");
    assert.equal(restored?.clientName, "AMPA Rosa Montero");
    assert.equal(restored?.priority, "high");
    assert.equal(restored?.notes, "Recoger en tienda");
  });

  it("drops the draft for another user of the same team", () => {
    const storage = memoryStorage();
    writeOrderDraft(storage, draft());
    const restored = readOrderDraft(storage, {
      tenantSlug: "sur4",
      userId: "user-tamara",
      now: 1_000,
    });
    assert.equal(restored, null);
    assert.equal(storage.dump(), null);
  });

  it("drops the draft when the tenant changes", () => {
    const storage = memoryStorage();
    writeOrderDraft(storage, draft());
    assert.equal(
      readOrderDraft(storage, { tenantSlug: "demo", userId: "user-raquel", now: 1_000 }),
      null
    );
    assert.equal(storage.dump(), null);
  });

  it("expires the draft and removes it", () => {
    const storage = memoryStorage();
    writeOrderDraft(storage, draft());
    assert.equal(
      readOrderDraft(storage, {
        tenantSlug: "sur4",
        userId: "user-raquel",
        now: 1_000 + ORDER_DRAFT_TTL_MS + 1,
      }),
      null
    );
    assert.equal(storage.dump(), null);
  });

  it("clears the draft on a voluntary logout and after a successful save", () => {
    const storage = memoryStorage();
    writeOrderDraft(storage, draft());
    clearOrderDraft(storage);
    assert.equal(storage.dump(), null);
  });

  it("does not store files, passwords or tokens", () => {
    const storage = memoryStorage();
    writeOrderDraft(storage, draft({ hadFiles: true }));
    const raw = storage.dump() ?? "";
    assert.match(raw, /"hadFiles":true/);
    assert.doesNotMatch(raw, /password|token|cookie|authorization|refresh|fileName|content/i);
    const restored = readOrderDraft(storage, {
      tenantSlug: "sur4",
      userId: "user-raquel",
      now: 1_000,
    });
    assert.equal(restored?.hadFiles, true);
  });

  it("keeps drafts isolated per tab store", () => {
    const tabA = memoryStorage();
    const tabB = memoryStorage();
    writeOrderDraft(tabA, draft({ title: "Solo pestaña A" }));
    assert.equal(
      readOrderDraft(tabB, { tenantSlug: "sur4", userId: "user-raquel", now: 1_000 }),
      null
    );
    assert.equal(
      readOrderDraft(tabA, { tenantSlug: "sur4", userId: "user-raquel", now: 1_000 })?.title,
      "Solo pestaña A"
    );
  });
});
