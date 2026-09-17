import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  belongsToCounterTenant,
  COUNTER_BUCKETS,
  COUNTER_VIEW_STORAGE_KEY,
  counterEmptyState,
  filterOrdersForCounter,
  groupCounterBuckets,
  hasActiveCounterFilters,
  isNotifyPendingCounterOrder,
  isOtherActiveCounterOrder,
  isOverdueCounterOrder,
  isReadyCounterOrder,
  isUpcomingCounterOrder,
  isUrgentCounterOrder,
  mapCounterOrderRow,
  matchesCounterSearch,
  normalizeCounterQuery,
  parseCounterFilterParams,
  parseCounterViewMode,
  readStoredCounterView,
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
    archived_at: null,
    ready_at: null,
    customer_notification_status: "not_notified",
    client_name: "Acme",
    service_name: "Copias",
    store_name: "Centro",
    assignee_name: "Ana",
    store_id: "store-1",
    assignee_id: "member-ana",
    service_id: "service-1",
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
  it("orders attention buckets with Retrasados first and leftover Otros activos last", () => {
    assert.deepEqual(
      COUNTER_BUCKETS.map((bucket) => bucket.id),
      [
        "overdue",
        "urgent",
        "ready",
        "notify_pending",
        "upcoming",
        "other_active",
      ]
    );
    assert.deepEqual(
      COUNTER_BUCKETS.map((bucket) => bucket.label),
      [
        "Retrasados",
        "Urgentes",
        "Listos para entregar",
        "Pendientes de avisar",
        "Entregas próximas",
        "Otros activos",
      ]
    );
  });

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

  it("excludes closed, cancelled and archived orders from every bucket", () => {
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
    const archived = order({
      id: "archived",
      priority: "urgent",
      archived_at: "2026-09-14T10:00:00.000Z",
      status: {
        name: "Listo",
        is_ready: true,
        is_closed: false,
        is_cancelled: false,
      },
    });

    const buckets = groupCounterBuckets([closed, cancelled, archived], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    for (const bucket of buckets) {
      assert.equal(bucket.count, 0, bucket.id);
    }
  });

  it("keeps inconsistent delivered_at (non-terminal, not archived) operational", () => {
    const inconsistent = order({
      id: "inconsistent-delivered",
      priority: "urgent",
      delivered_at: "2026-09-14T10:00:00.000Z",
      archived_at: null,
      status: {
        name: "Listo",
        is_ready: true,
        is_closed: false,
        is_cancelled: false,
      },
    });

    assert.equal(isUrgentCounterOrder(inconsistent), true);
    assert.equal(isReadyCounterOrder(inconsistent), true);

    const buckets = groupCounterBuckets([inconsistent], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(buckets.find((bucket) => bucket.id === "urgent")?.count, 1);
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
      archived_at: null,
      ready_at: null,
      customer_notification_status: "not_notified",
      store_id: "store-1",
      assigned_team_member_id: "member-1",
      service_id: "service-1",
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
    assert.equal(mapped?.archived_at, null);
    assert.equal(mapped?.assignee_name, "Ana");
    assert.equal(mapped?.status?.is_ready, true);
    assert.equal(mapped?.store_id, "store-1");
    assert.equal(mapped?.assignee_id, "member-1");
    assert.equal(mapped?.service_id, "service-1");
    assert.equal(mapCounterOrderRow({ title: "x" }), null);
  });
});

