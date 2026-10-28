import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { groupMyOrdersQueue, type MineOrder } from "@/lib/orders/mine";
import {
  applyWorkTurnFilters,
  attachWorkTurn,
  bucketMineTurnOrders,
  firstName,
  groupMineSections,
  isMineOrder,
  loadWorkSequenceEnabled,
  mergeRowsById,
  MINE_TURN_BUCKETS,
  mineTurnFlags,
  myTurnLabel,
  summarizeWorkSteps,
  withWorkTurnSelect,
  WORK_STEPS_EMBED,
  workTurnArrowLabel,
  workTurnCompactLabel,
  workTurnTitle,
  type MineTurnOrder,
} from "@/lib/orders/work-turn";

const TAMARA = "00000000-0000-4000-8000-0000000000a1";
const JESUS = "00000000-0000-4000-8000-0000000000a2";
const RAQUEL = "00000000-0000-4000-8000-0000000000a3";
const DAVINIA = "00000000-0000-4000-8000-0000000000a4";
const NOW = new Date("2026-10-28T10:00:00.000Z");
const TIME_ZONE = "Europe/Madrid";

type StepInput = {
  position: number;
  done?: boolean;
  current?: boolean;
  member?: string | null;
  name?: string;
  active?: boolean;
  stage?: string;
  icon?: string;
};

function step(input: StepInput) {
  const member = input.member === undefined ? RAQUEL : input.member;
  return {
    position: input.position,
    is_current: input.current === true,
    completed_at: input.done ? "2026-10-28T08:00:00.000Z" : null,
    team_member_id: member,
    stage: { name: input.stage ?? "Preparación", icon: input.icon ?? "prepare" },
    team_member: member
      ? { id: member, name: input.name ?? "Raquel Gómez", active: input.active ?? true }
      : null,
  };
}

// SUR4-0106 (f1 §3): Diseño (Jesús, hecho) → Preparación (Raquel, le toca) → Impresión (Davinia).
const SUR4_0106 = [
  step({ position: 1, done: true, member: JESUS, name: "Jesús Pérez", stage: "Diseño", icon: "design" }),
  step({ position: 2, current: true, member: RAQUEL, name: "Raquel Gómez" }),
  step({ position: 3, member: DAVINIA, name: "Davinia Ruiz", stage: "Impresión", icon: "print" }),
];

function mineOrder(overrides: Partial<MineOrder> = {}): MineOrder {
  return {
    id: "order-1",
    reference: "SUR4-0106",
    title: "Carteles",
    priority: "normal",
    due_at: "2026-10-30T10:00:00.000Z",
    delivered_at: null,
    archived_at: null,
    ready_at: null,
    assigned_team_member_id: TAMARA,
    client_name: "Cliente",
    service_name: null,
    store_name: null,
    status: { name: "En curso", code: "in_progress", is_ready: false, is_closed: false, is_cancelled: false },
    ...overrides,
  };
}

function turnOrder(me: string, order: MineOrder, steps: unknown[]): MineTurnOrder {
  const summary = summarizeWorkSteps(steps);
  return {
    ...order,
    work_turn: summary.turn,
    my_turn: mineTurnFlags({ assignedTeamMemberId: order.assigned_team_member_id, summary }, me),
  };
}

