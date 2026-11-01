import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest } from "next/server";

import { WORK_STEPS_EMBED } from "@/lib/orders/work-turn";

// SUR4 E9: run the real GET handlers of /api/orders, /api/orders/mine and
// /api/orders/counter, replacing only the session and the database. Without
// order_work_sequence (or without active stages) every answer and every query
// must be today's; with it, the turn travels as `work_turn` and the two new
// filters are semi-joins. phase61/phase62 cover RLS and the SQL counts, and the
// semi-join count was checked against PostgREST 16.2 (one row per order).

const root = path.resolve(import.meta.dirname, "../..");
const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TAMARA = "00000000-0000-4000-8000-0000000000a1";
const RAQUEL = "00000000-0000-4000-8000-0000000000a3";
const DAVINIA = "00000000-0000-4000-8000-0000000000a4";

type Call = { table: string; method: string; args: unknown[] };
type QueryState = { table: string; select: string; filters: Array<[string, ...unknown[]]> };
type Resolver = (state: QueryState) => { data?: unknown; count?: number | null; error?: unknown };

type Options = {
  feature?: boolean;
  activeStages?: number;
  teamMemberId?: string | null;
  resolve?: Resolver;
};

const status = { name: "En curso", code: "in_progress", is_ready: false, is_closed: false, is_cancelled: false, sort_order: 1 };

function steps(current: string, later: string[] = []) {
  return [
    { position: 1, is_current: true, completed_at: null, team_member_id: current, stage: { name: "Preparación", icon: "prepare" }, team_member: { id: current, name: current === RAQUEL ? "Raquel Gómez" : "Davinia Ruiz", active: true } },
    ...later.map((member, index) => ({
      position: index + 2, is_current: false, completed_at: null, team_member_id: member,
      stage: { name: "Impresión", icon: "print" },
      team_member: { id: member, name: member === RAQUEL ? "Raquel Gómez" : "Davinia Ruiz", active: true },
    })),
  ];
}

function orderRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, tenant_id: TENANT, reference: `REF-${id}`, title: `Pedido ${id}`, description: null,
    priority: "normal", due_at: "2026-10-30T10:00:00.000Z", delivered_at: null, archived_at: null,
    ready_at: null, customer_notification_status: null, store_id: null, service_id: null,
    assigned_team_member_id: TAMARA, row_version: 3,
    client: { name: "Cliente" }, service: null, store: null,
    assigned_team_member: { id: TAMARA, name: "Tamara" }, status,
    ...extra,
  };
}

function harness(options: Options = {}) {
  const calls: Call[] = [];
  const queries: QueryState[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ table: name, method: "rpc", args: [args] });
      if (name === "tenant_has_feature") {
        return { data: args.p_code === "order_work_sequence" && options.feature === true, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
    from(table: string) {
      const state: QueryState = { table, select: "", filters: [] };
      queries.push(state);
      let single = false;
      const query: Record<string, unknown> = {};
      for (const method of ["eq", "is", "in", "not", "gte", "lt", "order", "range", "limit", "filter", "or"]) {
        query[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          state.filters.push([method, ...args]);
          return query;
        };
      }
      query.select = (select: string, opts?: unknown) => {
        calls.push({ table, method: "select", args: [select, opts] });
        state.select = select;
        return query;
      };
      query.maybeSingle = () => { single = true; return query; };
      query.then = (resolve: (value: unknown) => unknown) => {
        let result: { data?: unknown; count?: number | null; error?: unknown };
        if (table === "work_stages") {
          result = { data: null, count: options.activeStages ?? 1 };
        } else if (table === "tenant_settings") {
          result = { data: { timezone: "Europe/Madrid" } };
        } else if (table === "team_members" && single) {
          result = { data: options.teamMemberId === null ? null : { id: options.teamMemberId ?? RAQUEL, name: "Raquel Gómez", tenant_id: TENANT } };
        } else {
          result = options.resolve?.(state) ?? { data: [], count: 0 };
        }
        const data = single && Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? (single ? null : []);
        return Promise.resolve({ data, count: result.count ?? null, error: result.error ?? null }).then(resolve);
      };
      return query;
    },
  };

  function load(relative: string) {
    const filename = path.join(root, relative);
    const exports: Record<string, (...args: never[]) => Promise<Response>> = {};
    const realRequire = createRequire(filename);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const session = { tenant: { id: TENANT, name: "Demo", slug: "demo" }, user: { id: "user-a" }, membership: { role: "staff", active: true } };
    vm.runInNewContext(compiled, {
      exports, console, URL, URLSearchParams, Response, Headers,
      require(id: string) {
        if (id === "@/lib/tenant/current-context") return { getCurrentContext: async () => session };
        if (id === "@/lib/tenant/access-response") {
          return { requireCurrentAccess: async () => ({ ok: true, context: session }), roleDeniedResponse: () => Response.json({}, { status: 403 }) };
        }
        if (id === "@/lib/supabase/server") return { createClient: async () => db };
        if (id === "@/lib/orders/review-load") {
          return {
            REVIEW_ID_CHUNK: 80,
            loadOperationalReviewOrders: async () => ({ orders: [], error: null }),
            loadTenantZonedDay: async () => ({
              error: null,
              day: { timezone: "Europe/Madrid", localDate: "2026-10-28", dayStart: new Date("2026-10-27T23:00:00Z"), dayEnd: new Date("2026-10-28T23:00:00Z") },
            }),
          };
        }
        return realRequire(id.startsWith("@/") ? path.join(root, id.slice(2)) : id);
      },
    }, { filename });
    return exports as Record<string, (...args: unknown[]) => Promise<Response>>;
  }

  return { calls, queries, load };
}