describe("counter filter composition", () => {
  const ana = order({
    id: "ana-centro",
    store_id: "store-centro",
    assignee_id: "member-ana",
    service_id: "service-copias",
    priority: "urgent",
  });
  const luis = order({
    id: "luis-norte",
    store_id: "store-norte",
    assignee_id: "member-luis",
    service_id: "service-plot",
    priority: "high",
    title: "Plotter",
  });
  const unassigned = order({
    id: "unassigned",
    store_id: "store-centro",
    assignee_id: null,
    service_id: "service-copias",
    priority: "normal",
  });

  it("applies mine + store + assignee + service + priority before grouping", () => {
    const filtered = filterOrdersForCounter([ana, luis, unassigned], {
      tenantId: "tenant-a",
      query: "",
      mine: true,
      currentTeamMemberId: "member-ana",
      storeId: "store-centro",
      assigneeId: "member-ana",
      serviceId: "service-copias",
      priority: "urgent",
    });

    assert.deepEqual(
      filtered.map((row) => row.id),
      ["ana-centro"]
    );

    const buckets = groupCounterBuckets(filtered, {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(buckets.find((bucket) => bucket.id === "urgent")?.count, 1);
    assert.equal(buckets.find((bucket) => bucket.id === "ready")?.count, 0);
  });

  it("mine matches only the session team_member id, never by name", () => {
    const sameName = order({
      id: "impostor",
      assignee_id: "member-other",
      assignee_name: "Ana",
    });
    const filtered = filterOrdersForCounter([ana, sameName], {
      tenantId: "tenant-a",
      query: "",
      mine: true,
      currentTeamMemberId: "member-ana",
    });

    assert.deepEqual(
      filtered.map((row) => row.id),
      ["ana-centro"]
    );
  });

  it("mine with no session team_member yields no orders", () => {
    const filtered = filterOrdersForCounter([ana, luis], {
      tenantId: "tenant-a",
      query: "",
      mine: true,
      currentTeamMemberId: null,
    });
    assert.deepEqual(filtered, []);
  });

  it("keeps tenant isolation while composing filters", () => {
    const foreign = order({
      id: "foreign",
      tenant_id: "tenant-b",
      store_id: "store-centro",
      assignee_id: "member-ana",
      service_id: "service-copias",
      priority: "urgent",
    });
    const filtered = filterOrdersForCounter([ana, foreign], {
      tenantId: "tenant-a",
      query: "",
      storeId: "store-centro",
      priority: "urgent",
    });
    assert.deepEqual(
      filtered.map((row) => row.id),
      ["ana-centro"]
    );
  });
});

describe("counter filter params and view mode", () => {
  it("parses mine, uuids and known priorities from the query string", () => {
    const parsed = parseCounterFilterParams(
      new URLSearchParams(
        "mine=1&store_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&assignee_id=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb&service_id=cccccccc-cccc-4ccc-8ccc-cccccccccccc&priority=high&q=acme"
      )
    );

    assert.equal(parsed.mine, true);
    assert.equal(parsed.storeId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(parsed.assigneeId, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    assert.equal(parsed.serviceId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    assert.equal(parsed.priority, "high");
    assert.equal(parsed.query, "acme");
  });

  it("ignores invalid uuids and unknown priorities instead of matching them", () => {
    const parsed = parseCounterFilterParams(
      new URLSearchParams("store_id=not-a-uuid&priority=critical&mine=yes")
    );

    assert.equal(parsed.storeId, null);
    assert.equal(parsed.priority, null);
    assert.equal(parsed.mine, false);
  });

  it("treats mine=1 as an active filter", () => {
    assert.equal(hasActiveCounterFilters({ mine: true }), true);
    assert.equal(hasActiveCounterFilters({ storeId: "store-1" }), true);
    assert.equal(hasActiveCounterFilters({}), false);
    assert.equal(hasActiveCounterFilters({ query: "acme" }), false);
  });

  it("parses list/grid view and reads localStorage without a database", () => {
    assert.equal(parseCounterViewMode("grid"), "grid");
    assert.equal(parseCounterViewMode("list"), "list");
    assert.equal(parseCounterViewMode("cards"), "list");
    assert.equal(parseCounterViewMode(null), "list");

    const storage = {
      getItem(key: string) {
        assert.equal(key, COUNTER_VIEW_STORAGE_KEY);
        return "grid";
      },
    };
    assert.equal(readStoredCounterView(storage), "grid");
    assert.equal(readStoredCounterView(null), "list");
  });
});

describe("overdue classification", () => {
  it("marks an active past due date as overdue in the tenant civil day", () => {
    const overdue = order({
      id: "overdue",
      due_at: "2026-09-14T10:00:00.000Z",
    });
    const dueTodayLateUtc = order({
      id: "late-utc",
      due_at: "2026-09-14T22:30:00.000Z",
    });
    const closedPastDue = order({
      id: "closed-past-due",
      due_at: "2026-09-14T10:00:00.000Z",
      status: {
        name: "Entregado",
        is_ready: true,
        is_closed: true,
        is_cancelled: false,
      },
    });
    const inconsistentDelivered = order({
      id: "inconsistent-delivered",
      due_at: "2026-09-14T10:00:00.000Z",
      delivered_at: "2026-09-14T12:00:00.000Z",
      archived_at: null,
    });

    assert.equal(isOverdueCounterOrder(overdue, TODAY, TIME_ZONE), true);
    assert.equal(isOverdueCounterOrder(dueTodayLateUtc, TODAY, TIME_ZONE), false);
    assert.equal(isOverdueCounterOrder(closedPastDue, TODAY, TIME_ZONE), false);
    assert.equal(
      isOverdueCounterOrder(inconsistentDelivered, TODAY, TIME_ZONE),
      true
    );
  });

  it("puts active past-due high and normal orders in Retrasados", () => {
    const high = order({
      id: "overdue-high",
      priority: "high",
      due_at: "2026-09-14T10:00:00.000Z",
    });
    const normal = order({
      id: "overdue-normal",
      priority: "normal",
      due_at: "2026-09-14T08:00:00.000Z",
    });

    assert.equal(isOverdueCounterOrder(high, TODAY, TIME_ZONE), true);
    assert.equal(isOverdueCounterOrder(normal, TODAY, TIME_ZONE), true);

    const buckets = groupCounterBuckets([high, normal], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    const overdueIds = buckets
      .find((bucket) => bucket.id === "overdue")
      ?.orders.map((row) => row.id);
    assert.deepEqual(overdueIds, ["overdue-high", "overdue-normal"]);
    assert.equal(buckets.find((bucket) => bucket.id === "upcoming")?.count, 0);
  });

  it("keeps overdue + urgent in both Retrasados and Urgentes", () => {
    const overdueUrgent = order({
      id: "overdue-urgent",
      priority: "urgent",
      due_at: "2026-09-14T10:00:00.000Z",
    });

    const buckets = groupCounterBuckets([overdueUrgent], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(buckets.find((bucket) => bucket.id === "overdue")?.count, 1);
    assert.equal(buckets.find((bucket) => bucket.id === "urgent")?.count, 1);
    assert.equal(isUrgentCounterOrder(overdueUrgent), true);
  });

  it("keeps upcoming exclusive of overdue civil dates", () => {
    const overdue = order({
      id: "overdue",
      due_at: "2026-09-14T10:00:00.000Z",
    });
    const upcoming = order({
      id: "upcoming",
      due_at: "2026-09-16T10:00:00.000Z",
    });

    assert.equal(isUpcomingCounterOrder(overdue, TODAY, TIME_ZONE), false);
    assert.equal(isUpcomingCounterOrder(upcoming, TODAY, TIME_ZONE), true);

    const buckets = groupCounterBuckets([overdue, upcoming], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.deepEqual(
      buckets.find((bucket) => bucket.id === "overdue")?.orders.map((row) => row.id),
      ["overdue"]
    );
    assert.deepEqual(
      buckets
        .find((bucket) => bucket.id === "upcoming")
        ?.orders.map((row) => row.id),
      ["upcoming"]
    );
  });
});

describe("counter leftover other_active", () => {
  it("places leftover active orders without due date only in Otros activos", () => {
    const leftover = order({
      id: "no-due",
      due_at: null,
      priority: "normal",
    });

    assert.equal(isOtherActiveCounterOrder(leftover, TODAY, TIME_ZONE), true);
    assert.equal(isOverdueCounterOrder(leftover, TODAY, TIME_ZONE), false);
    assert.equal(isUrgentCounterOrder(leftover), false);
    assert.equal(isReadyCounterOrder(leftover), false);
    assert.equal(isUpcomingCounterOrder(leftover, TODAY, TIME_ZONE), false);

    const buckets = groupCounterBuckets([leftover], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(buckets.find((bucket) => bucket.id === "other_active")?.count, 1);
    assert.equal(buckets.find((bucket) => bucket.id === "overdue")?.count, 0);
    assert.equal(buckets.find((bucket) => bucket.id === "urgent")?.count, 0);
    assert.equal(buckets.find((bucket) => bucket.id === "ready")?.count, 0);
    assert.equal(buckets.find((bucket) => bucket.id === "notify_pending")?.count, 0);
    assert.equal(buckets.find((bucket) => bucket.id === "upcoming")?.count, 0);
  });

  it("does not duplicate classified orders into Otros activos", () => {
    const overdue = order({
      id: "overdue",
      due_at: "2026-09-14T10:00:00.000Z",
    });
    const urgent = order({ id: "urgent", priority: "urgent" });
    const ready = order({
      id: "ready",
      status: {
        name: "Listo",
        is_ready: true,
        is_closed: false,
        is_cancelled: false,
      },
    });
    const leftover = order({ id: "leftover", due_at: null });

    assert.equal(isOtherActiveCounterOrder(overdue, TODAY, TIME_ZONE), false);
    assert.equal(isOtherActiveCounterOrder(urgent, TODAY, TIME_ZONE), false);
    assert.equal(isOtherActiveCounterOrder(ready, TODAY, TIME_ZONE), false);
    assert.equal(isOtherActiveCounterOrder(leftover, TODAY, TIME_ZONE), true);

    const buckets = groupCounterBuckets([overdue, urgent, ready, leftover], {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.deepEqual(
      buckets
        .find((bucket) => bucket.id === "other_active")
        ?.orders.map((row) => row.id),
      ["leftover"]
    );
  });
});

describe("counter empty state copy", () => {
  it("never claims filters matched nothing when filtered orders exist", () => {
    assert.equal(
      counterEmptyState({
        filteredCount: 5,
        bucketVisibleCount: 0,
        filtersActive: true,
      }),
      null
    );
    assert.equal(
      counterEmptyState({
        filteredCount: 5,
        bucketVisibleCount: 5,
        filtersActive: true,
      }),
      null
    );
    assert.equal(
      counterEmptyState({
        filteredCount: 0,
        bucketVisibleCount: 0,
        filtersActive: true,
      }),
      "Ningún pedido coincide con los filtros."
    );
    assert.equal(
      counterEmptyState({
        filteredCount: 0,
        bucketVisibleCount: 0,
        filtersActive: false,
      }),
      "No hay pedidos en el mostrador ahora mismo."
    );
  });
});

describe("overdue visibility through id filters", () => {
  const claraOverdue = Array.from({ length: 5 }, (_, index) =>
    order({
      id: `clara-overdue-${index}`,
      assignee_id: "member-clara",
      assignee_name: "Clara Ruiz",
      store_id: index < 3 ? "store-centro" : "store-norte",
      priority: index < 2 ? "high" : "normal",
      due_at: "2026-09-14T10:00:00.000Z",
    })
  );
  const otherOverdue = order({
    id: "luis-overdue",
    assignee_id: "member-luis",
    assignee_name: "Luis",
    store_id: "store-norte",
    priority: "high",
    due_at: "2026-09-14T09:00:00.000Z",
  });
  const claraUpcoming = order({
    id: "clara-upcoming",
    assignee_id: "member-clara",
    assignee_name: "Clara Ruiz",
    store_id: "store-centro",
    priority: "normal",
    due_at: "2026-09-16T10:00:00.000Z",
  });

  it("keeps overdue visible with assignee id filter and matching overdue count", () => {
    const filtered = filterOrdersForCounter(
      [...claraOverdue, otherOverdue, claraUpcoming],
      {
        tenantId: "tenant-a",
        query: "",
        assigneeId: "member-clara",
      }
    );
    assert.equal(filtered.length, 6);

    const buckets = groupCounterBuckets(filtered, {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(buckets.find((bucket) => bucket.id === "overdue")?.count, 5);
    assert.equal(
      counterEmptyState({
        filteredCount: filtered.length,
        bucketVisibleCount: buckets.reduce((sum, bucket) => sum + bucket.count, 0),
        filtersActive: true,
      }),
      null
    );
  });

  it("keeps overdue visible with mine matching the session team_member id", () => {
    const impostor = order({
      id: "impostor-overdue",
      assignee_id: "member-other",
      assignee_name: "Clara Ruiz",
      due_at: "2026-09-14T10:00:00.000Z",
    });
    const filtered = filterOrdersForCounter([...claraOverdue, impostor], {
      tenantId: "tenant-a",
      query: "",
      mine: true,
      currentTeamMemberId: "member-clara",
    });

    assert.equal(filtered.length, 5);
    assert.equal(
      filtered.every((row) => row.assignee_id === "member-clara"),
      true
    );

    const buckets = groupCounterBuckets(filtered, {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(buckets.find((bucket) => bucket.id === "overdue")?.count, 5);
  });

  it("narrows assignee overdue by high priority without dropping the rest from identity match", () => {
    const byAssignee = filterOrdersForCounter([...claraOverdue, otherOverdue], {
      tenantId: "tenant-a",
      query: "",
      assigneeId: "member-clara",
    });
    const byAssigneeHigh = filterOrdersForCounter(
      [...claraOverdue, otherOverdue],
      {
        tenantId: "tenant-a",
        query: "",
        assigneeId: "member-clara",
        priority: "high",
      }
    );

    assert.equal(byAssignee.length, 5);
    assert.equal(byAssigneeHigh.length, 2);
    assert.equal(
      byAssigneeHigh.every((row) => row.priority === "high"),
      true
    );

    const buckets = groupCounterBuckets(byAssigneeHigh, {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(buckets.find((bucket) => bucket.id === "overdue")?.count, 2);
  });

  it("narrows assignee overdue by store id", () => {
    const filtered = filterOrdersForCounter([...claraOverdue, otherOverdue], {
      tenantId: "tenant-a",
      query: "",
      assigneeId: "member-clara",
      storeId: "store-centro",
    });

    assert.equal(filtered.length, 3);
    assert.equal(
      filtered.every((row) => row.store_id === "store-centro"),
      true
    );
    const buckets = groupCounterBuckets(filtered, {
      todayCivil: TODAY,
      timeZone: TIME_ZONE,
    });
    assert.equal(buckets.find((bucket) => bucket.id === "overdue")?.count, 3);
  });

  it("restores the full tenant counter when filters are cleared", () => {
    const allRows = [...claraOverdue, otherOverdue, claraUpcoming];
    const filtered = filterOrdersForCounter(allRows, {
      tenantId: "tenant-a",
      query: "",
      assigneeId: "member-clara",
      storeId: "store-centro",
      priority: "high",
    });
    const cleared = filterOrdersForCounter(allRows, {
      tenantId: "tenant-a",
      query: "",
    });

    assert.equal(filtered.length, 2);
    assert.equal(cleared.length, 7);
    assert.deepEqual(
      cleared.map((row) => row.id).sort(),
      allRows.map((row) => row.id).sort()
    );
  });

  it("keeps tenant isolation when overdue orders share an assignee id", () => {
    const foreign = order({
      id: "foreign-overdue",
      tenant_id: "tenant-b",
      assignee_id: "member-clara",
      due_at: "2026-09-14T10:00:00.000Z",
    });
    const filtered = filterOrdersForCounter([...claraOverdue, foreign], {
      tenantId: "tenant-a",
      query: "",
      assigneeId: "member-clara",
    });

    assert.equal(filtered.length, 5);
    assert.equal(
      filtered.every((row) => row.tenant_id === "tenant-a"),
      true
    );
  });
});
