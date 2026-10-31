import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import { describe, it } from "node:test";
import ts from "typescript";
import { NextRequest } from "next/server";

// SUR4 E6: the real /api/orders/[id]/notes/** handlers with only the session
// and the database replaced. Roles, tenants and states inside the RPCs are
// covered by supabase/tests/phase60_order_notes_v1.sql; here we check what the
// HTTP layer adds: session, feature, tenant scope, input and error mapping.
const root = path.resolve(import.meta.dirname, "../../..");
const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const orderA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const orderA2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const orderB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb01";
const ownNote = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11";
const otherNote = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12";
const resolvedNote = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13";
const voidedNote = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa14";
const noteOfOrderA2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa15";
const noteOfTenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb11";
const versionA1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa21";
const versionA2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa22";
const eventA1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa31";
const eventA2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa32";
const eventA3 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa33";
const memberA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa41";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa51";
const someoneElse = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa52";

type Row = Record<string, unknown>;
type Handler = (request: NextRequest, context: unknown) => Promise<Response>;

function note(id: string, patch: Row = {}): Row {
  return {
    id,
    tenant_id: tenantA,
    order_id: orderA,
    body: `<p>Texto ${id.slice(-2)}</p>`,
    visibility: "internal",
    state: "open",
    pinned: false,
    author_user_id: actor,
    author_name: "Raquel",
    row_version: 1,
    created_at: "2026-10-28T09:00:00Z",
    updated_at: "2026-10-28T09:00:00Z",
    resolved_at: null,
    voided_at: null,
    void_reason: null,
    printable_authorized_at: null,
    redacted_at: null,
    addressee: null,
    ...patch,
  };
}

const ROUTES = {
  list: "app/api/orders/[id]/notes/route.ts",
  note: "app/api/orders/[id]/notes/[noteId]/route.ts",
  state: "app/api/orders/[id]/notes/[noteId]/state/route.ts",
  redact: "app/api/orders/[id]/notes/[noteId]/redact/route.ts",
  convert: "app/api/orders/[id]/notes/convert-legacy/route.ts",
} as const;

type Options = {
  role?: string | null;
  feature?: boolean;
  archived?: boolean;
  rpc?: (name: string, args: Row) => { data: unknown; error: unknown };
};

