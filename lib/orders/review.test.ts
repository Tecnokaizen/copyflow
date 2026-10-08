import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { getZonedDayBounds } from "@/lib/time/zoned-day";
import {
  classifyOrderReview,
  collectReviewOrders,
  filterReviewOrders,
  formatTenantDueLabel,
  isOperationalDueToday,
  matchesReviewCandidateQuery,
  NEEDS_ATTENTION_INCLUDES,
  type ReviewContext,
  type ReviewOrderInput,
} from "./review";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function order(overrides: Partial<ReviewOrderInput> = {}): ReviewOrderInput {
  return {
    id: "order-1",
    archived_at: null,
    due_at: null,
    assigned_team_member_id: "member-1",
    customer_notification_status: "notified",
    ready_at: null,
    status_id: "status-open",
    store_id: "store-1",
    status: {
      is_closed: false,
      is_cancelled: false,
      is_ready: false,
    },
    ...overrides,
  };
}

function codes(value: ReviewOrderInput, context: ReviewContext) {
  return classifyOrderReview(value, context).map((reason) => reason.code);
}

function labels(value: ReviewOrderInput, context: ReviewContext) {
  return classifyOrderReview(value, context).map((reason) => reason.label);
}

const madrid: ReviewContext = {
  timeZone: "Europe/Madrid",
  now: new Date("2026-10-08T10:00:00.000Z"),
};

