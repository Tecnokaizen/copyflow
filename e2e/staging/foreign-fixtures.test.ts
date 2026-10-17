import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ForeignFixtureError,
  STAGING_FOREIGN_QUOTE,
  assertForeignControlsRan,
  isOpaqueDenial,
  resolveForeignQuoteFixture,
} from "./foreign-fixtures";

const OVERRIDE = {
  E2E_FOREIGN_QUOTE_ID: "11111111-2222-4333-8444-555555555555",
  E2E_FOREIGN_VERSION_ID: "66666666-7777-4888-8999-aaaaaaaaaaaa",
  E2E_FOREIGN_QUOTE_REFERENCE: "AUDIT-P0001",
  E2E_FOREIGN_TENANT_SLUG: "audit",
};

const rejects = (env: Record<string, string | undefined>, pattern: RegExp) =>
  assert.throws(() => resolveForeignQuoteFixture(env), (error: unknown) =>
    error instanceof ForeignFixtureError && pattern.test(error.message));

describe("e2e foreign quote fixture", () => {
  it("defaults to the pinned synthetic demo quote", () => {
    const fixture = resolveForeignQuoteFixture({});
    assert.equal(fixture.source, "registry");
    assert.equal(fixture.tenantSlug, "demo");
    assert.equal(fixture.quoteId, STAGING_FOREIGN_QUOTE.quoteId);
    assert.equal(fixture.versionId, STAGING_FOREIGN_QUOTE.versionId);
  });

  it("accepts a complete override from another tenant", () => {
    const fixture = resolveForeignQuoteFixture(OVERRIDE);
    assert.equal(fixture.source, "env");
    assert.equal(fixture.reference, "AUDIT-P0001");
  });

  it("rejects partial, malformed or same-tenant overrides", () => {
    rejects({ E2E_FOREIGN_QUOTE_ID: OVERRIDE.E2E_FOREIGN_QUOTE_ID }, /override needs/);
    rejects({ ...OVERRIDE, E2E_FOREIGN_VERSION_ID: "" }, /override needs/);
    rejects({ ...OVERRIDE, E2E_FOREIGN_QUOTE_ID: "not-a-uuid" }, /UUIDs/);
    rejects({ ...OVERRIDE, E2E_FOREIGN_VERSION_ID: OVERRIDE.E2E_FOREIGN_QUOTE_ID }, /differ/);
    rejects({ ...OVERRIDE, E2E_FOREIGN_TENANT_SLUG: "e2e" }, /other than e2e/);
  });

  it("treats only an opaque 404 as a denial", () => {
    const body = JSON.stringify({ error: "No se encontró el presupuesto" });
    assert.equal(isOpaqueDenial(404, body, STAGING_FOREIGN_QUOTE), true);
    assert.equal(isOpaqueDenial(200, body, STAGING_FOREIGN_QUOTE), false);
    assert.equal(isOpaqueDenial(307, body, STAGING_FOREIGN_QUOTE), false);
    assert.equal(isOpaqueDenial(403, body, STAGING_FOREIGN_QUOTE), false);
    assert.equal(isOpaqueDenial(404, JSON.stringify({ reference: "DEMO-P0001" }), STAGING_FOREIGN_QUOTE), false);
  });

  it("refuses to pass when either control was skipped", () => {
    assert.doesNotThrow(() =>
      assertForeignControlsRan({ foreignTenantQuoteDenied: true, foreignTenantPdfDenied: true }));
    assert.throws(() => assertForeignControlsRan({}), ForeignFixtureError);
    assert.throws(() => assertForeignControlsRan({ foreignTenantQuoteDenied: true }), ForeignFixtureError);
    assert.throws(() => assertForeignControlsRan({ foreignTenantPdfDenied: true }), ForeignFixtureError);
  });
});
