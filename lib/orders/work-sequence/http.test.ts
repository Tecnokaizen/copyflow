import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { NextRequest } from "next/server";

// SUR4 E8: run the real route handlers, replacing only the session and the
// Supabase client. The SQL suites (phase61/phase62) exercise RLS and the RPCs.

const root = path.resolve(import.meta.dirname, "../../..");
const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ORDER_A = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ORDER_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const ORDER_B = "bbbbbbbb-bbbb-4bbb-8bbb-000000000001";
const STEP_A = "aaaaaaaa-aaaa-4aaa-8aaa-000000000011";
const STEP_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000012";
const STEP_OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-000000000021";
const STEP_B = "bbbbbbbb-bbbb-4bbb-8bbb-000000000011";
const STAGE_A = "aaaaaaaa-aaaa-4aaa-8aaa-000000000031";
const STAGE_A_OFF = "aaaaaaaa-aaaa-4aaa-8aaa-000000000032";
const STAGE_A3 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000033";
const STAGE_B = "bbbbbbbb-bbbb-4bbb-8bbb-000000000031";
const MEMBER_A = "aaaaaaaa-aaaa-4aaa-8aaa-000000000041";
const MEMBER_A2 = "aaaaaaaa-aaaa-4aaa-8aaa-000000000042";

type Row = Record<string, unknown>;
type Handler = (request: NextRequest, context?: unknown) => Promise<Response>;

type Options = {
  role?: string;
  feature?: boolean;
  rpc?: Record<string, unknown>;
  archived?: boolean;
};

function tables(options: Options): Record<string, Row[]> {
  return {
    orders: [
      { id: ORDER_A, tenant_id: TENANT_A, row_version: 7, archived_at: options.archived ? "2026-10-20T10:00:00Z" : null },
      { id: ORDER_A2, tenant_id: TENANT_A, row_version: 3, archived_at: null },
      { id: ORDER_B, tenant_id: TENANT_B, row_version: 1, archived_at: null },
    ],
    order_work_steps: [
      {
        id: STEP_A2, tenant_id: TENANT_A, order_id: ORDER_A, position: 2, completed_at: null,
        completed_by_name: null, is_current: true,
        stage: { id: STAGE_A_OFF, name: "Corte", icon: "cut", active: false },
        team_member: { id: MEMBER_A2, name: "Raquel", active: false, can_receive_orders: true },
        executed_by: null,
      },
      {
        id: STEP_A, tenant_id: TENANT_A, order_id: ORDER_A, position: 1, completed_at: "2026-10-28T09:15:00Z",
        completed_by_name: "Tamara", is_current: false,
        stage: { id: STAGE_A, name: "Diseño", icon: "design", active: true },
        team_member: { id: MEMBER_A, name: "Jesús", active: true, can_receive_orders: true },
        executed_by: { id: MEMBER_A, name: "Jesús" },
      },
      {
        id: STEP_OTHER, tenant_id: TENANT_A, order_id: ORDER_A2, position: 1, completed_at: null,
        completed_by_name: null, is_current: true, stage: null, team_member: null, executed_by: null,
      },
      {
        id: STEP_B, tenant_id: TENANT_B, order_id: ORDER_B, position: 1, completed_at: null,
        completed_by_name: null, is_current: true, stage: null, team_member: null, executed_by: null,
      },
    ],
    work_stages: [
      { id: STAGE_A3, tenant_id: TENANT_A, name: "Acabado", icon: "finish", active: true, sort_order: 2 },
      { id: STAGE_A_OFF, tenant_id: TENANT_A, name: "Corte", icon: "cut", active: false, sort_order: 1 },
      { id: STAGE_A, tenant_id: TENANT_A, name: "Diseño", icon: "design", active: true, sort_order: 0 },
      { id: STAGE_B, tenant_id: TENANT_B, name: "Diseño B", icon: "design", active: true, sort_order: 0 },
    ],
  };
}