describe("classifyOrderReview", () => {
  it("flags an operational overdue order as Retrasado", () => {
    const due = new Date("2026-10-07T15:00:00.000Z").toISOString();
    const result = classifyOrderReview(order({ due_at: due }), madrid);
    assert.deepEqual(labels(order({ due_at: due }), madrid), ["Retrasado"]);
    assert.equal(result[0]?.tone, "danger");
  });

  it("flags a due-today order that is not ready", () => {
    const due = new Date("2026-10-08T15:00:00.000Z").toISOString();
    assert.deepEqual(
      labels(order({ due_at: due, status: { is_ready: false } }), madrid),
      ["Entrega hoy pendiente"]
    );
  });

  it("does not flag due-today pending when the current status is ready", () => {
    const due = new Date("2026-10-08T15:00:00.000Z").toISOString();
    const value = order({
      due_at: due,
      customer_notification_status: "notified",
      status: { is_ready: true, is_closed: false, is_cancelled: false },
    });
    assert.equal(codes(value, madrid).includes("due_today_pending"), false);
    assert.deepEqual(codes(value, madrid), []);
    assert.equal(isOperationalDueToday(value, madrid), true);
  });

  it("flags ready and not_notified as Avisar al cliente", () => {
    const value = order({
      due_at: new Date("2026-10-10T15:00:00.000Z").toISOString(),
      customer_notification_status: "not_notified",
      status: { is_ready: true, is_closed: false, is_cancelled: false },
    });
    const result = classifyOrderReview(value, madrid);
    assert.deepEqual(
      result.map((reason) => reason.label),
      ["Avisar al cliente"]
    );
    assert.equal(result[0]?.tone, "brand");
  });

  it("does not flag Avisar al cliente when the customer was notified", () => {
    const value = order({
      customer_notification_status: "notified",
      status: { is_ready: true, is_closed: false, is_cancelled: false },
      due_at: new Date("2026-10-10T15:00:00.000Z").toISOString(),
    });
    assert.equal(codes(value, madrid).includes("customer_not_notified"), false);
  });

  it("does not flag Avisar al cliente for notified_no_pickup", () => {
    const value = order({
      customer_notification_status: "notified_no_pickup",
      status: { is_ready: true, is_closed: false, is_cancelled: false },
      due_at: new Date("2026-10-10T15:00:00.000Z").toISOString(),
    });
    assert.equal(codes(value, madrid).includes("customer_not_notified"), false);
  });

  it("flags a missing assignee as Sin responsable", () => {
    const value = order({
      assigned_team_member_id: null,
      due_at: new Date("2026-10-10T15:00:00.000Z").toISOString(),
      customer_notification_status: "notified",
      status: { is_ready: false, is_closed: false, is_cancelled: false },
    });
    const result = classifyOrderReview(value, madrid);
    assert.deepEqual(
      result.map((reason) => reason.label),
      ["Sin responsable"]
    );
    assert.equal(result[0]?.tone, "warning");
  });

  it("keeps one order and three reasons", () => {
    const value = order({
      id: "PED-0041",
      due_at: new Date("2026-10-07T15:00:00.000Z").toISOString(),
      assigned_team_member_id: null,
      customer_notification_status: "not_notified",
      ready_at: "2026-10-06T10:00:00.000Z",
      status: { is_ready: true, is_closed: false, is_cancelled: false },
    });
    const reviewed = collectReviewOrders([value, { ...value }], madrid);
    assert.equal(reviewed.length, 1);
    assert.deepEqual(
      reviewed[0]?.reasons.map((reason) => reason.label),
      ["Retrasado", "Avisar al cliente", "Sin responsable"]
    );
  });

  it("ignores closed, cancelled, and archived orders", () => {
    const overdue = new Date("2026-10-01T10:00:00.000Z").toISOString();
    const closed = order({
      due_at: overdue,
      assigned_team_member_id: null,
      customer_notification_status: "not_notified",
      status: { is_ready: true, is_closed: true, is_cancelled: false },
    });
    const cancelled = order({
      id: "cancelled",
      due_at: overdue,
      assigned_team_member_id: null,
      status: { is_ready: false, is_closed: false, is_cancelled: true },
    });
    const archived = order({
      id: "archived",
      due_at: overdue,
      archived_at: "2026-10-02T10:00:00.000Z",
      assigned_team_member_id: null,
    });

    assert.deepEqual(codes(closed, madrid), []);
    assert.deepEqual(codes(cancelled, madrid), []);
    assert.deepEqual(codes(archived, madrid), []);
    assert.equal(isOperationalDueToday(closed, madrid), false);
  });

  it("does not treat sticky ready_at as the current ready status", () => {
    const value = order({
      ready_at: "2026-10-01T10:00:00.000Z",
      customer_notification_status: "not_notified",
      due_at: new Date("2026-10-10T15:00:00.000Z").toISOString(),
      status: { is_ready: false, is_closed: false, is_cancelled: false },
    });
    assert.equal(codes(value, madrid).includes("customer_not_notified"), false);
    assert.deepEqual(codes(value, madrid), []);
  });

  it("uses the tenant timezone when it differs from another zone", () => {
    const now = new Date("2026-10-07T16:30:00.000Z");
    const due = new Date("2026-10-07T14:00:00.000Z").toISOString();
    const value = order({
      due_at: due,
      status: { is_ready: false, is_closed: false, is_cancelled: false },
    });

    assert.deepEqual(
      codes(value, { timeZone: "Europe/Madrid", now }),
      ["due_today_pending"]
    );
    assert.deepEqual(
      codes(value, { timeZone: "Asia/Tokyo", now }),
      ["overdue"]
    );
  });

  it("classifies the midnight boundary on the tenant civil day", () => {
    const now = new Date("2026-10-07T22:05:00.000Z");
    const context: ReviewContext = { timeZone: "Europe/Madrid", now };
    const day = getZonedDayBounds(now, context.timeZone);
    assert.equal(day.date, "2026-10-08");

    const before = order({
      id: "before",
      due_at: new Date(day.start.getTime() - 1000).toISOString(),
    });
    const after = order({
      id: "after",
      due_at: new Date(day.start.getTime() + 1000).toISOString(),
    });

    assert.deepEqual(codes(before, context), ["overdue"]);
    assert.deepEqual(codes(after, context), ["due_today_pending"]);
    assert.equal(
      codes(before, context).includes("due_today_pending"),
      false
    );
  });

  it("keeps the civil day across DST transitions", () => {
    const springNow = new Date("2026-03-29T10:00:00.000Z");
    const spring = getZonedDayBounds(springNow, "Europe/Madrid");
    assert.equal(spring.date, "2026-03-29");
    assert.ok(spring.end.getTime() - spring.start.getTime() < 24 * 60 * 60 * 1000);

    const springContext: ReviewContext = {
      timeZone: "Europe/Madrid",
      now: springNow,
    };
    const springInside = order({
      due_at: new Date(spring.end.getTime() - 60_000).toISOString(),
    });
    const springOutside = order({
      due_at: new Date(spring.end.getTime() + 60_000).toISOString(),
    });
    const springBefore = order({
      due_at: new Date(spring.start.getTime() - 60_000).toISOString(),
    });
    assert.equal(codes(springInside, springContext).includes("due_today_pending"), true);
    assert.equal(codes(springInside, springContext).includes("overdue"), false);
    assert.equal(codes(springOutside, springContext).includes("due_today_pending"), false);
    assert.equal(codes(springOutside, springContext).includes("overdue"), false);
    assert.deepEqual(codes(springBefore, springContext), ["overdue"]);

    const autumnNow = new Date("2026-10-25T12:00:00.000Z");
    const autumn = getZonedDayBounds(autumnNow, "Europe/Madrid");
    assert.equal(autumn.date, "2026-10-25");
    assert.ok(autumn.end.getTime() - autumn.start.getTime() > 24 * 60 * 60 * 1000);

    const autumnContext: ReviewContext = {
      timeZone: "Europe/Madrid",
      now: autumnNow,
    };
    const autumnInside = order({
      due_at: new Date(autumn.end.getTime() - 60_000).toISOString(),
    });
    const autumnAfter = order({
      due_at: new Date(autumn.end.getTime() + 60_000).toISOString(),
    });
    assert.equal(codes(autumnInside, autumnContext).includes("due_today_pending"), true);
    assert.equal(codes(autumnInside, autumnContext).includes("overdue"), false);
    assert.equal(codes(autumnAfter, autumnContext).includes("due_today_pending"), false);
    assert.equal(isOperationalDueToday(autumnInside, autumnContext), true);
  });

  it("uses the same unique set for dashboard review and filter=attention", () => {
    const rows = [
      order({
        id: "a",
        due_at: new Date("2026-10-07T12:00:00.000Z").toISOString(),
      }),
      order({
        id: "b",
        due_at: new Date("2026-10-08T16:00:00.000Z").toISOString(),
        status: { is_ready: false, is_closed: false, is_cancelled: false },
      }),
      order({
        id: "c",
        due_at: new Date("2026-10-09T16:00:00.000Z").toISOString(),
        customer_notification_status: "notified",
        status: { is_ready: true, is_closed: false, is_cancelled: false },
      }),
      order({
        id: "d",
        due_at: new Date("2026-10-08T16:00:00.000Z").toISOString(),
        customer_notification_status: "notified",
        status: { is_ready: true, is_closed: false, is_cancelled: false },
      }),
    ];

    const direct = rows
      .filter((row) => classifyOrderReview(row, madrid).length > 0)
      .map((row) => row.id)
      .sort();
    const fetched = rows.filter((row) => matchesReviewCandidateQuery(row, madrid));
    const afterClassify = collectReviewOrders(fetched, madrid).map((row) => row.id);
    const attention = filterReviewOrders(rows, madrid).map((row) => row.id);

    assert.deepEqual(afterClassify.slice().sort(), direct);
    assert.deepEqual(attention.slice().sort(), direct);
    assert.equal(attention.includes("c"), false);
    assert.equal(attention.includes("d"), false);
    assert.equal(NEEDS_ATTENTION_INCLUDES.blocked, false);
    assert.equal(NEEDS_ATTENTION_INCLUDES.ready, false);
  });

  it("intersects attention with store, assignee, and status without duplicating", () => {
    const shared = {
      due_at: new Date("2026-10-07T12:00:00.000Z").toISOString(),
      customer_notification_status: "not_notified" as const,
      assigned_team_member_id: null,
      status: { is_ready: true, is_closed: false, is_cancelled: false },
    };
    const rows = [
      order({ ...shared, id: "a", store_id: "s1", status_id: "st1", assigned_team_member_id: "m1" }),
      order({ ...shared, id: "a", store_id: "s1", status_id: "st1", assigned_team_member_id: "m1" }),
      order({ ...shared, id: "b", store_id: "s2", status_id: "st1", assigned_team_member_id: "m1" }),
      order({ ...shared, id: "d", store_id: "s1", status_id: "st2", assigned_team_member_id: "m1" }),
      order({
        id: "quiet",
        store_id: "s1",
        status_id: "st1",
        assigned_team_member_id: "m1",
        due_at: new Date("2026-10-20T12:00:00.000Z").toISOString(),
        customer_notification_status: "notified",
        status: { is_ready: true, is_closed: false, is_cancelled: false },
      }),
    ];

    const storeIds = filterReviewOrders(rows, madrid, { storeId: "s1" }).map(
      (row) => row.id
    );
    const assigneeIds = filterReviewOrders(rows, madrid, {
      assignedTeamMemberId: "m1",
    }).map((row) => row.id);
    const statusIds = filterReviewOrders(rows, madrid, { statusId: "st2" }).map(
      (row) => row.id
    );
    const combined = filterReviewOrders(rows, madrid, {
      storeId: "s1",
      assignedTeamMemberId: "m1",
      statusId: "st1",
    });

    assert.deepEqual(storeIds, ["a", "d"]);
    assert.deepEqual(assigneeIds, ["a", "b", "d"]);
    assert.deepEqual(statusIds, ["d"]);
    assert.equal(combined.length, 1);
    assert.equal(combined[0]?.id, "a");
    assert.equal(combined[0]?.reasons.length, 2);
    assert.equal(new Set(combined.map((row) => row.id)).size, combined.length);
  });

  it("labels an operational due-today order as HOY and leaves terminal orders plain", () => {
    const due = new Date("2026-10-08T15:00:00.000Z").toISOString();
    const today = formatTenantDueLabel(due, "Europe/Madrid", "2026-10-08", true);
    assert.match(today.label, /^HOY · /);
    assert.equal(today.indicator, "Entrega hoy");
    assert.equal(today.overdue, false);

    const closed = formatTenantDueLabel(due, "Europe/Madrid", "2026-10-08", false);
    assert.equal(closed.dueToday, false);
    assert.equal(closed.indicator, null);

    const late = formatTenantDueLabel(
      new Date("2026-10-07T15:00:00.000Z").toISOString(),
      "Europe/Madrid",
      "2026-10-08",
      true
    );
    assert.equal(late.dueToday, false);
    assert.equal(late.overdue, true);
  });
});

