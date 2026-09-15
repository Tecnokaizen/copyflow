import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  belongsToCounterTenant,
  groupCounterBuckets,
  isNotifyPendingCounterOrder,
  isReadyCounterOrder,
  isUpcomingCounterOrder,
  isUrgentCounterOrder,
  mapCounterOrderRow,
  matchesCounterSearch,
  normalizeCounterQuery,
  type CounterOrder,
} from "./counter";

const TIME_ZONE = "Europe/Madrid";
const TODAY = "2026-09-15";

function order(overrides: Partial<CounterOrder> = {}): CounterOrder {
  return {
    id: "order-1",
    tenant_id: "tenant-a",
    reference: "PED-1",
    title: "Tarjetas",
    priority: "normal",
    due_at: "2026-09-15T16:00:00.000Z",
    delivered_at: null,
    ready_at: null,
    customer_notification_status: "not_notified",
    client_name: "Acme",
    service_name: "Copias",
    store_name: "Centro",
    assignee_name: "Ana",
    status: {
      name: "En producción",
      is_ready: false,
      is_closed: false,
      is_cancelled: false,
    },
    ...overrides,
  };
}

describe("counter buckets", () => {
  it("puts active urgent orders in Urgentes even if they are also ready", () => {
    const urgentReady = order({
      id: "urgent-ready",
      priority: "urgent",
      status: {
        name: "Listo",
        is_ready: true,
        is_closed: false,
        is_cancelled: false,
      },
    });

    assert.equal(isUrgentCounterOrder(urgentReady), true);
    assert.equal(isReadyCounterOrder(urgentReady), true);

    const buckets = groupCounterBuckets([urgentReady], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    const urgent = buckets.find((bucket) => bucket.id === "urgent");
    const ready = buckets.find((bucket) => bucket.id === "ready");
    assert.equal(urgent?.count, 1);
    assert.equal(ready?.count, 1);
  });

  it("excludes closed, cancelled and delivered orders from every bucket", () => {
    const closed = order({
      id: "closed",
      priority: "urgent",
      status: {
        name: "Entregado",
        is_ready: true,
        is_closed: true,
        is_cancelled: false,
      },
    });
    const cancelled = order({
      id: "cancelled",
      priority: "urgent",
      status: {
        name: "Cancelado",
        is_ready: false,
        is_closed: false,
        is_cancelled: true,
      },
    });
    const delivered = order({
      id: "delivered",
      priority: "urgent",
      delivered_at: "2026-09-14T10:00:00.000Z",
      status: {
        name: "Listo",
        is_ready: true,
        is_closed: false,
        is_cancelled: false,
      },
    });

    const buckets = groupCounterBuckets([closed, cancelled, delivered], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    for (const bucket of buckets) {
      assert.equal(bucket.count, 0, bucket.id);
    }
  });

  it("lists ready undelivered orders and pending notifications as a subset", () => {
    const readyUnnotified = order({
      id: "ready-unnotified",
      customer_notification_status: null,
      status: {
        name: "Listo",
        is_ready: true,
        is_closed: false,
        is_cancelled: false,
      },
    });
    const readyNotified = order({
      id: "ready-notified",
      customer_notification_status: "notified",
      status: {
        name: "Listo",
        is_ready: true,
        is_closed: false,
        is_cancelled: false,
      },
    });

    assert.equal(isReadyCounterOrder(readyUnnotified), true);
    assert.equal(isNotifyPendingCounterOrder(readyUnnotified), true);
    assert.equal(isReadyCounterOrder(readyNotified), true);
    assert.equal(isNotifyPendingCounterOrder(readyNotified), false);

    const buckets = groupCounterBuckets([readyUnnotified, readyNotified], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(
      buckets.find((bucket) => bucket.id === "ready")?.count,
      2
    );
    assert.equal(
      buckets.find((bucket) => bucket.id === "notify_pending")?.count,
      1
    );
  });

  it("classifies upcoming deliveries with the tenant civil date, not UTC", () => {
    const lateUtc = order({
      id: "late-utc",
      due_at: "2026-09-14T22:30:00.000Z",
    });
    const overdue = order({
      id: "overdue",
      due_at: "2026-09-14T10:00:00.000Z",
    });
    const noDue = order({ id: "no-due", due_at: null });

    assert.equal(isUpcomingCounterOrder(lateUtc, TODAY, TIME_ZONE), true);
    assert.equal(isUpcomingCounterOrder(overdue, TODAY, TIME_ZONE), false);
    assert.equal(isUpcomingCounterOrder(noDue, TODAY, TIME_ZONE), false);
  });

  it("previews at most 8 orders per bucket while keeping the full count", () => {
    const orders = Array.from({ length: 10 }, (_, index) =>
      order({
        id: `urgent-${index}`,
        reference: `PED-${index}`,
        priority: "urgent",
      })
    );
    const buckets = groupCounterBuckets(orders, {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    const urgent = buckets.find((bucket) => bucket.id === "urgent");
    assert.equal(urgent?.count, 10);
    assert.equal(urgent?.orders.length, 8);
  });
});

describe("counter search and tenant isolation", () => {
  it("matches reference, title and client name, but not service", () => {
    const row = order();
    assert.equal(matchesCounterSearch(row, "ped-1"), true);
    assert.equal(matchesCounterSearch(row, "tarjetas"), true);
    assert.equal(matchesCounterSearch(row, "acme"), true);
    assert.equal(matchesCounterSearch(row, "copias"), false);
    assert.equal(matchesCounterSearch(row, ""), true);
  });

  it("drops orders from another tenant", () => {
    const local = order({ tenant_id: "tenant-a" });
    const foreign = order({ id: "foreign", tenant_id: "tenant-b" });
    assert.equal(belongsToCounterTenant(local, "tenant-a"), true);
    assert.equal(belongsToCounterTenant(foreign, "tenant-a"), false);
  });

  it("clips the search query", () => {
    assert.equal(normalizeCounterQuery("  hola  "), "hola");
    assert.equal(normalizeCounterQuery("x".repeat(90)).length, 80);
    assert.equal(normalizeCounterQuery(null), "");
  });
});

describe("mapCounterOrderRow", () => {
  it("maps joined names and notification status", () => {
    const mapped = mapCounterOrderRow({
      id: "order-1",
      tenant_id: "tenant-a",
      reference: "PED-1",
      title: "Tarjetas",
      priority: "urgent",
      due_at: "2026-09-15T16:00:00.000Z",
      delivered_at: null,
      ready_at: null,
      customer_notification_status: "not_notified",
      client: { name: "Acme" },
      service: { name: "Copias" },
      store: { name: "Centro" },
      assigned_team_member: { name: "Ana" },
      status: {
        name: "Listo",
        is_ready: true,
        is_closed: false,
        is_cancelled: false,
      },
    });

    assert.equal(mapped?.client_name, "Acme");
    assert.equal(mapped?.assignee_name, "Ana");
    assert.equal(mapped?.status?.is_ready, true);
    assert.equal(mapCounterOrderRow({ title: "x" }), null);
  });
});
