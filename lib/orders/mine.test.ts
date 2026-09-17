import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyMineOrder,
  filterOrdersForMine,
  groupMyOrdersQueue,
  mapMineOrderRow,
  resolveMineQueryScope,
  type MineOrder,
} from "./mine";

const MEMBER_A = "member-a";
const MEMBER_B = "member-b";
const TIME_ZONE = "Europe/Madrid";
const NOW = new Date("2026-09-14T10:00:00.000Z");

function order(overrides: Partial<MineOrder> = {}): MineOrder {
  return {
    id: "order-1",
    reference: "PED-1",
    title: "Tarjetas",
    priority: "normal",
    due_at: null,
    delivered_at: null,
    archived_at: null,
    ready_at: null,
    assigned_team_member_id: MEMBER_A,
    client_name: "Cliente",
    service_name: "Copias",
    store_name: null,
    status: {
      name: "En producción",
      code: "in_progress",
      is_ready: false,
      is_closed: false,
      is_cancelled: false,
    },
    ...overrides,
  };
}

describe("resolveMineQueryScope", () => {
  it("uses the session team_member and tenant, ignoring client IDs", () => {
    const scope = resolveMineQueryScope({
      tenantId: "tenant-a",
      sessionTeamMemberId: MEMBER_A,
      requestedAssigneeId: MEMBER_B,
      requestedTenantId: "tenant-b",
    });

    assert.deepEqual(scope, {
      tenantId: "tenant-a",
      assignedTeamMemberId: MEMBER_A,
    });
  });

  it("returns a null assignee when the session user is not linked", () => {
    const scope = resolveMineQueryScope({
      tenantId: "tenant-a",
      sessionTeamMemberId: null,
      requestedAssigneeId: MEMBER_A,
    });

    assert.equal(scope.assignedTeamMemberId, null);
    assert.equal(scope.tenantId, "tenant-a");
  });

  it("resolves the same way for staff, manager, admin and owner", () => {
    const roles = ["staff", "manager", "admin", "owner"] as const;
    assert.equal(roles.length, 4);

    const scope = resolveMineQueryScope({
      tenantId: "tenant-a",
      sessionTeamMemberId: MEMBER_A,
      requestedAssigneeId: MEMBER_B,
    });
    assert.equal(scope.assignedTeamMemberId, MEMBER_A);
  });
});

describe("filterOrdersForMine", () => {
  it("keeps only orders assigned to the session team_member", () => {
    const mine = filterOrdersForMine(
      [
        order({ id: "own", assigned_team_member_id: MEMBER_A }),
        order({ id: "other", assigned_team_member_id: MEMBER_B }),
        order({ id: "unassigned", assigned_team_member_id: null }),
      ],
      MEMBER_A
    );

    assert.deepEqual(
      mine.map((item) => item.id),
      ["own"]
    );
  });
});