const get = (url: string) => new NextRequest(`http://localhost${url}`);

function ordersQueries(h: ReturnType<typeof harness>) {
  return h.queries.filter((q) => q.table === "orders" && q.select.trim() !== "id");
}

function withoutNow(body: Record<string, unknown>) {
  const rest = { ...body };
  delete rest.now;
  return rest;
}

describe("GET /api/orders without the work sequence (identity)", () => {
  const resolve: Resolver = (state) =>
    state.select.trim() === "id" ? { data: null, count: 9 } : { data: [orderRow("o1")], count: 1 };

  for (const [label, feature, stages] of [["feature off", false, 1], ["feature on, no active stage", true, 0]] as const) {
    it(`${label}: the new params are ignored and nothing new is read or answered`, async () => {
      const plain = harness({ feature, activeStages: stages, resolve });
      const withParams = harness({ feature, activeStages: stages, resolve });
      const base = "/api/orders?filter=active&page=1&page_size=50";
      const a = await plain.load("app/api/orders/route.ts").GET(get(base));
      const b = await withParams.load("app/api/orders/route.ts").GET(
        get(`${base}&turn_team_member_id=${RAQUEL}&participant_team_member_id=not-a-uuid`)
      );
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      const bodyA = (await a.json()) as Record<string, unknown>;
      const bodyB = (await b.json()) as Record<string, unknown>;
      assert.deepEqual(withoutNow(bodyB), withoutNow(bodyA));
      assert.deepEqual(Object.keys(bodyA).sort(), ["all_total", "count", "local_date", "now", "orders", "page", "page_size", "tenant", "timezone", "total"]);
      assert.equal("work_turn" in (bodyA.orders as Record<string, unknown>[])[0], false);
      const plainCalls = (h: ReturnType<typeof harness>) =>
        JSON.parse(JSON.stringify(h.calls.filter((c) => c.method !== "rpc")));
      assert.deepEqual(plainCalls(withParams), plainCalls(plain));
      for (const query of withParams.queries) {
        assert.doesNotMatch(query.select, /order_work_steps/);
      }
    });
  }

  it("calendar, Por servicio and the main list keep today's selects", async () => {
    const h = harness({ feature: false, resolve });
    const route = h.load("app/api/orders/route.ts");
    for (const url of [
      "/api/orders?week_start=2026-10-26&filter=active",
      "/api/orders?active=true",
      "/api/orders?filter=all&q=carteles",
    ]) {
      const response = await route.GET(get(`${url}&turn_team_member_id=${RAQUEL}`));
      assert.equal(response.status, 200, url);
      const body = (await response.json()) as Record<string, unknown>;
      assert.equal("work_sequence" in body, false, url);
    }
    assert.equal(h.queries.some((q) => q.table === "work_stages"), false);
    assert.equal(h.queries.some((q) => /order_work_steps/.test(q.select)), false);
  });
});