function harness(options: Options = {}) {
  const role = options.role === undefined ? "staff" : options.role;
  const feature = options.feature ?? true;
  const calls: Array<{ name: string; args: Row }> = [];
  const reads: Array<{ table: string; filters: Row; select: string }> = [];
  const tables: Record<string, Row[]> = {
    orders: [
      { id: orderA, tenant_id: tenantA, archived_at: options.archived ? "2026-10-27T10:00:00Z" : null },
      { id: orderA2, tenant_id: tenantA, archived_at: null },
      { id: orderB, tenant_id: tenantB, archived_at: null },
    ],
    order_notes: [
      note(ownNote, { pinned: true, created_at: "2026-10-28T08:00:00Z", addressee: { id: memberA, name: "Tamara", active: true } }),
      note(otherNote, { author_user_id: someoneElse, author_name: "Luis", created_at: "2026-10-28T10:00:00Z" }),
      note(resolvedNote, { state: "resolved", resolved_at: "2026-10-28T11:00:00Z", created_at: "2026-10-28T11:00:00Z" }),
      note(voidedNote, { state: "voided", body: null, redacted_at: "2026-10-28T12:00:00Z", voided_at: "2026-10-28T12:00:00Z", void_reason: "Texto suprimido", created_at: "2026-10-28T12:00:00Z" }),
      note(noteOfOrderA2, { order_id: orderA2 }),
      note(noteOfTenantB, { tenant_id: tenantB, order_id: orderB }),
    ],
    order_note_versions: [
      { id: versionA1, tenant_id: tenantA, note_id: ownNote, version: 1, body: null, redacted_at: "2026-10-28T12:00:00Z", created_at: "2026-10-28T08:00:00Z" },
      { id: versionA2, tenant_id: tenantA, note_id: ownNote, version: 2, body: "<p>Segunda</p>", redacted_at: null, created_at: "2026-10-28T08:30:00Z" },
    ],
    order_note_events: [
      { id: eventA1, tenant_id: tenantA, note_id: ownNote, action: "created", actor_name: "Raquel", created_at: "2026-10-28T08:00:00Z", reason: null, before: null, after: { state: "open" }, version_before_id: null, version_after_id: versionA1 },
      { id: eventA2, tenant_id: tenantA, note_id: ownNote, action: "edited", actor_name: "Raquel", created_at: "2026-10-28T08:30:00Z", reason: null, before: { state: "open" }, after: { state: "open" }, version_before_id: versionA1, version_after_id: versionA2 },
      { id: eventA3, tenant_id: tenantA, note_id: ownNote, action: "pinned", actor_name: "Luis", created_at: "2026-10-28T08:40:00Z", reason: "[motivo suprimido]", before: null, after: null, version_before_id: null, version_after_id: null },
    ],
    team_members: [
      { id: memberA, tenant_id: tenantA, name: "Tamara", active: true },
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa42", tenant_id: tenantA, name: "Inactiva", active: false },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb42", tenant_id: tenantB, name: "Otra empresa", active: true },
    ],
  };
  const db = {
    from(table: string) {
      const filters: Row = {};
      let select = "";
      let single = false;
      const query = {
        select(columns: string) { select = columns; return query; },
        eq(key: string, value: unknown) { filters[key] = value; return query; },
        order: () => query,
        limit: () => query,
        maybeSingle() { single = true; return query; },
        then(resolve: (value: unknown) => unknown) {
          reads.push({ table, filters: { ...filters }, select });
          const rows = (tables[table] ?? []).filter((row) => Object.entries(filters).every(([key, value]) => row[key] === value));
          return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
        },
      };
      return query;
    },
    async rpc(name: string, args: Row) {
      calls.push({ name, args });
      if (name === "tenant_has_feature") {
        return { data: feature && args.p_tenant_id === tenantA && args.p_code === "order_sticky_notes", error: null };
      }
      if (options.rpc) return options.rpc(name, args);
      if (name === "convert_order_legacy_notes_v1") {
        return { data: { ok: true, changed: true, note: { id: otherNote }, version: "8" }, error: null };
      }
      return { data: { ok: true, changed: true, note: { id: (args.p_note_id as string) ?? otherNote } }, error: null };
    },
  };
  const context = { tenant: { id: tenantA, name: "Demo", slug: "demo" }, user: { id: actor }, membership: { role, active: true } };
  function load(relative: string) {
    const filename = path.join(root, relative);
    const exports: Record<string, Handler> = {};
    const realRequire = createRequire(filename);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(compiled, {
      exports, console, URL,
      require(id: string) {
        if (id === "@/lib/tenant/access-response") {
          const { NextResponse } = realRequire("next/server") as typeof import("next/server");
          return {
            requireCurrentAccess: async () => role
              ? { ok: true, context }
              : { ok: false, response: NextResponse.json({ error: "Session expired", code: "SESSION_EXPIRED" }, { status: 401 }) },
          };
        }
        if (id === "@/lib/supabase/server") return { createClient: async () => db };
        return realRequire(id.startsWith("@/") ? path.join(root, id.slice(2)) : id);
      },
    }, { filename });
    return exports;
  }
  const noteCalls = () => calls.filter((call) => call.name !== "tenant_has_feature");
  return { calls, noteCalls, reads, load };
}

