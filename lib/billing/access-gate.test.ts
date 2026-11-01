/**
 * Billing Access Gate V1 · proxy decisions, exempt paths, payload parsing and
 * the static wiring of the proxy and the migration.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  billingSuspensionMessage,
  decideBillingGate,
  isBillingGateExemptPath,
  isBillingGateProxyEnabled,
  parseMemberBillingAccess,
  type MemberBillingAccess,
} from "./access-gate";

const ROOT = path.resolve(__dirname, "../..");

function access(overrides: Partial<MemberBillingAccess> = {}): MemberBillingAccess {
  return {
    allowed: false,
    enforced: true,
    mode: "enforce",
    state: "trial_expired",
    role: "staff",
    graceUntil: null,
    pendingUntil: null,
    periodEnd: null,
    ...overrides,
  };
}

describe("parseMemberBillingAccess", () => {
  it("parses the RPC payload", () => {
    const parsed = parseMemberBillingAccess({
      allowed: false, enforced: true, mode: "enforce", state: "past_due_suspended",
      role: "owner", grace_until: "2026-11-09T00:00:00Z",
    });
    assert.deepEqual(parsed, {
      allowed: false, enforced: true, mode: "enforce", state: "past_due_suspended",
      role: "owner", graceUntil: "2026-11-09T00:00:00Z", pendingUntil: null, periodEnd: null,
    });
  });

  it("returns null for non-members and malformed payloads", () => {
    assert.equal(parseMemberBillingAccess(null), null);
    assert.equal(parseMemberBillingAccess([]), null);
    assert.equal(parseMemberBillingAccess({ allowed: "no", state: "x" }), null);
    assert.equal(parseMemberBillingAccess({ allowed: true }), null);
  });

  it("never reports enforced outside enforce mode", () => {
    const parsed = parseMemberBillingAccess({ allowed: false, enforced: true, mode: "observe", state: "trial_expired" });
    assert.equal(parsed?.enforced, false);
    assert.equal(parseMemberBillingAccess({ allowed: false, state: "x", mode: "weird" })?.mode, "off");
  });
});

describe("isBillingGateExemptPath", () => {
  for (const p of [
    "/billing-suspended", "/settings/billing", "/settings/billing/success",
    "/api/billing/checkout-session", "/api/billing/portal-session", "/api/billing/subscription",
    "/api/webhooks/stripe", "/api/internal/files/cleanup", "/auth/login", "/auth/recovery",
    "/ayuda", "/ayuda/novedades", "/tenant-inactive", "/invitations/abc", "/kiosk", "/api/kiosk/orders",
  ]) {
    it(`exempts ${p}`, () => assert.equal(isBillingGateExemptPath(p), true));
  }
  for (const p of [
    "/", "/orders", "/orders/new", "/clients", "/settings", "/settings/team", "/settings/billingx",
    "/api/orders", "/api/orders/1/files", "/api/clients", "/api/team", "/api/imports/clients",
    "/api/billingx", "/billing-suspendedx",
  ]) {
    it(`gates ${p}`, () => assert.equal(isBillingGateExemptPath(p), false));
  }
});

describe("decideBillingGate", () => {
  it("passes allowed tenants, mode off and unknown access", () => {
    assert.deepEqual(decideBillingGate({ access: access({ allowed: true }), pathname: "/orders", method: "GET" }), { action: "pass" });
    assert.deepEqual(decideBillingGate({ access: access({ mode: "off", enforced: false }), pathname: "/orders", method: "GET" }), { action: "pass" });
    assert.deepEqual(decideBillingGate({ access: null, pathname: "/api/orders", method: "POST" }), { action: "pass" });
  });

  it("redirects page navigations and blocks API mutations when enforced", () => {
    assert.deepEqual(decideBillingGate({ access: access(), pathname: "/orders", method: "GET" }), { action: "redirect", state: "trial_expired" });
    for (const method of ["POST", "PUT", "PATCH", "DELETE", "post"]) {
      assert.deepEqual(decideBillingGate({ access: access(), pathname: "/api/orders", method }), { action: "block", state: "trial_expired" });
    }
  });

  it("lets API reads through (data is kept and readable)", () => {
    assert.deepEqual(decideBillingGate({ access: access(), pathname: "/api/orders", method: "GET" }), { action: "pass" });
  });

  it("keeps billing, Checkout, Portal and auth open for a suspended owner", () => {
    const owner = access({ role: "owner" });
    assert.deepEqual(decideBillingGate({ access: owner, pathname: "/settings/billing", method: "GET" }), { action: "pass" });
    assert.deepEqual(decideBillingGate({ access: owner, pathname: "/api/billing/checkout-session", method: "POST" }), { action: "pass" });
    assert.deepEqual(decideBillingGate({ access: owner, pathname: "/api/billing/portal-session", method: "POST" }), { action: "pass" });
    assert.deepEqual(decideBillingGate({ access: owner, pathname: "/auth/login", method: "POST" }), { action: "pass" });
  });

  it("observe mode never blocks, it reports", () => {
    const observed = access({ mode: "observe", enforced: false });
    assert.deepEqual(decideBillingGate({ access: observed, pathname: "/api/orders", method: "POST" }), { action: "observe", wouldBlock: "block", state: "trial_expired" });
    assert.deepEqual(decideBillingGate({ access: observed, pathname: "/orders", method: "GET" }), { action: "observe", wouldBlock: "redirect", state: "trial_expired" });
  });

  it("transitional states are allowed by SQL and pass", () => {
    for (const state of ["checkout_pending", "reconciliation_pending", "past_due_grace", "subscription_canceling"]) {
      assert.deepEqual(decideBillingGate({ access: access({ allowed: true, state }), pathname: "/api/orders", method: "POST" }), { action: "pass" });
    }
  });
});

describe("proxy switch and copy", () => {
  it("proxy read is opt-in", () => {
    assert.equal(isBillingGateProxyEnabled({}), false);
    assert.equal(isBillingGateProxyEnabled({ BILLING_ACCESS_GATE_PROXY: "true" }), false);
    assert.equal(isBillingGateProxyEnabled({ BILLING_ACCESS_GATE_PROXY: "on" }), true);
  });

  it("has Spanish copy for every suspended state", () => {
    for (const state of ["trial_expired", "internal_expired", "past_due_suspended", "subscription_ended", "no_subscription", "other"]) {
      assert.ok(billingSuspensionMessage(state).length > 20);
    }
  });
});

describe("static wiring", () => {
  const proxy = readFileSync(path.join(ROOT, "proxy.ts"), "utf8");
  const migration = readFileSync(
    path.join(ROOT, "supabase/migrations/20261102100000_billing_access_gate_v1.sql"),
    "utf8"
  );

  it("proxy uses the gate after the inactive-tenant gate and answers 402", () => {
    assert.ok(proxy.indexOf("resolveInactiveTenantState") < proxy.indexOf("decideBillingGate("));
    assert.match(proxy, /status: 402/);
    assert.match(proxy, /isBillingGateProxyEnabled\(process\.env\)/);
  });

  it("migration installs mode off, never touches tenants.active or policies", () => {
    assert.match(migration, /mode text not null default 'off'/);
    assert.doesNotMatch(migration, /set\s+active\s*=/i);
    assert.doesNotMatch(migration, /create policy|alter policy|drop policy/i);
    assert.match(migration, /errcode = 'PT402'/);
  });
});