describe("GET /api/orders with the work sequence", () => {
  it("embeds the steps and answers work_turn without the raw embeds", async () => {
    const h = harness({
      feature: true,
      resolve: (state) =>
        state.select.trim() === "id"
          ? { data: null, count: 2 }
          : {
              data: [
                orderRow("o1", { work_steps: steps(RAQUEL, [DAVINIA]) }),
                orderRow("o2", { work_steps: [] }),
              ],
              count: 2,
            },
    });
    const response = await h.load("app/api/orders/route.ts").GET(get("/api/orders?filter=active"));
    assert.equal(response.status, 200);
    const body = (await response.json()) as { work_sequence: boolean; orders: Array<Record<string, unknown>>; total: number };
    assert.equal(body.work_sequence, true);
    assert.equal(body.total, 2);
    assert.deepEqual(body.orders.map((o) => Object.keys(o).includes("work_steps")), [false, false]);
    assert.deepEqual(body.orders[0].work_turn, {
      total: 2,
      done: 0,
      current: { position: 1, total: 2, stage_name: "Preparación", stage_icon: "prepare", team_member: { id: RAQUEL, name: "Raquel Gómez", active: true } },
    });
    assert.equal(body.orders[1].work_turn, null);
    assert.equal("row_version" in body.orders[0], false);
    const [list] = ordersQueries(h);
    assert.ok(list.select.includes(WORK_STEPS_EMBED));
    assert.doesNotMatch(list.select, /!inner\(id\)/);
  });

  it("Le toca a and Participa are semi-joins: total is the count of distinct orders", async () => {
    const h = harness({
      feature: true,
      resolve: (state) =>
        state.select.trim() === "id"
          ? { data: null, count: 7 }
          : { data: [orderRow("o1", { work_steps: steps(RAQUEL, [RAQUEL, RAQUEL]), work_turn_filter: [{ id: "s1" }], work_participant_filter: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] })], count: 1 },
    });
    const response = await h.load("app/api/orders/route.ts").GET(
      get(`/api/orders?filter=active&turn_team_member_id=${RAQUEL}&participant_team_member_id=${RAQUEL}`)
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { total: number; count: number; orders: Array<Record<string, unknown>> };
    assert.equal(body.total, 1);
    assert.equal(body.count, 1);
    assert.deepEqual(Object.keys(body.orders[0]).filter((key) => key.startsWith("work_")), ["work_turn"]);

    const [list] = ordersQueries(h);
    assert.match(list.select, /work_turn_filter:order_work_steps!inner\(id\)/);
    assert.match(list.select, /work_participant_filter:order_work_steps!inner\(id\)/);
    assert.deepEqual(
      list.filters.filter(([, column]) => typeof column === "string" && column.startsWith("work_")),
      [
        ["eq", "work_turn_filter.team_member_id", RAQUEL],
        ["is", "work_turn_filter.is_current", true],
        ["eq", "work_participant_filter.team_member_id", RAQUEL],
      ]
    );
    // The responsible filter is not involved; pagination is a plain range.
    assert.equal(list.filters.some(([method, column]) => method === "eq" && column === "assigned_team_member_id"), false);
    assert.ok(list.filters.some(([method, from, to]) => method === "range" && from === 0 && to === 49));
  });

  it("a dashboard link with only turn_team_member_id lists operational orders", async () => {
    const h = harness({ feature: true, resolve: () => ({ data: [], count: 0 }) });
    const response = await h.load("app/api/orders/route.ts").GET(get(`/api/orders?turn_team_member_id=${RAQUEL}`));
    assert.equal(response.status, 200);
    const [list] = ordersQueries(h);
    assert.match(list.select, /status:order_statuses!inner/);
    assert.ok(list.filters.some(([method, column, value]) => method === "eq" && column === "status.is_closed" && value === false));
    assert.ok(list.filters.some(([method, column]) => method === "is" && column === "archived_at"));
  });

  it("rejects malformed person ids only when the sequence is on", async () => {
    for (const param of ["turn_team_member_id", "participant_team_member_id"]) {
      const h = harness({ feature: true });
      const response = await h.load("app/api/orders/route.ts").GET(get(`/api/orders?filter=active&${param}=nope`));
      assert.equal(response.status, 400, param);
      assert.equal(ordersQueries(h).length, 0);
    }
  });

  it("calendar: Le toca a is checked against the tenant and filtered as a semi-join", async () => {
    const h = harness({
      feature: true,
      resolve: (state) =>
        state.table === "team_members"
          ? { data: [{ id: RAQUEL }] }
          : { data: [orderRow("o1", { work_steps: steps(RAQUEL), work_turn_filter: [{ id: "s1" }] })], count: 1 },
    });
    const response = await h.load("app/api/orders/route.ts").GET(
      get(`/api/orders?week_start=2026-10-26&filter=active&turn_team_member_id=${RAQUEL}`)
    );
    assert.equal(response.status, 200);
    const body = (await response.json()) as { work_sequence: boolean; total: number; orders: Array<Record<string, unknown>> };
    assert.equal(body.work_sequence, true);
    assert.equal(body.total, 1);
    assert.equal((body.orders[0].work_turn as { current: { position: number } }).current.position, 1);
    assert.equal("work_turn_filter" in body.orders[0], false);
    assert.ok(h.queries.some((q) => q.table === "team_members" && q.filters.some(([, column, value]) => column === "id" && value === RAQUEL)));
    const calendar = ordersQueries(h).find((q) => q.select.includes("work_turn_filter"));
    assert.ok(calendar?.filters.some(([method, column]) => method === "is" && column === "work_turn_filter.is_current"));
  });

  it("Por servicio carries the turn and keeps its filter on the client", async () => {
    const h = harness({ feature: true, resolve: () => ({ data: [orderRow("o1", { work_steps: steps(DAVINIA) })], count: 1 }) });
    const response = await h.load("app/api/orders/route.ts").GET(get(`/api/orders?active=true&turn_team_member_id=${RAQUEL}`));
    const body = (await response.json()) as { orders: Array<Record<string, unknown>> };
    assert.equal((body.orders[0].work_turn as { current: { team_member: { id: string } } }).current.team_member.id, DAVINIA);
    const [list] = ordersQueries(h);
    assert.ok(list.select.includes(WORK_STEPS_EMBED));
    assert.doesNotMatch(list.select, /work_turn_filter/);
  });
});