describe("summarizeWorkSteps", () => {
  it("an order without steps has no turn", () => {
    assert.deepEqual(summarizeWorkSteps([]), { turn: null, participantIds: [], upcomingIds: [] });
    assert.deepEqual(summarizeWorkSteps(undefined), { turn: null, participantIds: [], upcomingIds: [] });
  });

  it("the current step, its place in the sequence, participants and who comes later", () => {
    const summary = summarizeWorkSteps([...SUR4_0106].reverse());
    assert.deepEqual(summary.turn, {
      total: 3,
      done: 1,
      current: {
        position: 2,
        total: 3,
        stage_name: "Preparación",
        stage_icon: "prepare",
        team_member: { id: RAQUEL, name: "Raquel Gómez", active: true },
      },
    });
    assert.deepEqual(summary.participantIds, [JESUS, RAQUEL, DAVINIA]);
    assert.deepEqual(summary.upcomingIds, [DAVINIA]);
  });

  it("a finished sequence has no current step", () => {
    const summary = summarizeWorkSteps([
      step({ position: 1, done: true, member: JESUS }),
      step({ position: 2, done: true }),
    ]);
    assert.equal(summary.turn?.current, null);
    assert.equal(summary.turn?.done, 2);
    assert.deepEqual(summary.upcomingIds, []);
  });

  it("three steps of the same person count her once", () => {
    const summary = summarizeWorkSteps([
      step({ position: 1, current: true }),
      step({ position: 2 }),
      step({ position: 3 }),
    ]);
    assert.deepEqual(summary.participantIds, [RAQUEL]);
    assert.deepEqual(summary.upcomingIds, [RAQUEL]);
    assert.equal(summary.turn?.current?.position, 1);
  });

  it("a current step without a person (D14) and an inactive person", () => {
    const unassigned = summarizeWorkSteps([step({ position: 1, current: true, member: null })]);
    assert.equal(unassigned.turn?.current?.team_member, null);
    const inactive = summarizeWorkSteps([step({ position: 1, current: true, active: false })]);
    assert.equal(inactive.turn?.current?.team_member?.active, false);
  });

  it("uses positions, not array order, and falls back to the first step not done", () => {
    const summary = summarizeWorkSteps([
      step({ position: 3, member: DAVINIA, name: "Davinia Ruiz" }),
      step({ position: 1, done: true, member: JESUS }),
      step({ position: 2 }),
    ]);
    assert.equal(summary.turn?.current?.position, 2);
    assert.equal(summary.turn?.current?.team_member?.id, RAQUEL);
  });
});

describe("labels", () => {
  const turn = summarizeWorkSteps(SUR4_0106).turn;

  it("compact, full and Sunday labels", () => {
    assert.equal(firstName("  Raquel  Gómez "), "Raquel");
    assert.equal(workTurnCompactLabel(turn), "Raquel 2/3");
    assert.equal(workTurnTitle(turn), "Le toca a Raquel Gómez · Preparación · paso 2 de 3");
    assert.equal(workTurnArrowLabel(turn), "→ Raquel");
    assert.equal(myTurnLabel(turn!.current!), "Te toca: Preparación 2/3");
  });

  it("finished, unassigned, inactive and no sequence", () => {
    const done = summarizeWorkSteps([step({ position: 1, done: true }), step({ position: 2, done: true })]).turn;
    assert.equal(workTurnCompactLabel(done), "Hecha 2/2");
    assert.equal(workTurnTitle(done), "Secuencia hecha · 2 de 2 pasos");
    assert.equal(workTurnArrowLabel(done), null);

    const unassigned = summarizeWorkSteps([step({ position: 1, current: true, member: null })]).turn;
    assert.equal(workTurnCompactLabel(unassigned), "Sin asignar 1/1");
    assert.equal(workTurnTitle(unassigned), "Paso sin asignar · Preparación · paso 1 de 1");

    const inactive = summarizeWorkSteps([step({ position: 1, current: true, active: false })]).turn;
    assert.equal(workTurnTitle(inactive), "Le toca a Raquel Gómez (inactiva) · Preparación · paso 1 de 1");

    assert.equal(workTurnCompactLabel(null), null);
    assert.equal(workTurnTitle(undefined), null);
  });
});

