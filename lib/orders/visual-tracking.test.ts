import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ActivityItem, Order, OrderStatus } from "./types";
import { buildOrderTracking } from "./visual-tracking";

const statuses: OrderStatus[] = [
  { id: "received", code: "received", name: "Recibido", sort_order: 10, active: true, is_initial: true },
  { id: "design", code: "design", name: "Diseño aprobado", sort_order: 20, active: true },
  { id: "production", code: "production", name: "En producción", sort_order: 30, active: true },
  { id: "ready", code: "ready", name: "Terminado", sort_order: 40, active: true, is_ready: true },
  { id: "delivered", code: "delivered", name: "Entregado", sort_order: 50, active: true, is_closed: true },
  { id: "cancelled", code: "cancelled", name: "Cancelado", sort_order: 60, active: true, is_cancelled: true },
];
const order = (id: string | null): Pick<Order, "id" | "status_id" | "status"> => ({
  id: "order-a", status_id: id, status: statuses.find((status) => status.id === id) ?? null,
});
const event = (previous: string | null, next: string | null, date = "2026-10-20T10:00:00Z", extra: Partial<ActivityItem> = {}): ActivityItem => ({
  id: `${previous}-${next}-${date}`, entity_type: "order", entity_id: "order-a", action: previous ? "order.status_changed" : "order.created",
  previous_values: previous ? { status_id: previous, status_name: statuses.find((s) => s.id === previous)?.name ?? previous } : null,
  new_values: { status_id: next, status_name: statuses.find((s) => s.id === next)?.name ?? next },
  created_at: date, metadata: {}, user_id: null, team_member_id: null, actor: null, ...extra,
});
const find = (steps: ReturnType<typeof buildOrderTracking>, id: string) => steps.find((s) => s.id === id)!;