describe("GET /api/orders/mine", () => {
  it("without the work sequence: one query, today's answer, no chips", async () => {
    const h = harness({
      feature: false,
      teamMemberId: TAMARA,
      resolve: (state) => ({ data: state.filters.some(([, c, v]) => c === "assigned_team_member_id" && v === TAMARA) ? [orderRow("own")] : [], count: 1 }),
    });
    const response = await h.load("app/api/orders/mine/route.ts").GET();
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ["count", "linked", "orders", "sections", "team_member", "tenant", "timezone", "today"]);
    assert.equal(body.count, 1);
    assert.equal("my_turn" in (body.orders as Array<Record<string, unknown>>)[0], false);
    assert.equal(ordersQueries(h).length, 1);
    assert.doesNotMatch(ordersQueries(h)[0].select, /order_work_steps/);
  });

  it("with it: Todo = Soy responsable ∪ Me toca, each order once, plus the other chips", async () => {
    const h = harness({
      feature: true,
      teamMemberId: RAQUEL,
      resolve: (state) => {
        if (state.filters.some(([, column]) => column === "assigned_team_member_id")) {
          return { data: [orderRow("mine-a", { assigned_team_member_id: RAQUEL, work_steps: [] }), orderRow("both", { assigned_team_member_id: RAQUEL, work_steps: steps(RAQUEL) })], count: 2 };
        }
        return {
          data: [
            orderRow("both", { assigned_team_member_id: RAQUEL, work_steps: steps(RAQUEL), my_pending_steps: [{ id: "s" }] }),
            orderRow("turn", { work_steps: steps(RAQUEL, [DAVINIA]), my_pending_steps: [{ id: "s" }] }),
            orderRow("later", { work_steps: steps(DAVINIA, [RAQUEL, RAQUEL]), my_pending_steps: [{ id: "s" }, { id: "t" }] }),
          ],
          count: 3,
        };
      },
    });
    const response = await h.load("app/api/orders/mine/route.ts").GET();
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      count: number;
      orders: Array<{ id: string; my_turn: Record<string, boolean>; work_turn: unknown }>;
      sections: Array<{ orders: Array<{ id: string }> }>;
      work_sequence: { default_bucket: string; buckets: Array<{ id: string; count: number; sections: Array<{ orders: Array<{ id: string }> }> }> };
    };
    const ids = (sections: Array<{ orders: Array<{ id: string }> }>) => sections.flatMap((s) => s.orders.map((o) => o.id)).sort();
    assert.equal(body.count, 3);
    assert.deepEqual(body.orders.map((o) => o.id).sort(), ["both", "mine-a", "turn"]);
    assert.deepEqual(ids(body.sections), ["both", "mine-a", "turn"]);
    assert.equal(body.work_sequence.default_bucket, "all");
    assert.deepEqual(
      Object.fromEntries(body.work_sequence.buckets.map((b) => [b.id, ids(b.sections)])),
      { all: ["both", "mine-a", "turn"], turn: ["both", "mine-a", "turn"], responsible: ["both", "mine-a"], upcoming: ["later"] }
    );
    assert.deepEqual(body.work_sequence.buckets.map((b) => b.count), [3, 3, 2, 1]);
    assert.deepEqual(body.orders.find((o) => o.id === "turn")?.my_turn, { turn: true, step_turn: true, responsible: false, upcoming: false });

    const [responsible, pending] = ordersQueries(h);
    assert.ok(responsible.select.includes(WORK_STEPS_EMBED));
    assert.ok(responsible.filters.some(([, column, value]) => column === "assigned_team_member_id" && value === RAQUEL));
    assert.match(pending.select, /my_pending_steps:order_work_steps!inner\(id\)/);
    assert.deepEqual(
      pending.filters.filter(([, column]) => typeof column === "string" && column.startsWith("my_pending_steps")),
      [["eq", "my_pending_steps.team_member_id", RAQUEL], ["is", "my_pending_steps.completed_at", null]]
    );
    for (const query of [responsible, pending]) {
      assert.ok(query.filters.some(([, column, value]) => column === "status.is_cancelled" && value === false));
    }
  });

  it("an unlinked account never reads the steps", async () => {
    const h = harness({ feature: true, teamMemberId: null });
    const body = (await (await h.load("app/api/orders/mine/route.ts").GET()).json()) as Record<string, unknown>;
    assert.equal(body.linked, false);
    assert.equal(h.calls.some((c) => c.method === "rpc"), false);
  });

  it("is used as is by the page and the queue", () => {
    const page = readFileSync(path.join(root, "app/orders/mine/page.tsx"), "utf8");
    const queue = readFileSync(path.join(root, "components/orders/my-orders-queue.tsx"), "utf8");
    assert.match(page, /turnBuckets=\{data\?\.work_sequence\?\.buckets\}/);
    assert.match(queue, /if \(turnBuckets && turnBuckets\.length > 0\)/);
    assert.match(queue, /Ahora mismo no tienes pedidos asignados\./);
  });
});