describe("Mis pedidos buckets (f1 §6)", () => {
  it("SUR4-0106: Raquel me toca, Davinia más adelante, Tamara soy responsable, Jesús nothing", () => {
    const order = mineOrder();
    assert.deepEqual(turnOrder(RAQUEL, order, SUR4_0106).my_turn, {
      turn: true, step_turn: true, responsible: false, upcoming: false,
    });
    assert.deepEqual(turnOrder(DAVINIA, order, SUR4_0106).my_turn, {
      turn: false, step_turn: false, responsible: false, upcoming: true,
    });
    assert.deepEqual(turnOrder(TAMARA, order, SUR4_0106).my_turn, {
      turn: false, step_turn: false, responsible: true, upcoming: false,
    });
    assert.deepEqual(turnOrder(JESUS, order, SUR4_0106).my_turn, {
      turn: false, step_turn: false, responsible: false, upcoming: false,
    });
  });

  it("a finished sequence goes back to the responsible person's Me toca (f1 §3, §10)", () => {
    const finished = SUR4_0106.map((row) => ({ ...row, is_current: false, completed_at: "2026-10-28T09:00:00.000Z" }));
    assert.deepEqual(turnOrder(TAMARA, mineOrder(), finished).my_turn, {
      turn: true, step_turn: false, responsible: true, upcoming: false,
    });
    assert.equal(turnOrder(DAVINIA, mineOrder(), finished).my_turn.turn, false);
  });

  it("Todo is Soy responsable ∪ Me toca without duplicates; Más adelante stays apart", () => {
    const orders = [
      turnOrder(RAQUEL, mineOrder({ id: "a", reference: "A", assigned_team_member_id: RAQUEL }), [step({ position: 1, current: true })]),
      turnOrder(RAQUEL, mineOrder({ id: "b", reference: "B" }), SUR4_0106),
      turnOrder(RAQUEL, mineOrder({ id: "c", reference: "C", assigned_team_member_id: RAQUEL }), []),
      turnOrder(RAQUEL, mineOrder({ id: "d", reference: "D" }), [
        step({ position: 1, current: true, member: DAVINIA, name: "Davinia Ruiz" }),
        step({ position: 2 }),
        step({ position: 3 }),
      ]),
    ];
    const buckets = bucketMineTurnOrders(orders, { now: NOW, timeZone: TIME_ZONE });
    const ids = Object.fromEntries(
      buckets.map((bucket) => [bucket.id, bucket.sections.flatMap((s) => s.orders.map((o) => o.id)).sort()])
    );
    assert.deepEqual(buckets.map((b) => b.id), MINE_TURN_BUCKETS.map((b) => b.id));
    assert.deepEqual(ids, { all: ["a", "b", "c"], turn: ["a", "b", "c"], responsible: ["a", "c"], upcoming: ["d"] });
    assert.deepEqual(buckets.map((b) => b.count), [3, 3, 2, 1]);
  });

  it("without sequences, Todo is exactly today's queue", () => {
    const orders = [
      mineOrder({ id: "1", reference: "R-1", priority: "urgent" }),
      mineOrder({ id: "2", reference: "R-2", due_at: "2026-10-27T10:00:00.000Z" }),
      mineOrder({ id: "3", reference: "R-3", due_at: "2026-10-28T15:00:00.000Z" }),
      mineOrder({ id: "4", reference: "R-4", status: { name: "Listo", code: "ready", is_ready: true, is_closed: false, is_cancelled: false } }),
      mineOrder({ id: "5", reference: "R-5", due_at: null }),
    ];
    const today = groupMyOrdersQueue(orders, { now: NOW, timeZone: TIME_ZONE, assignedTeamMemberId: TAMARA });
    const all = bucketMineTurnOrders(orders.map((o) => turnOrder(TAMARA, o, [])), { now: NOW, timeZone: TIME_ZONE })
      .find((bucket) => bucket.id === "all");
    const strip = (sections: typeof today) =>
      sections.map((section) => ({ ...section, orders: section.orders.map((o) => o.id) }));
    assert.deepEqual(strip(all!.sections), strip(today));
    assert.deepEqual(strip(groupMineSections(orders, { now: NOW, timeZone: TIME_ZONE })), strip(today));
  });
});

describe("Mostrador «Mis pedidos» rule", () => {
  it("is the responsible person only without a sequence", () => {
    assert.equal(isMineOrder({ assignedTeamMemberId: TAMARA }, TAMARA), true);
    assert.equal(isMineOrder({ assignedTeamMemberId: TAMARA, turn: null }, RAQUEL), false);
    assert.equal(isMineOrder({ assignedTeamMemberId: TAMARA }, null), false);
  });

  it("is the same rule as Todo in Mis pedidos", () => {
    const finished = SUR4_0106.map((row) => ({ ...row, is_current: false, completed_at: "2026-10-28T09:00:00.000Z" }));
    for (const sequence of [[], SUR4_0106, finished]) {
      for (const me of [TAMARA, JESUS, RAQUEL, DAVINIA]) {
        const order = turnOrder(me, mineOrder(), sequence);
        assert.equal(
          isMineOrder({ assignedTeamMemberId: order.assigned_team_member_id, turn: order.work_turn }, me),
          order.my_turn.responsible || order.my_turn.turn,
          `${me} / ${sequence.length}`
        );
      }
    }
  });

  it("adds the orders whose current step is mine, not the later ones", () => {
    const turn = summarizeWorkSteps(SUR4_0106).turn;
    assert.equal(isMineOrder({ assignedTeamMemberId: TAMARA, turn }, RAQUEL), true);
    assert.equal(isMineOrder({ assignedTeamMemberId: TAMARA, turn }, DAVINIA), false);
    assert.equal(isMineOrder({ assignedTeamMemberId: TAMARA, turn }, TAMARA), true);
  });
});

