/**
 * Optional real PostgREST harness for orders list search escape + client embed OR.
 *
 * Runs when local Supabase REST is reachable (http://127.0.0.1:54321).
 * Skips cleanly otherwise (CI without local stack).
 *
 * Does NOT use Gestcopy production data. Creates/drops isolated harness tables.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { after, before, describe, it } from "node:test";
import {
  buildOrdersClientNameImatchValue,
  buildOrdersListSearchOrClause,
} from "./list-search";

const REST =
  process.env.LIST_SEARCH_REST_URL ?? "http://127.0.0.1:54321/rest/v1";
const DB_CONTAINER =
  process.env.LIST_SEARCH_DB_CONTAINER ?? "supabase_db_copyflow";
const SERVICE_ROLE =
  process.env.LIST_SEARCH_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const STATUS_OK = "cccccccc-cccc-4ccc-8ccc-ccccccccccc3";
const STATUS_OTHER = "dddddddd-dddd-4ddd-8ddd-ddddddddddd4";
const MEMBER = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5";
const STORE = "ffffffff-ffff-4fff-8fff-fffffffffff6";

async function restAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${REST.replace(/\/rest\/v1\/?$/, "")}/rest/v1/`, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok || res.status === 200 || res.status === 401 || res.status === 404;
  } catch {
    return false;
  }
}

function sql(script: string): void {
  const result = spawnSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
    { input: script, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(
      `psql failed (${result.status}): ${result.stderr || result.stdout}`
    );
  }
}

async function reloadSchema(): Promise<void> {
  sql(`NOTIFY pgrst, 'reload schema';`);
  // PostgREST picks up NOTIFY asynchronously
  await new Promise((r) => setTimeout(r, 800));
}

async function searchOrders(input: {
  tenantId: string;
  q: string;
  page?: number;
  pageSize?: number;
  statusId?: string;
  assignedTeamMemberId?: string;
  storeId?: string;
}): Promise<{ total: number; rows: Array<Record<string, unknown>> }> {
  const page = input.page ?? 1;
  const pageSize = input.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const re = buildOrdersClientNameImatchValue(input.q);
  const orClause = buildOrdersListSearchOrClause(input.q);

  const params = new URLSearchParams();
  params.set(
    "select",
    "id,reference,title,tenant_id,archived_at,client_id,client:list_search_harness_clients(*),client_search:list_search_harness_clients()"
  );
  params.set("tenant_id", `eq.${input.tenantId}`);
  params.set("archived_at", "is.null");
  if (input.statusId) params.set("status_id", `eq.${input.statusId}`);
  if (input.assignedTeamMemberId) {
    params.set("assigned_team_member_id", `eq.${input.assignedTeamMemberId}`);
  }
  if (input.storeId) params.set("store_id", `eq.${input.storeId}`);
  params.set("client_search.name", `imatch.${re}`);
  params.set("or", `(${orClause})`);
  params.set("order", "reference.asc");

  const url = `${REST}/list_search_harness_orders?${params.toString()}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Prefer: "count=exact",
      Range: `${from}-${to}`,
    },
  });
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status}: ${await res.text()}`);
  }
  const contentRange = res.headers.get("content-range") ?? "";
  const totalMatch = contentRange.match(/\/(\d+|\*)/);
  const total =
    totalMatch && totalMatch[1] !== "*"
      ? Number.parseInt(totalMatch[1], 10)
      : 0;
  const rows = (await res.json()) as Array<Record<string, unknown>>;
  return { total, rows };
}

describe("list-search PostgREST harness (local)", () => {
  let available = false;
  let setupError: Error | null = null;

  before(async () => {
    available = await restAvailable();
    if (!available) return;
    try {
      sql(`
DROP TABLE IF EXISTS list_search_harness_orders CASCADE;
DROP TABLE IF EXISTS list_search_harness_clients CASCADE;

CREATE TABLE list_search_harness_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL
);

CREATE TABLE list_search_harness_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  reference text,
  title text,
  archived_at timestamptz,
  client_id uuid REFERENCES list_search_harness_clients(id),
  status_id uuid,
  assigned_team_member_id uuid,
  store_id uuid
);

GRANT ALL ON list_search_harness_clients TO service_role, anon, authenticated;
GRANT ALL ON list_search_harness_orders TO service_role, anon, authenticated;

-- Literal / special-char fixtures (tenant A)
INSERT INTO list_search_harness_clients (id, tenant_id, name) VALUES
  ('11111111-1111-4111-8111-111111111101', '${TENANT_A}', 'Cliente Normal'),
  ('11111111-1111-4111-8111-111111111102', '${TENANT_A}', 'ZebraCorp SA'),
  ('11111111-1111-4111-8111-111111111103', '${TENANT_B}', 'ACME OTRO TENANT');

INSERT INTO list_search_harness_orders
  (id, tenant_id, reference, title, archived_at, client_id, status_id, assigned_team_member_id, store_id)
VALUES
  ('22222222-2222-4222-8222-222222222201', '${TENANT_A}', 'ref-demo-ok', 'Otro', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222202', '${TENANT_A}', 'plain', 'Trabajo urgente', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222203', '${TENANT_A}', 'plain2', 'title', NULL,
    '11111111-1111-4111-8111-111111111102', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222204', '${TENANT_A}', '100%_off', 'promo', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222205', '${TENANT_A}', '100XYoff', 'promo-false', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222206', '${TENANT_A}', 'path a\\b end', 'bs', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222207', '${TENANT_A}', 'path ab end', 'bs-false', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222208', '${TENANT_A}', 'code a*b ok', 'star', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222209', '${TENANT_A}', 'code axb ok', 'star-false', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222210', '${TENANT_A}', 'ref demo,0191', 'comma', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222211', '${TENANT_A}', 'note say "hello"', 'quotes', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222212', '${TENANT_A}', 'X).or(tenant_id.neq.0)', 'inject', NULL,
    '11111111-1111-4111-8111-111111111101', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222213', '${TENANT_A}', 'archived-zebra', 'Archivado Zebra', now(),
    '11111111-1111-4111-8111-111111111102', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222214', '${TENANT_B}', 'tenant-b-acme', 'B', NULL,
    '11111111-1111-4111-8111-111111111103', '${STATUS_OK}', '${MEMBER}', '${STORE}'),
  ('22222222-2222-4222-8222-222222222215', '${TENANT_A}', 'combo-miss-status', 'combo', NULL,
    '11111111-1111-4111-8111-111111111102', '${STATUS_OTHER}', '${MEMBER}', '${STORE}');

-- 201 ACME clients + orders (titles/refs do NOT contain ACME)
INSERT INTO list_search_harness_clients (id, tenant_id, name)
SELECT
  ('33333333-3333-4333-8333-' || lpad(g::text, 12, '0'))::uuid,
  '${TENANT_A}'::uuid,
  'ACME cliente ' || g
FROM generate_series(1, 201) AS g;

INSERT INTO list_search_harness_orders
  (id, tenant_id, reference, title, archived_at, client_id, status_id, assigned_team_member_id, store_id)
SELECT
  ('44444444-4444-4444-8444-' || lpad(g::text, 12, '0'))::uuid,
  '${TENANT_A}'::uuid,
  'bulk-ref-' || g,
  'bulk-title-' || g,
  NULL,
  ('33333333-3333-4333-8333-' || lpad(g::text, 12, '0'))::uuid,
  '${STATUS_OK}'::uuid,
  '${MEMBER}'::uuid,
  '${STORE}'::uuid
FROM generate_series(1, 201) AS g;
`);
      await reloadSchema();
    } catch (error) {
      setupError = error instanceof Error ? error : new Error(String(error));
    }
  });

  after(() => {
    if (!available) return;
    try {
      sql(`
DROP TABLE IF EXISTS list_search_harness_orders CASCADE;
DROP TABLE IF EXISTS list_search_harness_clients CASCADE;
NOTIFY pgrst, 'reload schema';
`);
    } catch {
      // best-effort cleanup
    }
  });

  function requireHarness(t: { skip: (msg?: string) => void }): void {
    if (!available) {
      t.skip("local PostgREST unavailable");
      return;
    }
    if (setupError) {
      throw setupError;
    }
  }

  it("finds by reference, title, and client.name (case-insensitive)", async (t) => {
    requireHarness(t);
    if (!available || setupError) return;

    const byRef = await searchOrders({ tenantId: TENANT_A, q: "demo" });
    assert.ok(byRef.rows.some((r) => r.reference === "ref-demo-ok"));

    const byTitle = await searchOrders({ tenantId: TENANT_A, q: "trabajo" });
    assert.ok(byTitle.rows.some((r) => r.title === "Trabajo urgente"));

    const byClient = await searchOrders({ tenantId: TENANT_A, q: "ZeBrA" });
    assert.ok(
      byClient.rows.some((r) => r.reference === "plain2"),
      "client name ZebraCorp should match case-insensitively"
    );
  });

  it("literals: 100%_off, a\\b, a*b", async (t) => {
    requireHarness(t);
    if (!available || setupError) return;

    const pct = await searchOrders({ tenantId: TENANT_A, q: "100%_off" });
    assert.equal(pct.total, 1);
    assert.equal(pct.rows[0]?.reference, "100%_off");

    const bs = await searchOrders({ tenantId: TENANT_A, q: "a\\b" });
    assert.equal(bs.total, 1);
    assert.equal(bs.rows[0]?.reference, "path a\\b end");

    const star = await searchOrders({ tenantId: TENANT_A, q: "a*b" });
    assert.equal(star.total, 1);
    assert.equal(star.rows[0]?.reference, "code a*b ok");
  });

  it("literals: comma, quotes, postgrest-looking text", async (t) => {
    requireHarness(t);
    if (!available || setupError) return;

    const comma = await searchOrders({ tenantId: TENANT_A, q: "demo,0191" });
    assert.equal(comma.total, 1);

    const quotes = await searchOrders({
      tenantId: TENANT_A,
      q: 'say "hello"',
    });
    assert.equal(quotes.total, 1);

    const inject = await searchOrders({
      tenantId: TENANT_A,
      q: "X).or(tenant_id.neq.0)",
    });
    assert.equal(inject.total, 1);
  });

  it("returns all 201 ACME client matches (no 200 cutoff) with pagination", async (t) => {
    requireHarness(t);
    if (!available || setupError) return;

    const page1 = await searchOrders({
      tenantId: TENANT_A,
      q: "acme",
      page: 1,
      pageSize: 50,
    });
    assert.equal(page1.total, 201);
    assert.equal(page1.rows.length, 50);

    const page4 = await searchOrders({
      tenantId: TENANT_A,
      q: "acme",
      page: 4,
      pageSize: 50,
    });
    assert.equal(page4.total, 201);
    assert.equal(page4.rows.length, 50);

    const page5 = await searchOrders({
      tenantId: TENANT_A,
      q: "acme",
      page: 5,
      pageSize: 50,
    });
    assert.equal(page5.total, 201);
    assert.equal(page5.rows.length, 1);
  });

  it("excludes other tenants and archived matches", async (t) => {
    requireHarness(t);
    if (!available || setupError) return;

    const acme = await searchOrders({ tenantId: TENANT_A, q: "acme" });
    assert.equal(acme.total, 201);
    assert.equal(
      acme.rows.some((r) => r.reference === "tenant-b-acme"),
      false
    );

    const zebra = await searchOrders({ tenantId: TENANT_A, q: "zebra" });
    // plain2 + combo-miss-status share ZebraCorp; archived-zebra must stay out
    assert.equal(zebra.total, 2);
    assert.equal(
      zebra.rows.some((r) => r.reference === "archived-zebra"),
      false
    );
    assert.equal(
      zebra.rows.some((r) => r.reference === "plain2"),
      true
    );
    assert.equal(
      zebra.rows.some((r) => r.reference === "combo-miss-status"),
      true
    );
  });

  it("AND-combines status / assignee / store with search OR", async (t) => {
    requireHarness(t);
    if (!available || setupError) return;

    const ok = await searchOrders({
      tenantId: TENANT_A,
      q: "zebra",
      statusId: STATUS_OK,
      assignedTeamMemberId: MEMBER,
      storeId: STORE,
    });
    assert.equal(ok.total, 1);
    assert.equal(ok.rows[0]?.reference, "plain2");

    const miss = await searchOrders({
      tenantId: TENANT_A,
      q: "zebra",
      statusId: STATUS_OTHER,
      assignedTeamMemberId: MEMBER,
      storeId: STORE,
    });
    assert.equal(miss.total, 1);
    assert.equal(miss.rows[0]?.reference, "combo-miss-status");
  });
});
