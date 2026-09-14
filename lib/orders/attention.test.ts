import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getOrderAttentionSignals } from "./attention";
import type { Order } from "./types";

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
    customer_notification_status: "not_notified",
    notes: null,
    client_id: null,
    status_id: null,
    client: null,
    service: null,
    service_id: null,
    entry_channel_id: null,
    assigned_team_member_id: null,
    order_context_id: null,
    entry_channel: null,
    assigned_team_member: null,
    status: null,
    order_context: null,
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

describe("getOrderAttentionSignals", () => {
  it("adds a warning when the order has no assignee", () => {
    const signals = getOrderAttentionSignals(makeOrder());
    const unassigned = signals.find((signal) => signal.id === "unassigned");

    assert.ok(unassigned);
    assert.equal(unassigned.label, "Sin responsable");
    assert.equal(unassigned.tone, "warning");
  });

  it("does not warn about assignee when a team member is assigned", () => {
    const signals = getOrderAttentionSignals(
      makeOrder({
        assigned_team_member_id: "member-1",
        assigned_team_member: { name: "Ana" },
      })
    );

    assert.equal(
      signals.some((signal) => signal.id === "unassigned"),
      false
    );
  });

  it("does not warn about assignee on delivered or closed jobs", () => {
    const delivered = getOrderAttentionSignals(
      makeOrder({ delivered_at: "2026-09-01T10:00:00.000Z" })
    );
    const closed = getOrderAttentionSignals(
      makeOrder({
        status: {
          name: "Cerrado",
          code: "closed",
          is_closed: true,
        },
      })
    );
    const cancelled = getOrderAttentionSignals(
      makeOrder({
        status: {
          name: "Cancelado",
          code: "cancelled",
          is_cancelled: true,
        },
      })
    );

    assert.equal(
      delivered.some((signal) => signal.id === "unassigned"),
      false
    );
    assert.equal(
      closed.some((signal) => signal.id === "unassigned"),
      false
    );
    assert.equal(
      cancelled.some((signal) => signal.id === "unassigned"),
      false
    );
  });

  it("keeps overdue as a separate danger signal alongside unassigned", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const signals = getOrderAttentionSignals(
      makeOrder({ due_at: yesterday.toISOString() })
    );

    assert.deepEqual(
      signals.map((signal) => signal.id),
      ["overdue", "unassigned"]
    );
  });
});