function request(method: string, body?: unknown, query = "") {
  return new NextRequest(`http://demo.localhost/api/orders/${orderA}/notes${query}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

const params = (id: string, noteId?: string) => ({ params: Promise.resolve(noteId ? { id, noteId } : { id }) });

type Call = { route: keyof typeof ROUTES; method: string; body?: unknown; note?: boolean };
const EVERY_ROUTE: Call[] = [
  { route: "list", method: "GET" },
  { route: "list", method: "POST", body: { body: "<p>Hola</p>" } },
  { route: "note", method: "GET", note: true },
  { route: "note", method: "PATCH", note: true, body: { expected_row_version: "1", body: "<p>Hola</p>" } },
  { route: "state", method: "POST", note: true, body: { action: "pin" } },
  { route: "redact", method: "POST", note: true, body: { reason_code: "personal_data_found", confirm: true } },
  { route: "convert", method: "POST", body: { expected_version: "7" } },
];

async function invoke(h: ReturnType<typeof harness>, call: Call, orderId = orderA, noteId = otherNote, query = "") {
  const handler = h.load(ROUTES[call.route])[call.method];
  assert.ok(handler, `${call.route} ${call.method}`);
  return handler(request(call.method, call.body, query), params(orderId, call.note ? noteId : undefined));
}

describe("post-it routes: session, feature and tenant scope", () => {
  it("answers 401 without a session before touching the database", async () => {
    for (const call of EVERY_ROUTE) {
      const h = harness({ role: null });
      const response = await invoke(h, call);
      assert.equal(response.status, 401, `${call.route} ${call.method}`);
      assert.equal(h.calls.length, 0);
      assert.equal(h.reads.length, 0);
    }
  });

  it("answers 404 on every route, GET included, when order_sticky_notes is off", async () => {
    for (const call of EVERY_ROUTE) {
      const h = harness({ role: "owner", feature: false });
      const response = await invoke(h, call);
      assert.equal(response.status, 404, `${call.route} ${call.method}`);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store, max-age=0, must-revalidate");
      assert.deepEqual(h.noteCalls(), []);
      assert.deepEqual(h.calls[0], { name: "tenant_has_feature", args: { p_tenant_id: tenantA, p_code: "order_sticky_notes" } });
      assert.equal(h.reads.length, 0);
    }
  });

  it("answers 404 for an order of another tenant, a malformed id and a note of another order", async () => {
    for (const call of EVERY_ROUTE) {
      for (const orderId of [orderB, "not-a-uuid"]) {
        const h = harness({ role: "owner" });
        const response = await invoke(h, call, orderId);
        assert.equal(response.status, 404, `${call.route} ${call.method} ${orderId}`);
        assert.deepEqual(h.noteCalls(), []);
        for (const read of h.reads) assert.equal(read.filters.tenant_id, tenantA);
      }
      if (!call.note) continue;
      for (const noteId of [noteOfOrderA2, noteOfTenantB, "nope"]) {
        const h = harness({ role: "owner" });
        const response = await invoke(h, call, orderA, noteId);
        assert.equal(response.status, 404, `${call.route} ${call.method} ${noteId}`);
        assert.deepEqual(h.noteCalls(), []);
        const noteRead = h.reads.find((read) => read.table === "order_notes");
        if (noteRead) {
          assert.equal(noteRead.filters.order_id, orderA);
          assert.equal(noteRead.filters.tenant_id, tenantA);
        }
      }
    }
  });

  it("takes the tenant from the session, never from the body", async () => {
    const h = harness({ role: "staff" });
    const response = await invoke(h, { route: "list", method: "POST", body: { body: "<p>Hola</p>", tenant_id: tenantB, p_tenant_id: tenantB } });
    assert.equal(response.status, 201);
    const [create] = h.noteCalls();
    assert.equal(create.name, "create_order_note_v1");
    assert.deepEqual(Object.keys(create.args).sort(), ["p_addressee", "p_body", "p_confirm_printable", "p_order_id", "p_pinned", "p_visibility"]);
    for (const read of h.reads) assert.equal(read.filters.tenant_id, tenantA);
  });
});

describe("GET /api/orders/[id]/notes", () => {
  it("lists the order's notes without voided ones, pinned first, with server permissions", async () => {
    const h = harness({ role: "staff" });
    const response = await invoke(h, { route: "list", method: "GET" });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.notes.map((n: Row) => n.id), [ownNote, otherNote, resolvedNote]);
    assert.equal(body.total, 4);
    assert.equal(body.voided_count, 1);
    assert.equal(body.can_create, true);
    assert.equal(body.archived, false);
    assert.equal(body.limit, 200);
    assert.deepEqual(body.addressees, [{ id: memberA, name: "Tamara" }]);
    const [own, other, resolved] = body.notes;
    assert.equal(own.addressee.name, "Tamara");
    assert.equal(own.row_version, "1");
    assert.equal(own.is_own, true);
    assert.deepEqual(own.permissions, { edit: true, pin: true, resolve: true, reopen: false, void: true, redact: false });
    assert.deepEqual(other.permissions, { edit: false, pin: true, resolve: true, reopen: false, void: false, redact: false });
    assert.deepEqual(resolved.permissions, { edit: false, pin: false, resolve: false, reopen: true, void: true, redact: false });
    const listRead = h.reads.find((read) => read.table === "order_notes");
    assert.match(String(listRead?.select), /team_members!order_notes_addressee_fk\(id, name, active\)/);
  });

  it("adds voided notes with ?voided=1 and hides suppressed text", async () => {
    const h = harness({ role: "owner" });
    const response = await invoke(h, { route: "list", method: "GET" }, orderA, otherNote, "?voided=1");
    const body = await response.json();
    assert.equal(body.include_voided, true);
    const voided = body.notes.find((n: Row) => n.id === voidedNote);
    assert.equal(voided.body, null);
    assert.equal(voided.redacted, true);
    assert.equal(voided.state, "voided");
    assert.equal(voided.permissions.redact, true);
    assert.equal(voided.permissions.void, false);
    assert.equal(body.notes.at(-1).id, voidedNote);
  });

  it("managers void any note; viewers and archived orders get no write permission", async () => {
    const manager = await (await invoke(harness({ role: "manager" }), { route: "list", method: "GET" })).json();
    assert.equal(manager.notes.find((n: Row) => n.id === otherNote).permissions.void, true);
    assert.equal(manager.notes.find((n: Row) => n.id === otherNote).permissions.edit, false);

    for (const options of [{ role: "viewer" }, { role: "owner", archived: true }]) {
      const h = harness(options);
      const body = await (await invoke(h, { route: "list", method: "GET" })).json();
      assert.equal(body.can_create, false);
      assert.deepEqual(body.addressees, []);
      for (const n of body.notes) {
        const { redact, ...rest } = n.permissions;
        assert.deepEqual(Object.values(rest), [false, false, false, false, false]);
        assert.equal(redact, options.role === "owner");
      }
      assert.equal(h.reads.some((read) => read.table === "team_members"), false);
    }
  });
});

describe("POST /api/orders/[id]/notes", () => {
  it("sanitizes the body on the server before the RPC and keeps the order text styles", async () => {
    const h = harness();
    const response = await invoke(h, {
      route: "list",
      method: "POST",
      body: {
        body: '<p data-text-align="center" onclick="x()"><span data-text-color="red" style="position:fixed">NO CORTAR</span><script>alert(1)</script><img src=x onerror=alert(1)></p>',
        visibility: "printable",
        pinned: true,
        addressee_team_member_id: memberA,
        confirm_printable: true,
      },
    });
    assert.equal(response.status, 201);
    const [create] = h.noteCalls();
    assert.deepEqual(create.args, {
      p_order_id: orderA,
      p_body: '<p data-text-align="center"><span data-text-color="red">NO CORTAR</span></p>',
      p_visibility: "printable",
      p_pinned: true,
      p_addressee: memberA,
      p_confirm_printable: true,
    });
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.note.id, otherNote);
  });

  it("rejects empty, too long or malformed input with 422 and no RPC", async () => {
    for (const payload of [
      { body: "" },
      { body: "<p>   </p><script>alert(1)</script>" },
      { body: `<p>${"x".repeat(4001)}</p>` },
      { body: 42 },
      { body: "<p>Hola</p>", visibility: "public" },
      { body: "<p>Hola</p>", addressee_team_member_id: "someone" },
      "not json",
    ]) {
      const h = harness();
      const response = await invoke(h, { route: "list", method: "POST", body: payload });
      assert.equal(response.status, 422, JSON.stringify(payload));
      assert.deepEqual(h.noteCalls(), []);
    }
  });

  it("refuses viewers with 403 before the RPC", async () => {
    const h = harness({ role: "viewer" });
    const response = await invoke(h, { route: "list", method: "POST", body: { body: "<p>Hola</p>" } });
    assert.equal(response.status, 403);
    assert.deepEqual(h.noteCalls(), []);
  });
});

describe("RPC errors in HTTP (contract §9)", () => {
  const MAPPING: Array<[string, number]> = [
    ["not_found", 404],
    ["forbidden", 403],
    ["order_archived", 409],
    ["conflict", 409],
    ["invalid_body", 422],
    ["invalid_visibility", 422],
    ["too_many_notes", 422],
    ["addressee_unavailable", 422],
    ["reason_required", 422],
    ["invalid_reason", 422],
    ["invalid_action", 422],
    ["printable_confirmation_required", 422],
    ["no_legacy_notes", 422],
    ["confirmation_required", 422],
    ["invalid_reason_code", 422],
    ["invalid_reason_target", 422],
    ["something_new", 500],
  ];

  it("maps every RPC error of every write route", async () => {
    for (const call of EVERY_ROUTE.filter((c) => c.method !== "GET")) {
      for (const [code, status] of MAPPING) {
        const h = harness({ role: "owner", rpc: () => ({ data: { ok: false, error: code, row_version: "5" }, error: null }) });
        const response = await invoke(h, call);
        assert.equal(response.status, status, `${call.route} ${code}`);
        const body = await response.json();
        assert.equal(body.code, status === 500 ? "unexpected" : code);
        assert.equal(typeof body.error, "string");
        if (code === "conflict") assert.equal(body.row_version, "5");
        else assert.equal("row_version" in body, false);
      }
    }
  });

  it("answers 500 when the RPC call itself fails", async () => {
    const h = harness({ rpc: () => ({ data: null, error: { code: "08006", message: "down" } }) });
    const response = await invoke(h, { route: "list", method: "POST", body: { body: "<p>Hola</p>" } });
    assert.equal(response.status, 500);
    assert.equal((await response.json()).code, "unexpected");
  });

  it("explains a conflict on a voided note as final", async () => {
    const h = harness({ role: "owner", rpc: () => ({ data: { ok: false, error: "conflict", row_version: "3" }, error: null }) });
    const response = await invoke(h, { route: "state", method: "POST", note: true, body: { action: "reopen" } }, orderA, voidedNote);
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.match(body.error, /anulada/);
    assert.equal(body.row_version, "3");
  });
});

describe("PATCH /api/orders/[id]/notes/[noteId]", () => {
  it("needs the note's row_version and sanitizes the new text", async () => {
    const missing = harness();
    const bad = await invoke(missing, { route: "note", method: "PATCH", note: true, body: { body: "<p>x</p>" } }, orderA, ownNote);
    assert.equal(bad.status, 422);
    assert.deepEqual(missing.noteCalls(), []);

    const h = harness();
    const response = await invoke(h, {
      route: "note", method: "PATCH", note: true,
      body: { expected_row_version: 3, body: "<p>Nuevo <b>texto</b><iframe></iframe></p>", visibility: "internal", tenant_id: tenantB },
    }, orderA, ownNote);
    assert.equal(response.status, 200);
    assert.deepEqual(h.noteCalls()[0], {
      name: "update_order_note_v1",
      args: { p_note_id: ownNote, p_expected_row_version: "3", p_body: "<p>Nuevo <strong>texto</strong></p>", p_visibility: "internal", p_confirm_printable: false },
    });
  });

  it("passes visibility alone and the printable confirmation", async () => {
    const h = harness();
    await invoke(h, { route: "note", method: "PATCH", note: true, body: { expected_row_version: "2", visibility: "printable", confirm_printable: true } }, orderA, ownNote);
    assert.deepEqual(h.noteCalls()[0].args, { p_note_id: ownNote, p_expected_row_version: "2", p_body: null, p_visibility: "printable", p_confirm_printable: true });
  });

  it("returns 409 with the current row_version on a stale edit", async () => {
    const h = harness({ rpc: () => ({ data: { ok: false, error: "conflict", row_version: "9" }, error: null }) });
    const response = await invoke(h, { route: "note", method: "PATCH", note: true, body: { expected_row_version: "2", body: "<p>x</p>" } }, orderA, ownNote);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).row_version, "9");
  });
});

describe("GET /api/orders/[id]/notes/[noteId] (history)", () => {
  it("joins events with the versions before and after, without suppressed text", async () => {
    const h = harness({ role: "viewer" });
    const response = await invoke(h, { route: "note", method: "GET", note: true }, orderA, ownNote);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.note.id, ownNote);
    assert.deepEqual(body.events.map((e: Row) => e.action), ["created", "edited", "pinned"]);
    const edited = body.events[1];
    assert.equal(edited.version_before.body, null);
    assert.equal(edited.version_before.redacted, true);
    assert.equal(edited.version_after.body, "<p>Segunda</p>");
    assert.equal(body.events[2].reason_redacted, true);
    assert.deepEqual(body.versions.map((v: Row) => v.version), [1, 2]);
    for (const read of h.reads) assert.equal(read.filters.tenant_id, tenantA);
    assert.deepEqual(h.noteCalls(), []);
  });
});

describe("POST /api/orders/[id]/notes/[noteId]/state", () => {
  it("validates the action and trims the reason", async () => {
    for (const payload of [{ action: "delete" }, {}, { action: "void", reason: 12 }, { action: "void", reason: "x".repeat(501) }]) {
      const h = harness();
      const response = await invoke(h, { route: "state", method: "POST", note: true, body: payload }, orderA, ownNote);
      assert.equal(response.status, 422, JSON.stringify(payload));
      assert.deepEqual(h.noteCalls(), []);
    }
    const h = harness();
    const response = await invoke(h, { route: "state", method: "POST", note: true, body: { action: "void", reason: "  Duplicada  " } }, orderA, ownNote);
    assert.equal(response.status, 200);
    assert.deepEqual(h.noteCalls()[0], { name: "set_order_note_state_v1", args: { p_note_id: ownNote, p_action: "void", p_reason: "Duplicada" } });
  });

  it("refuses viewers before the RPC", async () => {
    const h = harness({ role: "viewer" });
    const response = await invoke(h, { route: "state", method: "POST", note: true, body: { action: "pin" } }, orderA, ownNote);
    assert.equal(response.status, 403);
    assert.deepEqual(h.noteCalls(), []);
  });
});

describe("POST /api/orders/[id]/notes/[noteId]/redact (N22)", () => {
  it("answers 403 to every role but owner, before the RPC", async () => {
    for (const role of ["admin", "manager", "staff", "viewer"]) {
      const h = harness({ role });
      const response = await invoke(h, { route: "redact", method: "POST", note: true, body: { reason_code: "personal_data_found", confirm: true } }, orderA, ownNote);
      assert.equal(response.status, 403, role);
      assert.deepEqual(h.noteCalls(), []);
    }
  });

  it("sends the closed reason code, the flagged events and the confirmation", async () => {
    const h = harness({ role: "owner" });
    const response = await invoke(h, {
      route: "redact", method: "POST", note: true,
      body: { reason_code: "personal_data_request", reason_event_ids: [eventA3, eventA3], confirm: true },
    }, orderA, ownNote);
    assert.equal(response.status, 200);
    assert.deepEqual(h.noteCalls()[0], {
      name: "redact_order_note_v1",
      args: { p_note_id: ownNote, p_reason_code: "personal_data_request", p_reason_event_ids: [eventA3], p_confirm: true },
    });
  });

  it("validates confirmation, reason code and event ids", async () => {
    for (const [payload, code] of [
      [{ reason_code: "personal_data_found" }, "confirmation_required"],
      [{ reason_code: "porque sí", confirm: true }, "invalid_reason_code"],
      [{ reason_code: "personal_data_found", confirm: true, reason_event_ids: ["x"] }, "invalid_reason_target"],
      [{ reason_code: "personal_data_found", confirm: true, reason_event_ids: "x" }, "invalid_reason_target"],
    ] as const) {
      const h = harness({ role: "owner" });
      const response = await invoke(h, { route: "redact", method: "POST", note: true, body: payload }, orderA, ownNote);
      assert.equal(response.status, 422);
      assert.equal((await response.json()).code, code);
      assert.deepEqual(h.noteCalls(), []);
    }
  });
});

describe("POST /api/orders/[id]/notes/convert-legacy", () => {
  it("needs the order version and returns the new one", async () => {
    const missing = harness();
    assert.equal((await invoke(missing, { route: "convert", method: "POST", body: {} })).status, 422);
    assert.deepEqual(missing.noteCalls(), []);

    const h = harness({ role: "staff" });
    const response = await invoke(h, { route: "convert", method: "POST", body: { expected_version: "7", tenant_id: tenantB } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, version: "8", note_id: otherNote });
    assert.deepEqual(h.noteCalls()[0], { name: "convert_order_legacy_notes_v1", args: { p_order_id: orderA, p_expected_row_version: "7" } });
  });

  it("returns 409 with the current order version on conflict, 403 to viewers", async () => {
    const h = harness({ rpc: () => ({ data: { ok: false, error: "conflict", row_version: "11" }, error: null }) });
    const response = await invoke(h, { route: "convert", method: "POST", body: { expected_version: "7" } });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.row_version, "11");
    assert.match(body.error, /pedido/);

    const viewer = harness({ role: "viewer" });
    assert.equal((await invoke(viewer, { route: "convert", method: "POST", body: { expected_version: "7" } })).status, 403);
    assert.deepEqual(viewer.noteCalls(), []);
  });
});