function harness(options: Options = {}) {
  const role = options.role ?? "staff";
  const data = tables(options);
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const queries: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const db = {
    from(table: string) {
      let rows = data[table] ?? [];
      let single = false;
      const filters: Array<[string, unknown]> = [];
      queries.push({ table, filters });
      const query = {
        select: () => query,
        eq(key: string, value: unknown) {
          filters.push([key, value]);
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        order: () => query,
        maybeSingle() {
          single = true;
          return query;
        },
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      // Args are built inside the vm realm: clone them so deepEqual compares values.
      rpcCalls.push({ name, args: JSON.parse(JSON.stringify(args)) });
      if (name === "tenant_has_feature") {
        return { data: options.feature !== false, error: null };
      }
      const body = options.rpc?.[name] ?? defaultRpc(name);
      return { data: body, error: null };
    },
  };

  function load(relative: string) {
    const filename = path.join(root, relative);
    const exports: Record<string, Handler> = {};
    const realRequire = createRequire(filename);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(
      compiled,
      {
        exports,
        console: { ...console, error: () => undefined },
        require(id: string) {
          if (id === "@/lib/tenant/access-response") {
            const { NextResponse } = realRequire("next/server") as typeof import("next/server");
            return {
              requireCurrentAccess: async () =>
                role === "none"
                  ? { ok: false, response: NextResponse.json({ error: "Session expired", code: "SESSION_EXPIRED" }, { status: 401 }) }
                  : {
                      ok: true,
                      context: {
                        tenant: { id: TENANT_A, name: "Demo", slug: "demo" },
                        user: { id: "user-a" },
                        membership: { role, active: true },
                      },
                    },
            };
          }
          if (id === "@/lib/supabase/server") return { createClient: async () => db };
          return realRequire(id.startsWith("@/") ? path.join(root, id.slice(2)) : id);
        },
      },
      { filename }
    );
    return exports;
  }

  return { load, rpcCalls, queries };
}

function defaultRpc(name: string) {
  if (name === "replace_order_work_steps_v1") return { ok: true, changed: true, row_version: "8", steps: [] };
  if (name === "set_order_work_step_done_v1") return { ok: true, changed: true, row_version: "8", step: {} };
  if (name === "create_suggested_work_stages_v1") return { ok: true, changed: true, created: 4 };
  if (name === "upsert_work_stage_v1") {
    return { ok: true, changed: true, stage: { id: STAGE_A, name: "Diseño", icon: "design", active: true, sort_order: 0 } };
  }
  return { ok: false, error: "unexpected_rpc" };
}

const STEPS_ROUTE = "app/api/orders/[id]/work-steps/route.ts";
const DONE_ROUTE = "app/api/orders/[id]/work-steps/[stepId]/done/route.ts";
const STAGES_ROUTE = "app/api/work-stages/route.ts";

function request(method: string, body?: unknown, raw?: string) {
  const withBody = method !== "GET" && method !== "HEAD";
  return new NextRequest("http://demo.localhost/api/test", {
    method,
    ...(!withBody ? {} : raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json" },
  });
}

const stepsParams = (id: string) => ({ params: Promise.resolve({ id }) });
const doneParams = (id: string, stepId: string) => ({ params: Promise.resolve({ id, stepId }) });
const validPut = {
  expected_version: "7",
  steps: [
    { id: STEP_A, stage_id: STAGE_A, team_member_id: MEMBER_A },
    { stage_id: STAGE_A3, team_member_id: null },
  ],
};

const businessRpcs = <T extends { name: string }>(calls: T[]) => calls.filter((call) => call.name !== "tenant_has_feature");

describe("GET /api/orders/[id]/work-steps", () => {
  it("answers 401 without a session before touching the database", async () => {
    const h = harness({ role: "none" });
    const response = await h.load(STEPS_ROUTE).GET(request("GET"), stepsParams(ORDER_A));
    assert.equal(response.status, 401);
    assert.equal(h.rpcCalls.length, 0);
    assert.equal(h.queries.length, 0);
  });

  it("answers 404 when the tenant does not have order_work_sequence", async () => {
    const h = harness({ feature: false });
    const response = await h.load(STEPS_ROUTE).GET(request("GET"), stepsParams(ORDER_A));
    assert.equal(response.status, 404);
    assert.deepEqual(h.rpcCalls, [
      { name: "tenant_has_feature", args: { p_tenant_id: TENANT_A, p_code: "order_work_sequence" } },
    ]);
    assert.equal(h.queries.length, 0);
  });

  it("answers 404 for a malformed id and for another tenant's order", async () => {
    for (const id of ["nope", ORDER_B]) {
      const h = harness();
      const response = await h.load(STEPS_ROUTE).GET(request("GET"), stepsParams(id));
      assert.equal(response.status, 404);
      assert.equal(h.queries.some((q) => q.table === "order_work_steps"), false);
    }
    const h = harness();
    await h.load(STEPS_ROUTE).GET(request("GET"), stepsParams(ORDER_B));
    assert.deepEqual(h.queries[0], { table: "orders", filters: [["tenant_id", TENANT_A], ["id", ORDER_B]] });
  });

  it("returns ordered steps with stage, person, executor and the active stages", async () => {
    const h = harness();
    const response = await h.load(STEPS_ROUTE).GET(request("GET"), stepsParams(ORDER_A));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const body = await response.json();
    assert.equal(body.order_id, ORDER_A);
    assert.equal(body.row_version, "7");
    assert.equal(body.archived, false);
    assert.equal(body.can_edit, true);
    assert.deepEqual(body.steps.map((s: Row) => s.id), [STEP_A, STEP_A2]);
    assert.deepEqual(body.steps[0], {
      id: STEP_A,
      position: 1,
      stage: { id: STAGE_A, name: "Diseño", icon: "design", active: true },
      team_member: { id: MEMBER_A, name: "Jesús", active: true, can_receive_orders: true },
      executed_by: { id: MEMBER_A, name: "Jesús" },
      done: true,
      completed_at: "2026-10-28T09:15:00Z",
      completed_by_name: "Tamara",
      is_current: false,
    });
    assert.equal(body.steps[1].is_current, true);
    assert.equal(body.steps[1].team_member.active, false);
    assert.deepEqual(body.stages.map((s: Row) => s.name), ["Diseño", "Acabado"]);
    const stepQuery = h.queries.find((q) => q.table === "order_work_steps");
    assert.deepEqual(stepQuery?.filters, [["tenant_id", TENANT_A], ["order_id", ORDER_A]]);
  });

  it("lets viewers read but not edit, and nobody edit an archived order", async () => {
    const viewer = await (await harness({ role: "viewer" }).load(STEPS_ROUTE).GET(request("GET"), stepsParams(ORDER_A))).json();
    assert.equal(viewer.can_edit, false);
    assert.equal(viewer.steps.length, 2);
    const archived = await (await harness({ archived: true }).load(STEPS_ROUTE).GET(request("GET"), stepsParams(ORDER_A))).json();
    assert.equal(archived.archived, true);
    assert.equal(archived.can_edit, false);
  });
});

describe("PUT /api/orders/[id]/work-steps", () => {
  it("answers 401, feature-off 404 and viewer 403 without calling the RPC", async () => {
    for (const [options, status] of [
      [{ role: "none" }, 401],
      [{ feature: false }, 404],
      [{ feature: false, role: "viewer" }, 404],
      [{ role: "viewer" }, 403],
    ] as const) {
      const h = harness(options);
      const response = await h.load(STEPS_ROUTE).PUT(request("PUT", validPut), stepsParams(ORDER_A));
      assert.equal(response.status, status, JSON.stringify(options));
      assert.equal(businessRpcs(h.rpcCalls).length, 0);
    }
  });

  it("validates the payload with the index and field of the bad step", async () => {
    const cases: Array<[unknown, string, number | undefined, string | undefined]> = [
      [{ steps: [] }, "invalid_version", undefined, "expected_version"],
      [{ expected_version: "7" }, "invalid_steps", undefined, "steps"],
      [{ expected_version: "7", steps: [{ stage_id: STAGE_A }, { stage_id: "x" }] }, "invalid_steps", 1, "stage_id"],
      [{ expected_version: "7", steps: [{ stage_id: STAGE_A, team_member_id: 5 }] }, "invalid_steps", 0, "team_member_id"],
      [{ expected_version: "7", steps: [{ id: STEP_A, stage_id: STAGE_A }, { id: STEP_A, stage_id: STAGE_A }] }, "invalid_steps", 1, "id"],
      [{ expected_version: "7", steps: Array.from({ length: 11 }, () => ({ stage_id: STAGE_A })) }, "too_many_steps", undefined, undefined],
    ];
    for (const [body, code, index, field] of cases) {
      const h = harness();
      const response = await h.load(STEPS_ROUTE).PUT(request("PUT", body), stepsParams(ORDER_A));
      assert.equal(response.status, 422, code);
      const json = await response.json();
      assert.equal(json.code, code);
      assert.equal(json.index, index);
      assert.equal(json.field, field);
      assert.equal(businessRpcs(h.rpcCalls).length, 0);
    }
    const h = harness();
    const response = await h.load(STEPS_ROUTE).PUT(request("PUT", undefined, "{not json"), stepsParams(ORDER_A));
    assert.equal(response.status, 422);
  });

  it("answers 404 for another tenant's order without calling the RPC", async () => {
    const h = harness();
    const response = await h.load(STEPS_ROUTE).PUT(request("PUT", validPut), stepsParams(ORDER_B));
    assert.equal(response.status, 404);
    assert.equal(businessRpcs(h.rpcCalls).length, 0);
  });

  it("sends only the allowlisted step keys and returns the new version and sequence", async () => {
    const h = harness();
    const body = {
      ...validPut,
      tenant_id: TENANT_B,
      steps: [{ ...validPut.steps[0], done: true, tenant_id: TENANT_B }, validPut.steps[1]],
    };
    const response = await h.load(STEPS_ROUTE).PUT(request("PUT", body), stepsParams(ORDER_A));
    assert.equal(response.status, 200);
    const [call] = businessRpcs(h.rpcCalls);
    assert.deepEqual(call, {
      name: "replace_order_work_steps_v1",
      args: {
        p_order_id: ORDER_A,
        p_expected_row_version: "7",
        p_steps: [
          { id: STEP_A, stage_id: STAGE_A, team_member_id: MEMBER_A },
          { stage_id: STAGE_A3, team_member_id: null },
        ],
      },
    });
    const json = await response.json();
    assert.equal(json.changed, true);
    assert.equal(json.row_version, "8");
    assert.equal(json.steps.length, 2);
    assert.equal(json.stages.length, 2);
  });

  it("maps every RPC error to its HTTP status", async () => {
    const cases: Array<[Row, number, Row]> = [
      [{ ok: false, error: "not_found" }, 404, { code: "not_found" }],
      [{ ok: false, error: "forbidden" }, 403, { code: "forbidden" }],
      [{ ok: false, error: "order_archived" }, 409, { code: "order_archived" }],
      [{ ok: false, error: "conflict", row_version: "9" }, 409, { code: "conflict", row_version: "9" }],
      [{ ok: false, error: "step_done", step_id: STEP_A }, 409, { code: "step_done", step_id: STEP_A }],
      [{ ok: false, error: "step_done", index: 1 }, 409, { code: "step_done", index: 1 }],
      [{ ok: false, error: "invalid_steps", index: 0, field: "id" }, 422, { code: "invalid_steps", index: 0, field: "id" }],
      [{ ok: false, error: "too_many_steps" }, 422, { code: "too_many_steps" }],
      [{ ok: false, error: "stage_inactive", index: 1 }, 422, { code: "stage_inactive", index: 1 }],
      [{ ok: false, error: "member_unassignable", index: 0 }, 422, { code: "member_unassignable", index: 0 }],
      [{ ok: false, error: "something_new" }, 500, { code: "unknown" }],
    ];
    for (const [rpcBody, status, expected] of cases) {
      const h = harness({ rpc: { replace_order_work_steps_v1: rpcBody } });
      const response = await h.load(STEPS_ROUTE).PUT(request("PUT", validPut), stepsParams(ORDER_A));
      assert.equal(response.status, status, String(rpcBody.error));
      const json = await response.json();
      for (const [key, value] of Object.entries(expected)) {
        assert.equal(json[key], value, `${rpcBody.error}.${key}`);
      }
      assert.equal(typeof json.error, "string");
    }
  });
});

describe("POST /api/orders/[id]/work-steps/[stepId]/done", () => {
  it("answers 401, feature-off 404 and viewer 403 without calling the RPC", async () => {
    for (const [options, status] of [
      [{ role: "none" }, 401],
      [{ feature: false }, 404],
      [{ role: "viewer" }, 403],
    ] as const) {
      const h = harness(options);
      const response = await h.load(DONE_ROUTE).POST(request("POST", { done: true }), doneParams(ORDER_A, STEP_A2));
      assert.equal(response.status, status);
      assert.equal(businessRpcs(h.rpcCalls).length, 0);
    }
  });

  it("answers 404 when the step is not in the order of the URL or the tenant", async () => {
    for (const [orderId, stepId] of [
      [ORDER_A, STEP_OTHER],
      [ORDER_A, STEP_B],
      [ORDER_B, STEP_B],
      [ORDER_A, "nope"],
    ]) {
      const h = harness();
      const response = await h.load(DONE_ROUTE).POST(request("POST", { done: true }), doneParams(orderId, stepId));
      assert.equal(response.status, 404, `${orderId}/${stepId}`);
      assert.equal(businessRpcs(h.rpcCalls).length, 0);
    }
    const h = harness();
    await h.load(DONE_ROUTE).POST(request("POST", { done: true }), doneParams(ORDER_A, STEP_OTHER));
    assert.deepEqual(h.queries[0].filters, [["tenant_id", TENANT_A], ["order_id", ORDER_A], ["id", STEP_OTHER]]);
  });

  it("validates done and executed_by", async () => {
    for (const body of [{}, { done: "yes" }, { done: true, executed_by: "x" }, { done: false, executed_by: MEMBER_A }]) {
      const h = harness();
      const response = await h.load(DONE_ROUTE).POST(request("POST", body), doneParams(ORDER_A, STEP_A2));
      assert.equal(response.status, 422, JSON.stringify(body));
      assert.equal(businessRpcs(h.rpcCalls).length, 0);
    }
  });

  it("marks with the chosen executor and returns the version, the step and the sequence", async () => {
    const h = harness();
    const response = await h.load(DONE_ROUTE).POST(
      request("POST", { done: true, executed_by: MEMBER_A, tenant_id: TENANT_B }),
      doneParams(ORDER_A, STEP_A2)
    );
    assert.equal(response.status, 200);
    assert.deepEqual(businessRpcs(h.rpcCalls), [
      { name: "set_order_work_step_done_v1", args: { p_step_id: STEP_A2, p_done: true, p_executed_by: MEMBER_A } },
    ]);
    const json = await response.json();
    assert.equal(json.row_version, "8");
    assert.equal(json.step.id, STEP_A2);
    assert.equal(json.steps.length, 2);

    const undo = harness();
    await undo.load(DONE_ROUTE).POST(request("POST", { done: false }), doneParams(ORDER_A, STEP_A));
    assert.deepEqual(businessRpcs(undo.rpcCalls)[0].args, { p_step_id: STEP_A, p_done: false, p_executed_by: null });
  });

  it("maps every RPC error to its HTTP status", async () => {
    const cases: Array<[string, number]> = [
      ["not_found", 404],
      ["forbidden", 403],
      ["order_archived", 409],
      ["step_unassigned", 422],
      ["member_unassignable", 422],
      ["invalid_action", 422],
    ];
    for (const [error, status] of cases) {
      const h = harness({ rpc: { set_order_work_step_done_v1: { ok: false, error } } });
      const response = await h.load(DONE_ROUTE).POST(request("POST", { done: true }), doneParams(ORDER_A, STEP_A2));
      assert.equal(response.status, status, error);
      assert.equal((await response.json()).code, error);
    }
  });
});

describe("/api/work-stages", () => {
  it("answers 401 and feature-off 404 for every method", async () => {
    for (const method of ["GET", "POST", "PATCH"]) {
      const unauth = harness({ role: "none" });
      assert.equal((await unauth.load(STAGES_ROUTE)[method](request(method, { suggested: true }))).status, 401);
      assert.equal(unauth.rpcCalls.length, 0);
      const off = harness({ feature: false, role: "owner" });
      assert.equal((await off.load(STAGES_ROUTE)[method](request(method, { suggested: true }))).status, 404);
      assert.equal(businessRpcs(off.rpcCalls).length, 0);
      assert.equal(off.queries.length, 0);
    }
  });

  it("lists every stage of the session tenant, inactive ones included, by sort order", async () => {
    for (const [role, canManage] of [["staff", false], ["viewer", false], ["manager", true], ["owner", true]] as const) {
      const h = harness({ role });
      const response = await h.load(STAGES_ROUTE).GET(request("GET"));
      assert.equal(response.status, 200);
      const json = await response.json();
      assert.deepEqual(json.stages.map((s: Row) => s.name), ["Diseño", "Corte", "Acabado"]);
      assert.equal(json.stages[1].active, false);
      assert.equal(json.can_manage, canManage);
      assert.deepEqual(h.queries[0].filters, [["tenant_id", TENANT_A]]);
    }
  });

  it("refuses writes to staff and viewers with 403", async () => {
    for (const role of ["staff", "viewer"]) {
      for (const method of ["POST", "PATCH"]) {
        const h = harness({ role });
        const response = await h.load(STAGES_ROUTE)[method](request(method, { suggested: true, id: STAGE_A, active: false }));
        assert.equal(response.status, 403);
        assert.equal(businessRpcs(h.rpcCalls).length, 0);
      }
    }
  });

  it("creates the suggested stages for the session tenant only", async () => {
    const h = harness({ role: "manager" });
    const response = await h.load(STAGES_ROUTE).POST(request("POST", { suggested: true, tenant_id: TENANT_B }));
    assert.equal(response.status, 201);
    assert.deepEqual(businessRpcs(h.rpcCalls), [
      { name: "create_suggested_work_stages_v1", args: { p_tenant_id: TENANT_A } },
    ]);
    const json = await response.json();
    assert.equal(json.created, 4);
    assert.equal(json.stages.length, 3);

    const again = harness({ role: "manager", rpc: { create_suggested_work_stages_v1: { ok: true, changed: false, created: 0 } } });
    assert.equal((await again.load(STAGES_ROUTE).POST(request("POST", { suggested: true }))).status, 200);
  });

  it("creates one stage with a normalised name", async () => {
    const h = harness({ role: "admin" });
    const response = await h.load(STAGES_ROUTE).POST(request("POST", { name: "  Corte   final ", icon: "cut", tenant_id: TENANT_B }));
    assert.equal(response.status, 201);
    assert.deepEqual(businessRpcs(h.rpcCalls)[0], {
      name: "upsert_work_stage_v1",
      args: { p_tenant_id: TENANT_A, p_stage_id: null, p_name: "Corte final", p_icon: "cut", p_active: null, p_sort_order: null },
    });
  });

  it("validates stage payloads and maps the RPC errors", async () => {
    for (const [body, code] of [
      [{ name: "", icon: "cut" }, "invalid_name"],
      [{ name: "x".repeat(41), icon: "cut" }, "invalid_name"],
      [{ name: "Corte", icon: "rocket" }, "invalid_icon"],
      [{ name: "Corte", icon: "cut", sort_order: 1001 }, "invalid_sort_order"],
    ] as const) {
      const h = harness({ role: "owner" });
      const response = await h.load(STAGES_ROUTE).POST(request("POST", body));
      assert.equal(response.status, 422);
      assert.equal((await response.json()).code, code);
      assert.equal(businessRpcs(h.rpcCalls).length, 0);
    }
    for (const [error, status] of [
      ["duplicate_name", 422],
      ["too_many_stages", 422],
      ["invalid_name", 422],
      ["invalid_icon", 422],
      ["invalid_sort_order", 422],
      ["forbidden", 403],
      ["not_found", 404],
    ] as const) {
      const h = harness({ role: "owner", rpc: { upsert_work_stage_v1: { ok: false, error } } });
      const response = await h.load(STAGES_ROUTE).POST(request("POST", { name: "Corte", icon: "cut" }));
      assert.equal(response.status, status, error);
      assert.equal((await response.json()).code, error);
    }
  });

  it("patches a stage of the session tenant, filling the fields it leaves out", async () => {
    const h = harness({ role: "manager" });
    const response = await h.load(STAGES_ROUTE).PATCH(request("PATCH", { id: STAGE_A_OFF, active: true }));
    assert.equal(response.status, 200);
    assert.deepEqual(businessRpcs(h.rpcCalls)[0].args, {
      p_tenant_id: TENANT_A,
      p_stage_id: STAGE_A_OFF,
      p_name: "Corte",
      p_icon: "cut",
      p_active: true,
      p_sort_order: null,
    });

    const reorder = harness({ role: "manager" });
    await reorder.load(STAGES_ROUTE).PATCH(request("PATCH", { id: STAGE_A, sort_order: 5, name: "Diseño gráfico" }));
    assert.deepEqual(businessRpcs(reorder.rpcCalls)[0].args, {
      p_tenant_id: TENANT_A,
      p_stage_id: STAGE_A,
      p_name: "Diseño gráfico",
      p_icon: "design",
      p_active: null,
      p_sort_order: 5,
    });
  });

  it("answers 404 for another tenant's stage and 422 for an empty patch", async () => {
    const other = harness({ role: "owner" });
    assert.equal((await other.load(STAGES_ROUTE).PATCH(request("PATCH", { id: STAGE_B, active: false }))).status, 404);
    assert.equal(businessRpcs(other.rpcCalls).length, 0);
    const empty = harness({ role: "owner" });
    assert.equal((await empty.load(STAGES_ROUTE).PATCH(request("PATCH", { id: STAGE_A }))).status, 422);
    const bad = harness({ role: "owner" });
    assert.equal((await bad.load(STAGES_ROUTE).PATCH(request("PATCH", { id: "x", active: false }))).status, 404);
  });
});