describe("GET /api/orders/counter · Mis pedidos", () => {
  const rows = () => [
    orderRow("own"),
    orderRow("turn", { assigned_team_member_id: DAVINIA, assigned_team_member: { name: "Davinia" }, work_steps: steps(TAMARA) }),
    orderRow("later", { assigned_team_member_id: DAVINIA, assigned_team_member: { name: "Davinia" }, work_steps: steps(RAQUEL, [TAMARA]) }),
  ];

  function ids(body: { buckets: Array<{ orders: Array<Record<string, unknown>> }> }) {
    return [...new Set(body.buckets.flatMap((b) => b.orders.map((o) => String(o.id))))].sort();
  }

  it("without the work sequence it is the responsible person only, as today", async () => {
    const h = harness({
      feature: false,
      teamMemberId: TAMARA,
      resolve: () => ({ data: rows().map((row) => { const copy: Record<string, unknown> = { ...row }; delete copy.work_steps; return copy; }), count: 3 }),
    });
    const response = await h.load("app/api/orders/counter/route.ts").GET(get("/api/orders/counter?mine=1"));
    const body = (await response.json()) as Record<string, unknown> & { buckets: Array<{ orders: Array<Record<string, unknown>> }> };
    assert.deepEqual(ids(body), ["own"]);
    assert.equal("work_sequence" in body, false);
    assert.equal(body.buckets.flatMap((b) => b.orders).some((o) => "work_turn" in o), false);
    assert.doesNotMatch(ordersQueries(h)[0].select, /order_work_steps/);
  });

  it("with it, Mis pedidos adds the orders whose current step is mine", async () => {
    const h = harness({ feature: true, teamMemberId: TAMARA, resolve: () => ({ data: rows(), count: 3 }) });
    const response = await h.load("app/api/orders/counter/route.ts").GET(get("/api/orders/counter?mine=1"));
    const body = (await response.json()) as Record<string, unknown> & { buckets: Array<{ orders: Array<Record<string, unknown>> }> };
    assert.deepEqual(ids(body), ["own", "turn"]);
    assert.equal(body.work_sequence, true);
    assert.ok(ordersQueries(h)[0].select.includes(WORK_STEPS_EMBED));
    const all = await (await harness({ feature: true, teamMemberId: TAMARA, resolve: () => ({ data: rows(), count: 3 }) })
      .load("app/api/orders/counter/route.ts").GET(get("/api/orders/counter"))).json() as { buckets: Array<{ orders: Array<Record<string, unknown>> }> };
    assert.deepEqual(ids(all), ["later", "own", "turn"]);
  });
});
