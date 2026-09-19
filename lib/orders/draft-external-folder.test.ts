import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildDraftSaveSteps, createOrderDraft } from "./draft";
import type { Order, OrderStatus } from "./types";

const STATUSES: OrderStatus[] = [
  { id: "st-1", code: "received", name: "Recibido", is_initial: true },
];

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
    version: "0",
    customer_notification_status: "not_notified",
    notes: null,
    external_folder_url: null,
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

describe("external_folder_url draft steps", () => {
  it("creates a content step when the URL changes", () => {
    const order = makeOrder({
      external_folder_url: "https://drive.google.com/a",
    });
    const draft = createOrderDraft(order, STATUSES);
    draft.external_folder_url = "https://drive.google.com/b";

    const steps = buildDraftSaveSteps(order, draft, STATUSES);
    assert.deepEqual(
      steps.filter(
        (step) =>
          step.kind === "content" && step.field === "external_folder_url"
      ),
      [
        {
          kind: "content",
          field: "external_folder_url",
          value: "https://drive.google.com/b",
          label: "Enlace a Drive",
        },
      ]
    );
  });

  it("does not emit a step when the URL is unchanged", () => {
    const order = makeOrder({
      external_folder_url: "https://example.com/folder",
    });
    const draft = createOrderDraft(order, STATUSES);
    const steps = buildDraftSaveSteps(order, draft, STATUSES);
    assert.equal(
      steps.some(
        (step) =>
          step.kind === "content" && step.field === "external_folder_url"
      ),
      false
    );
  });

  it("clears the URL with value null", () => {
    const order = makeOrder({
      external_folder_url: "https://example.com/folder",
    });
    const draft = createOrderDraft(order, STATUSES);
    draft.external_folder_url = "   ";

    const steps = buildDraftSaveSteps(order, draft, STATUSES);
    assert.deepEqual(
      steps.filter(
        (step) =>
          step.kind === "content" && step.field === "external_folder_url"
      ),
      [
        {
          kind: "content",
          field: "external_folder_url",
          value: null,
          label: "Enlace a Drive",
        },
      ]
    );
  });
});