describe("visual order tracking: evidence, never inferred progress", () => {
  it("distinguishes completed, current, pending and skipped/unconfirmed steps", () => {
    const steps = buildOrderTracking(order("production"), statuses, [event("received", "production")]);
    assert.equal(find(steps, "received").state, "completed");
    assert.equal(find(steps, "received").enteredAt, null);
    assert.equal(find(steps, "design").state, "unconfirmed");
    assert.equal(find(steps, "production").state, "current");
    assert.equal(find(steps, "ready").state, "pending");
    assert.equal(steps.some((s) => s.id === "cancelled"), false);
  });
  it("does not invent any completion or historical time for a legacy order", () => {
    const steps = buildOrderTracking(order("delivered"), statuses, []);
    assert.equal(steps.filter((s) => s.state === "completed").length, 0);
    assert.ok(steps.every((s) => s.enteredAt === null));
    assert.equal(find(steps, "ready").state, "unconfirmed");
    assert.equal(find(steps, "delivered").state, "current");
  });
  it("does not complete Entregado when Terminado is current", () => {
    const steps = buildOrderTracking(order("ready"), statuses, [event("production", "ready")]);
    assert.equal(find(steps, "ready").state, "current");
    assert.equal(find(steps, "delivered").state, "pending");
    assert.equal(find(steps, "delivered").enteredAt, null);
  });
  it("dates creation only for the actual initial status stored in the event", () => {
    const steps = buildOrderTracking(order("production"), statuses, [event(null, "production")]);
    assert.equal(find(steps, "production").enteredAt, "2026-10-20T10:00:00Z");
    assert.equal(find(steps, "received").state, "unconfirmed");
  });
  it("ignores unrelated actions, orders and entity types", () => {
    const steps = buildOrderTracking(order("production"), statuses, [
      event(null, "ready", undefined, { action: "order.management_changed" }),
      event(null, "ready", undefined, { entity_id: "order-b" }),
      event(null, "design", undefined, { entity_type: "quote" }),
    ]);
    assert.equal(steps.filter((s) => s.state === "completed").length, 0);
  });
  it("supports repeated transitions and reopening without losing the actual current state", () => {
    const steps = buildOrderTracking(order("production"), statuses, [
      event("ready", "production", "2026-10-22T12:00:00Z"),
      event("production", "ready", "2026-10-21T10:00:00Z"),
      event("received", "production", "2026-10-20T10:00:00Z"),
    ]);
    assert.equal(find(steps, "production").enteredAt, "2026-10-22T12:00:00Z");
    assert.equal(find(steps, "ready").state, "completed");
    assert.equal(find(steps, "delivered").state, "pending");
    assert.equal(steps.filter((s) => s.state === "current").length, 1);
  });
  it("does not reuse an old entry time while activity lags behind a status change", () => {
    const steps = buildOrderTracking(order("production"), statuses, [
      event("received", "production", "2026-10-20T10:00:00Z"),
      event("production", "ready", "2026-10-21T10:00:00Z"),
    ]);
    assert.equal(find(steps, "production").enteredAt, null);
  });
  it("cancellation is an alternate outcome and does not complete the normal path", () => {
    const steps = buildOrderTracking(order("cancelled"), statuses, [event("received", "cancelled")]);
    assert.equal(find(steps, "cancelled").state, "current");
    assert.equal(find(steps, "ready").state, "unconfirmed");
    assert.equal(find(steps, "delivered").state, "unconfirmed");
  });
  it("retains inactive current/visited statuses and omits inactive unvisited statuses", () => {
    const catalogue = statuses.map((s) => ({ ...s, active: !["design", "production", "ready"].includes(s.id) }));
    const steps = buildOrderTracking(order("production"), catalogue, [event("design", "production")]);
    assert.equal(find(steps, "design").inactive, true);
    assert.equal(find(steps, "production").state, "current");
    assert.equal(steps.some((s) => s.id === "ready"), false);
  });
  it("preserves historical statuses absent from the catalogue, without matching by name or code", () => {
    const steps = buildOrderTracking(order("production"), statuses, [event("legacy-state", "production")]);
    assert.equal(find(steps, "legacy-state").name, "legacy-state");
    assert.equal(find(steps, "legacy-state").enteredAt, null);
    assert.equal(find(steps, "received").state, "unconfirmed");
  });
  it("uses tenant configuration and does not mutate catalogue or activity input", () => {
    const catalogue = statuses.map((s) => ({ ...s, name: `Tenant B · ${s.name}`, sort_order: 100 - s.sort_order! }));
    const history = [event("received", "production")];
    const before = JSON.stringify({ catalogue, history });
    const steps = buildOrderTracking(order("production"), catalogue, history);
    assert.equal(steps[0].name, "Tenant B · Entregado");
    assert.equal(JSON.stringify({ catalogue, history }), before);
  });
  it("handles missing current state and missing catalogue conservatively", () => {
    const steps = buildOrderTracking(order(null), [], []);
    assert.deepEqual(steps.map((s) => [s.name, s.state, s.enteredAt]), [["Estado sin definir", "current", null]]);
    assert.equal(buildOrderTracking(order("ready"), [], [])[0].name, "Terminado");
  });
  it("invalid dates remain absent rather than throwing or estimating", () => {
    const steps = buildOrderTracking(order("production"), statuses, [event("received", "production", "not-a-date")]);
    assert.equal(find(steps, "production").enteredAt, null);
    assert.equal(find(steps, "received").enteredAt, null);
  });
  it("sticky lifecycle fields never prove a configurable state or date", () => {
    const historicalOrder = { ...order("production"), ready_at: "2026-10-19T12:00:00Z", delivered_at: "2026-10-19T14:00:00Z", received_at: "2026-10-18T09:00:00Z", due_at: "2026-10-30T18:00:00Z" };
    const steps = buildOrderTracking(historicalOrder, statuses, []);
    assert.equal(steps.filter((s) => s.state === "completed").length, 0);
    assert.ok(steps.every((s) => s.enteredAt === null));
  });
});