describe("review surfaces share one definition", () => {
  it("dashboard and orders attention both load the shared review set", () => {
    const dashboard = readFileSync(
      path.join(root, "app/api/dashboard/route.ts"),
      "utf8"
    );
    const orders = readFileSync(path.join(root, "app/api/orders/route.ts"), "utf8");
    const screen = readFileSync(
      path.join(root, "components/dashboard/tenant-dashboard.tsx"),
      "utf8"
    );

    assert.match(dashboard, /loadOperationalReviewOrders/);
    assert.match(orders, /loadOperationalReviewOrders/);
    assert.match(dashboard, /NEEDS_ATTENTION_INCLUDES/);
    assert.doesNotMatch(dashboard, /ready:\s*true/);
    assert.doesNotMatch(
      orders,
      /effectiveFilter === "attention"[\s\S]{0,160}\.eq\(\s*"status\.is_ready"/
    );

    const reviewAt = screen.indexOf("Requieren revisión");
    const quotesAt = screen.indexOf("Presupuestos");
    const upcomingAt = screen.indexOf("Próximas entregas");
    assert.ok(reviewAt >= 0);
    assert.ok(reviewAt < quotesAt);
    assert.ok(quotesAt < upcomingAt);
    assert.match(screen, /Pedidos que requieren una acción antes de continuar\./);
    assert.match(screen, /No hay pedidos que requieran revisión\./);
    assert.match(screen, /lg:grid-cols-2/);
    assert.doesNotMatch(screen, /Necesitan atención/);
    assert.match(screen, /formatDueTime\(order\.due_at, timeZone\)/);
  });
});