describe("list rows and queries", () => {
  it("mergeRowsById keeps the first occurrence of each id", () => {
    assert.deepEqual(
      mergeRowsById([{ id: "a", n: 1 }, { id: "b", n: 1 }], [{ id: "a", n: 2 }, { id: "c", n: 2 }]),
      [{ id: "a", n: 1 }, { id: "b", n: 1 }, { id: "c", n: 2 }]
    );
  });

  it("attachWorkTurn replaces the raw embeds with work_turn", () => {
    const row = attachWorkTurn({
      id: "a",
      reference: "A",
      work_steps: SUR4_0106,
      work_turn_filter: [{ id: "s" }],
      work_participant_filter: [{ id: "s" }],
      my_pending_steps: [{ id: "s" }],
    }) as Record<string, unknown>;
    assert.deepEqual(Object.keys(row).sort(), ["id", "reference", "work_turn"]);
    assert.equal(workTurnCompactLabel(row.work_turn as never), "Raquel 2/3");
    assert.equal((attachWorkTurn({ id: "b", work_steps: [] }) as Record<string, unknown>).work_turn, null);
  });

  it("the steps embed names the foreign key towards team_members", () => {
    assert.match(WORK_STEPS_EMBED, /team_member:team_members!order_work_steps_team_member_fk\(id, name, active\)/);
    assert.doesNotMatch(WORK_STEPS_EMBED, /team_members\(/);
  });

  it("filters are semi-joins on their own alias", () => {
    assert.equal(withWorkTurnSelect("id"), `id,\n  ${WORK_STEPS_EMBED}`);
    const both = withWorkTurnSelect("id", { turnTeamMemberId: RAQUEL, participantTeamMemberId: DAVINIA });
    assert.match(both, /work_turn_filter:order_work_steps!inner\(id\)/);
    assert.match(both, /work_participant_filter:order_work_steps!inner\(id\)/);

    const calls: unknown[][] = [];
    const builder = {
      eq: (...args: unknown[]) => (calls.push(["eq", ...args]), builder),
      is: (...args: unknown[]) => (calls.push(["is", ...args]), builder),
    };
    applyWorkTurnFilters(builder, { turnTeamMemberId: RAQUEL, participantTeamMemberId: DAVINIA });
    assert.deepEqual(calls, [
      ["eq", "work_turn_filter.team_member_id", RAQUEL],
      ["is", "work_turn_filter.is_current", true],
      ["eq", "work_participant_filter.team_member_id", DAVINIA],
    ]);
    calls.length = 0;
    applyWorkTurnFilters(builder, {});
    assert.deepEqual(calls, []);
  });
});

describe("loadWorkSequenceEnabled", () => {
  function client(feature: boolean | "error", stages: { count: number | null; error?: unknown }) {
    const calls: string[] = [];
    const supabase = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push(`rpc:${name}:${args.p_code}`);
        return feature === "error" ? { data: null, error: { message: "x" } } : { data: feature, error: null };
      },
      from: (table: string) => {
        calls.push(`from:${table}`);
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => (calls.push(`eq:${column}=${value}`), query),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ count: stages.count, error: stages.error ?? null }).then(resolve),
        };
        return query;
      },
    };
    return { calls, supabase: supabase as never };
  }

  it("without the feature no new table is read", async () => {
    for (const feature of [false, "error"] as const) {
      const h = client(feature, { count: 3 });
      assert.equal(await loadWorkSequenceEnabled(h.supabase, "tenant-a"), false);
      assert.deepEqual(h.calls, ["rpc:tenant_has_feature:order_work_sequence"]);
    }
  });

  it("needs at least one active stage of the tenant", async () => {
    const on = client(true, { count: 2 });
    assert.equal(await loadWorkSequenceEnabled(on.supabase, "tenant-a"), true);
    assert.deepEqual(on.calls, [
      "rpc:tenant_has_feature:order_work_sequence",
      "from:work_stages",
      "eq:tenant_id=tenant-a",
      "eq:active=true",
    ]);
    assert.equal(await loadWorkSequenceEnabled(client(true, { count: 0 }).supabase, "tenant-a"), false);
    assert.equal(await loadWorkSequenceEnabled(client(true, { count: 5, error: { message: "x" } }).supabase, "tenant-a"), false);
  });
});
