import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDraftSaveSteps, createOrderDraft } from "./draft";
import type { Order, OrderStatus } from "./types";

const STATUSES: OrderStatus[] = [
  { id: "st-1", code: "received", name: "Recibido", is_initial: true },
];

const STORE_A = "11111111-1111-4111-8111-111111111111";

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    reference: "PED-1",
    title: "Tarjetas",
    description: null,
    priority: "normal",
    due_at: null,
    received_at: null,
    ready_at: null,
    delivered_at: null,
    archived_at: null,
    customer_notification_status: "not_notified",
    notes: null,
    client_id: null,
    status_id: "st-1",
    client: null,
    service: null,
    service_id: null,
    entry_channel_id: null,
    assigned_team_member_id: null,
    order_context_id: null,
    store_id: null,
    entry_channel: null,
    assigned_team_member: null,
    status: { name: "Recibido", code: "received" },
    order_context: null,
    store: null,
    file_status_id: null,
    quote_status_id: null,
    payment_status_id: null,
    delivery_method_id: null,
    file_status: null,
    quote_status: null,
    payment_status: null,
    delivery_method: null,
    ...overrides,
  };
}

describe("order draft store_id", () => {
  it("can assign a store to an order that had none", () => {
    const order = makeOrder();
    const draft = createOrderDraft(order, STATUSES);
    draft.store_id = STORE_A;

    const steps = buildDraftSaveSteps(order, draft, STATUSES);
    assert.deepEqual(
      steps.filter((step) => step.kind === "detail" && step.field === "store_id"),
      [{ kind: "detail", field: "store_id", value: STORE_A, label: "Tienda" }]
    );
  });

  it("can leave an order without a store", () => {
    const order = makeOrder({
      store_id: STORE_A,
      store: { name: "Principal" },
    });
    const draft = createOrderDraft(order, STATUSES);
    assert.equal(draft.store_id, STORE_A);

    draft.store_id = null;
    const steps = buildDraftSaveSteps(order, draft, STATUSES);
    assert.deepEqual(
      steps.filter((step) => step.kind === "detail" && step.field === "store_id"),
      [{ kind: "detail", field: "store_id", value: null, label: "Tienda" }]
    );
  });
});
