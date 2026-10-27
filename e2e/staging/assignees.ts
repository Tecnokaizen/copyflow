/** R6 on real Staging: synthetic members only; preserve old assignments,
 * filter new ones, reject forged assignments and check the actual selector.
 * No email, deletes, feature activation or Production credentials. */
/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded by the shared harness. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { resolveStagingTarget } from "./guard";
import { Harness } from "./harness";
import { Redactor } from "./redact";
import { requireSyntheticEmail, runId } from "./synthetic";
import { resolveForeignQuoteFixture } from "./foreign-fixtures";

async function main() {
  const target = resolveStagingTarget();
  requireSyntheticEmail(process.env.E2E_USER_EMAIL);
  assert.ok(process.env.E2E_USER_PASSWORD);
  const run = runId();
  const dir = path.join(process.env.E2E_ARTIFACTS_DIR ?? "e2e-artifacts", `assignees-${run}`);
  const h = new Harness(target, new Redactor([process.env.E2E_USER_PASSWORD, process.env.VERCEL_AUTOMATION_BYPASS_SECRET]), dir, process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const result: any = { run, deploymentSha: process.env.E2E_DEPLOYMENT_SHA ?? null, checks: {}, members: [], orderId: null };
  let p: any;
  async function call(url: string, method = "GET", data?: unknown) {
    assert.ok(url.startsWith("/api/"));
    const r = await p.request.fetch(target.baseUrl + url, { method, data, timeout: 60000, maxRedirects: 0 });
    h.log(`${method} ${url} → ${r.status()}`);
    return { status: r.status(), body: await r.json() };
  }
  async function memberUpdate(member: any, active: boolean, canReceive: boolean) {
    assert.ok(member.name.startsWith(`E2E R6 ${run} `));
    const r = await call(`/api/team/${member.id}`, "PATCH", { name: member.name, active, can_receive_orders: canReceive });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  async function detail() {
    const r = await call(`/api/orders/${result.orderId}`); assert.equal(r.status, 200);
    return r.body.order;
  }
  async function assign(id: string | null, expectedStatus = 200) {
    const before = await detail();
    const r = await call(`/api/orders/${result.orderId}/details`, "PATCH", { field: "assigned_team_member_id", value: id, expected_version: String(before.version) });
    assert.equal(r.status, expectedStatus, JSON.stringify(r.body));
  }
  try {
    await h.start(process.env.PLAYWRIGHT_MODULE!); p = h.page;
    await h.step("login, synthetic tenant and disabled voice", async () => {
      await p.goto(target.baseUrl + "/auth/login");
      await p.locator("#email").fill(process.env.E2E_USER_EMAIL!);
      await p.locator("#password").fill(process.env.E2E_USER_PASSWORD!);
      await Promise.all([p.waitForURL((u: URL) => u.origin === target.baseUrl && !u.pathname.startsWith("/auth/")), p.getByRole("button", { name: "Login", exact: true }).click()]);
      const c = await call("/api/context"); assert.equal(c.status, 200);
      assert.equal(c.body.tenant.slug, "e2e"); assert.equal(c.body.membership.role, "owner");
      const voice = await p.request.get(target.baseUrl + "/api/ai/voice-orders/status", { headers: { origin: target.baseUrl } });
      assert.ok([200, 404].includes(voice.status()));
      if (voice.status() === 200) assert.equal((await voice.json()).enabled, false);
      result.checks.tenantAndVoiceOff = true;
    });
    await h.step("new eligible members appear in both catalogs", async () => {
      for (const suffix of ["original", "replacement"]) {
        const name = `E2E R6 ${run} ${suffix}`;
        const r = await call("/api/team", "POST", { name, active: true, can_receive_orders: true });
        assert.equal(r.status, 201, JSON.stringify(r.body)); result.members.push(r.body.member);
      }
      const options = await call("/api/orders/options"); assert.equal(options.status, 200);
      const team = await call("/api/team?assignable=true"); assert.equal(team.status, 200);
      for (const member of result.members) {
        assert.ok(options.body.team_members.some((m: any) => m.id === member.id));
        assert.ok(team.body.members.some((m: any) => m.id === member.id));
      }
      const inactive = await call("/api/team", "POST", { name: `E2E R6 ${run} inactive`, active: false, can_receive_orders: true });
      assert.equal(inactive.status, 201); result.members.push(inactive.body.member);
      const filtered = await call("/api/team?assignable=true");
      assert.ok(!filtered.body.members.some((m: any) => m.id === inactive.body.member.id));
      const orderOptions = await call("/api/orders/options");
      assert.ok(!orderOptions.body.team_members.some((m: any) => m.id === inactive.body.member.id));
      result.checks.catalogsEligible = true;
    });
    const [original, replacement] = result.members;
    await h.step("create assigned order and preserve it after permission removal", async () => {
      const r = await call("/api/orders", "POST", { title: `E2E R6 ${run}`, assigned_team_member_id: original.id });
      assert.equal(r.status, 201, JSON.stringify(r.body)); result.orderId = r.body.order.id;
      await memberUpdate(original, true, false);
      assert.equal((await detail()).assigned_team_member_id, original.id);
      const options = await call("/api/orders/options"); assert.equal(options.status, 200);
      const team = await call("/api/team?assignable=true"); assert.equal(team.status, 200);
      assert.ok(!options.body.team_members.some((m: any) => m.id === original.id));
      assert.ok(!team.body.members.some((m: any) => m.id === original.id));
      await assign(original.id); // unchanged historical assignment is legal
      const before = await detail();
      const edited = await call(`/api/orders/${result.orderId}/content`, "PATCH", { field: "description", value: "<p>E2E R6 other field</p>", expected_version: String(before.version) });
      assert.equal(edited.status, 200, JSON.stringify(edited.body));
      const after = await detail(); assert.equal(after.assigned_team_member_id, original.id);
      assert.equal(after.description, "<p>E2E R6 other field</p>");
      result.checks.historicalAssignmentPreserved = true;
    });
    await h.step("real selector shows the old assignee disabled as unavailable", async () => {
      await p.goto(`${target.baseUrl}/orders/${result.orderId}`);
      await p.getByRole("button", { name: "Cambiar responsable", exact: true }).click();
      const old = p.getByRole("option", { name: `${original.name} (no disponible)`, exact: true });
      await old.waitFor({ state: "attached" });
      // Playwright 1.58.2 isDisabled() returns false for a native option even
      // when its disabled property/attribute are true; inspect the browser DOM.
      assert.equal(await old.evaluate((e: HTMLOptionElement) => e.disabled), true);
      assert.notEqual(await old.getAttribute("disabled"), null);
      await p.getByRole("option", { name: replacement.name, exact: true }).waitFor({ state: "attached" });
      const selector = p.getByRole("dialog").getByRole("combobox");
      await selector.selectOption(replacement.id);
      assert.equal(await selector.inputValue(), replacement.id, "eligible replacement is selectable");
      await h.screenshot("r6-responsable-historico");
      await p.getByRole("button", { name: "Cancelar", exact: true }).click();
      result.checks.selectorUnavailable = true;
    });
    await h.step("reassign, reject ineligible assignments and clear", async () => {
      await assign(replacement.id);
      await assign(original.id, 400);
      assert.equal((await detail()).assigned_team_member_id, replacement.id);
      const rejected = await call("/api/orders", "POST", { title: `E2E R6 refused ${run}`, assigned_team_member_id: original.id });
      assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
      await assign(null); assert.equal((await detail()).assigned_team_member_id, null);
      result.checks.reassignmentAndRejections = true;
    });
    await h.step("quote draft rejects an ineligible member and acknowledges success", async () => {
      const payload = {
        creation_id: randomUUID(), prepare: false, client_id: null, service_id: null, assigned_team_member_id: original.id,
        header: { title: `E2E R6 quote ${run}`, description: "<p>R6 synthetic quote</p>", terms: null,
          contact_name: null, contact_email: null, contact_phone: null, billing_name: null, tax_id: null, billing_address: null,
          issue_date: new Date().toISOString().slice(0, 10), valid_until: null, currency: "EUR", prices_include_tax: true },
        items: [{ concept: "R6 synthetic", description: null, quantity: "1", unit: "ud", unit_price: "10", discount_percent: "0", tax_rate: "21" }],
      };
      const denied = await call("/api/quotes/create-draft", "POST", payload); assert.equal(denied.status, 422, JSON.stringify(denied.body));
      payload.creation_id = randomUUID(); payload.assigned_team_member_id = replacement.id;
      const created = await call("/api/quotes/create-draft", "POST", payload); assert.equal(created.status, 200, JSON.stringify(created.body));
      const ack = await call("/api/quotes/creation-recovery", "POST", { operation_id: payload.creation_id });
      assert.equal(ack.status, 200); assert.equal(ack.body.quote_id, payload.creation_id);
      result.quoteId = payload.creation_id; result.checks.quoteEligibilityAndAck = true;
    });
    await h.step("modify quote, reject invalid assignee, prepare and convert with eligible assignee", async () => {
      async function quote() {
        const r = await call(`/api/quotes/${result.quoteId}`); assert.equal(r.status, 200); return r.body.quote;
      }
      const initial = await quote();
      const invalid = await call(`/api/quotes/${result.quoteId}`, "PATCH", { operational_only: true, expected_row_version: initial.row_version, client_id: null, service_id: null, assigned_team_member_id: original.id });
      assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
      const changed = await call(`/api/quotes/${result.quoteId}`, "PATCH", { operational_only: true, expected_row_version: initial.row_version, client_id: null, service_id: null, assigned_team_member_id: null });
      assert.equal(changed.status, 200, JSON.stringify(changed.body));
      const assigned = await call(`/api/quotes/${result.quoteId}`, "PATCH", { operational_only: true, expected_row_version: changed.body.quote.row_version, client_id: null, service_id: null, assigned_team_member_id: replacement.id });
      assert.equal(assigned.status, 200, JSON.stringify(assigned.body));
      const latest = await call(`/api/quotes/${result.quoteId}`); assert.equal(latest.status, 200);
      // Preparing locks the document version, whose optimistic version differs
      // from the quote header after operational assignments have changed.
      const prepared = await call(`/api/quotes/${result.quoteId}/prepare`, "POST", { version_id: latest.body.current_version.id, expected_row_version: latest.body.current_version.row_version });
      assert.equal(prepared.status, 200, JSON.stringify(prepared.body));
      // These transitions record manual send/accept only; they never send an email.
      for (const action of ["send", "accept"]) {
        const current = await quote();
        const r = await call(`/api/quotes/${result.quoteId}/${action}`, "POST", { version_id: current.current_version_id, expected_row_version: current.row_version });
        assert.equal(r.status, 200, JSON.stringify(r.body));
      }
      const accepted = await quote();
      const conversion = { expected_row_version: accepted.row_version, store_id: null, service_id: null, assigned_team_member_id: original.id, priority: "normal", due_at: null };
      const denied = await call(`/api/quotes/${result.quoteId}/convert`, "POST", conversion); assert.equal(denied.status, 422, JSON.stringify(denied.body));
      assert.equal((await quote()).converted_order_id, null);
      conversion.assigned_team_member_id = replacement.id;
      const converted = await call(`/api/quotes/${result.quoteId}/convert`, "POST", conversion); assert.equal(converted.status, 200, JSON.stringify(converted.body));
      result.convertedOrderId = converted.body.order.id;
      const order = await call(`/api/orders/${result.convertedOrderId}`); assert.equal(order.status, 200);
      assert.equal(order.body.order.assigned_team_member_id, replacement.id);
      result.checks.quoteModifyAndConvert = true;
    });
    await h.step("cross-tenant reads and writes remain opaque", async () => {
      const foreign = resolveForeignQuoteFixture();
      const read = await call(`/api/quotes/${foreign.quoteId}`); assert.equal(read.status, 404);
      const change = await call(`/api/quotes/${foreign.quoteId}`, "PATCH", { operational_only: true, expected_row_version: 1, client_id: null, service_id: null, assigned_team_member_id: replacement.id });
      assert.equal(change.status, 409); // UPDATE scoped to session tenant; no matching row/version.
      assert.ok(!JSON.stringify(read.body).includes(foreign.reference));
      const conversion = await call(`/api/quotes/${foreign.quoteId}/convert`, "POST", { expected_row_version: 1, store_id: null, service_id: null, assigned_team_member_id: replacement.id, priority: "normal", due_at: null });
      assert.equal(conversion.status, 404);
      result.checks.foreignTenant = { read: read.status, write: change.status, convert: conversion.status };
    });
    h.assertNoProductionEgress();
  } catch (e) {
    result.error = h.redactor.text(e instanceof Error ? e.message : String(e)); process.exitCode = 1;
  } finally {
    // Only members created by this run; keep historical references, remove them from future selectors.
    for (const member of result.members) {
      try { await memberUpdate(member, false, false); }
      catch (e) { result.cleanupError = h.redactor.text(String(e)); process.exitCode = 1; }
    }
    await h.finish(result);
    console.log(JSON.stringify(result, null, 2));
  }
}
void main();
