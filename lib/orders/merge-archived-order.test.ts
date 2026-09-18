import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeArchivedOrderResult } from "./lifecycle-ux";
import type { Order } from "./types";

function fullOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    reference: "DEMO-9999",
    title: "Ficha completa",
    description: "Instrucciones",
    priority: "normal",
    due_at: "2026-09-20T10:00:00.000Z",
    received_at: "2026-09-17T10:00:00.000Z",
    ready_at: "2026-09-17T11:00:00.000Z",
    delivered_at: "2026-09-17T12:00:00.000Z",
    archived_at: null,
    version: "0",
    customer_notification_status: "not_notified",
    notes: "Notas internas",
    client_id: "client-1",
    status_id: "status-closed",
    client: {
      id: "client-1",
      customer_type_id: null,
      name: "Acme",
      contact_name: null,
      company_name: "Acme SL",
      tax_id: null,
      email: "a@acme.test",
      phone: null,
      notes: null,
    },
    service: { name: "Copias color" },
    service_id: "service-1",
    entry_channel_id: "channel-1",
    assigned_team_member_id: "member-1",
    order_context_id: null,
    store_id: "store-1",
    entry_channel: { name: "Tienda" },
    assigned_team_member: { name: "Clara Ruiz" },
    status: {
      name: "Recogido",
      code: "collected",
      is_closed: true,
      is_cancelled: false,
      is_ready: false,
    },
    order_context: null,
    store: { name: "Centro" },
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

describe("mergeArchivedOrderResult", () => {
  it("merges partial archive payload without wiping ficha relations", () => {
    const current = fullOrder();
    const partial = {
      id: current.id,
      reference: current.reference,
      status_id: current.status_id,
      archived_at: "2026-09-17T20:48:37.216653+00:00",
    };

    const merged = mergeArchivedOrderResult(current, partial);

    assert.equal(merged.archived_at, partial.archived_at);
    assert.equal(merged.client?.name, "Acme");
    assert.equal(merged.service?.name, "Copias color");
    assert.equal(merged.status?.code, "collected");
    assert.equal(merged.assigned_team_member?.name, "Clara Ruiz");
    assert.equal(merged.entry_channel?.name, "Tienda");
    assert.equal(merged.store?.name, "Centro");
    assert.equal(merged.description, "Instrucciones");
    assert.equal(merged.notes, "Notas internas");
    assert.equal(merged.title, "Ficha completa");
  });

  it("keeps current snapshot on replay when partial omits relations", () => {
    const current = fullOrder({
      archived_at: "2026-09-17T20:48:37.216653+00:00",
    });
    const partial = {
      id: current.id,
      reference: current.reference,
      status_id: current.status_id,
      archived_at: "2026-09-17T20:48:37.216653+00:00",
    };

    const merged = mergeArchivedOrderResult(current, partial);

    assert.equal(merged.archived_at, current.archived_at);
    assert.equal(merged.client?.id, "client-1");
    assert.equal(merged.status?.is_closed, true);
    assert.equal(merged.service_id, "service-1");
  });

  it("returns current unchanged when partial is missing", () => {
    const current = fullOrder();
    assert.equal(mergeArchivedOrderResult(current, null), current);
    assert.equal(mergeArchivedOrderResult(current, undefined), current);
  });
});