describe("classifyMineOrder", () => {
  it("classifies urgent before overdue", () => {
    const section = classifyMineOrder(
      order({
        priority: "urgent",
        due_at: "2026-09-10T10:00:00.000Z",
      }),
      "2026-09-14",
      TIME_ZONE
    );
    assert.equal(section, "urgent");
  });

  it("classifies overdue, due today, ready and remaining active", () => {
    assert.equal(
      classifyMineOrder(
        order({ due_at: "2026-09-13T10:00:00.000Z" }),
        "2026-09-14",
        TIME_ZONE
      ),
      "overdue"
    );
    assert.equal(
      classifyMineOrder(
        order({ due_at: "2026-09-14T16:00:00.000Z" }),
        "2026-09-14",
        TIME_ZONE
      ),
      "due_today"
    );
    assert.equal(
      classifyMineOrder(
        order({
          status: {
            name: "Listo",
            code: "ready",
            is_ready: true,
            is_closed: false,
            is_cancelled: false,
          },
        }),
        "2026-09-14",
        TIME_ZONE
      ),
      "ready"
    );
    assert.equal(
      classifyMineOrder(order(), "2026-09-14", TIME_ZONE),
      "active"
    );
  });

  it("drops closed, cancelled or archived orders", () => {
    assert.equal(
      classifyMineOrder(
        order({
          status: {
            name: "Cerrado",
            code: "closed",
            is_ready: false,
            is_closed: true,
            is_cancelled: false,
          },
        }),
        "2026-09-14",
        TIME_ZONE
      ),
      null
    );
    assert.equal(
      classifyMineOrder(
        order({
          status: {
            name: "Cancelado",
            code: "cancelled",
            is_ready: false,
            is_closed: false,
            is_cancelled: true,
          },
        }),
        "2026-09-14",
        TIME_ZONE
      ),
      null
    );
    assert.equal(
      classifyMineOrder(
        order({ archived_at: "2026-09-14T10:00:00.000Z" }),
        "2026-09-14",
        TIME_ZONE
      ),
      null
    );
  });

  it("keeps inconsistent delivered_at without terminal/archive as active", () => {
    assert.equal(
      classifyMineOrder(
        order({
          delivered_at: "2026-09-14T10:00:00.000Z",
          archived_at: null,
          status: {
            name: "Listo",
            code: "ready",
            is_ready: true,
            is_closed: false,
            is_cancelled: false,
          },
        }),
        "2026-09-14",
        TIME_ZONE
      ),
      "ready"
    );
  });
});

describe("groupMyOrdersQueue", () => {
  it("builds an operational queue and excludes other assignees", () => {
    const sections = groupMyOrdersQueue(
      [
        order({
          id: "urgent",
          reference: "PED-U",
          title: "Urgente",
          priority: "urgent",
        }),
        order({
          id: "late",
          reference: "PED-R",
          title: "Retrasado",
          due_at: "2026-09-10T08:00:00.000Z",
        }),
        order({
          id: "today",
          reference: "PED-H",
          title: "Hoy",
          due_at: "2026-09-14T15:00:00.000Z",
        }),
        order({
          id: "ready",
          reference: "PED-L",
          title: "Listo",
          status: {
            name: "Listo",
            code: "ready",
            is_ready: true,
            is_closed: false,
            is_cancelled: false,
          },
        }),
        order({
          id: "rest",
          reference: "PED-A",
          title: "Activo",
        }),
        order({
          id: "foreign",
          reference: "PED-X",
          title: "De otro",
          priority: "urgent",
          assigned_team_member_id: MEMBER_B,
        }),
      ],
      { now: NOW, timeZone: TIME_ZONE, assignedTeamMemberId: MEMBER_A }
    );

    assert.deepEqual(
      sections.map((section) => [
        section.id,
        section.orders.map((item) => item.id),
      ]),
      [
        ["urgent", ["urgent"]],
        ["overdue", ["late"]],
        ["due_today", ["today"]],
        ["ready", ["ready"]],
        ["active", ["rest"]],
      ]
    );
  });
});

describe("mapMineOrderRow", () => {
  it("maps nested client/service/status names", () => {
    const mapped = mapMineOrderRow({
      id: "order-1",
      reference: "PED-1",
      title: "Tarjetas",
      priority: "high",
      due_at: "2026-09-14T10:00:00.000Z",
      assigned_team_member_id: MEMBER_A,
      client: { name: "Acme" },
      service: { name: "Plotter" },
      store: { name: "Sur 4 Colores 1" },
      status: {
        name: "En curso",
        code: "in_progress",
        is_ready: false,
        is_closed: false,
        is_cancelled: false,
      },
    });

    assert.equal(mapped?.client_name, "Acme");
    assert.equal(mapped?.service_name, "Plotter");
    assert.equal(mapped?.store_name, "Sur 4 Colores 1");
    assert.equal(mapped?.assigned_team_member_id, MEMBER_A);
  });

  it("keeps store_name empty when the order has no store", () => {
    const mapped = mapMineOrderRow({
      id: "order-2",
      reference: "PED-2",
      title: "Folletos",
      assigned_team_member_id: MEMBER_A,
    });

    assert.equal(mapped?.store_name, null);
  });
});
