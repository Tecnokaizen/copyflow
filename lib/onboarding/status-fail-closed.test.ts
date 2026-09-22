import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { resolveTenantIdFromCheckoutSession } from "@/lib/billing/tenant-from-webhook";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

const tenantA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const tenantB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("onboarding status fail-closed tenant resolution", () => {
  it("accepts matching client_reference_id and metadata.tenant_id", () => {
    assert.deepEqual(
      resolveTenantIdFromCheckoutSession({
        client_reference_id: tenantA,
        metadata: { tenant_id: tenantA },
      }),
      { ok: true, tenantId: tenantA }
    );
  });

  it("accepts a single valid UUID from either source", () => {
    assert.deepEqual(
      resolveTenantIdFromCheckoutSession({
        client_reference_id: tenantA,
        metadata: null,
      }),
      { ok: true, tenantId: tenantA }
    );
    assert.deepEqual(
      resolveTenantIdFromCheckoutSession({
        client_reference_id: null,
        metadata: { tenant_id: tenantB },
      }),
      { ok: true, tenantId: tenantB }
    );
  });

  it("rejects mismatched tenant identifiers", () => {
    assert.deepEqual(
      resolveTenantIdFromCheckoutSession({
        client_reference_id: tenantA,
        metadata: { tenant_id: tenantB },
      }),
      { ok: false, errorCode: "tenant_id_mismatch" }
    );
  });

  it("rejects invalid UUID and missing refs", () => {
    assert.deepEqual(
      resolveTenantIdFromCheckoutSession({
        client_reference_id: "not-a-uuid",
        metadata: null,
      }),
      { ok: false, errorCode: "invalid_tenant_id" }
    );
    assert.deepEqual(
      resolveTenantIdFromCheckoutSession({
        client_reference_id: null,
        metadata: null,
      }),
      { ok: false, errorCode: "missing_tenant_id" }
    );
  });

  it("status route fails closed on mismatch, invalid mode, and correlates attempt", () => {
    const status = readSource("app/api/onboarding/status/route.ts");
    assert.match(status, /resolveTenantIdFromCheckoutSession/);
    assert.match(status, /mode !== "subscription"/);
    assert.match(status, /billing_checkout_attempts/);
    assert.match(status, /provider_session_id/);
    assert.doesNotMatch(status, /tenantIdFromCheckoutSession/);
    assert.doesNotMatch(status, /activate_tenant_after_billing/);
    assert.doesNotMatch(status, /UPDATE tenants/);
  });
});
