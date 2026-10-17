/**
 * Cross-tenant negative controls for the quotes E2E. They are mandatory: a run
 * only passes after both denials ran against a known synthetic quote that
 * exists in another Staging tenant. A 404 for an ID that does not exist proves
 * nothing, so the default fixture is pinned here and verified by SQL (see
 * docs/E2E-STAGING-QUOTES.md) instead of being optional operator input.
 */

import { E2E_TENANT_SLUG } from "./guard";

type Env = Record<string, string | undefined>;

export type ForeignQuoteFixture = {
  tenantSlug: string;
  quoteId: string;
  versionId: string;
  reference: string;
  source: "registry" | "env";
};

/** DEMO-P0001 in the Staging `demo` tenant: synthetic client, verified 17/10/2026. */
export const STAGING_FOREIGN_QUOTE: Omit<ForeignQuoteFixture, "source"> = {
  tenantSlug: "demo",
  quoteId: "5233bc9f-b4c2-4409-868a-324dab41bed3",
  versionId: "b606a8fe-f951-4690-9859-0978778d9928",
  reference: "DEMO-P0001",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class ForeignFixtureError extends Error {
  constructor(message: string) {
    super(`E2E foreign fixture: ${message}`);
    this.name = "ForeignFixtureError";
  }
}

/**
 * Registry fixture by default. An override must name every field, so a typo
 * fails before the run instead of turning the controls into a trivial 404.
 */
export function resolveForeignQuoteFixture(env: Env = process.env): ForeignQuoteFixture {
  const quoteId = env.E2E_FOREIGN_QUOTE_ID?.trim() || "";
  const versionId = env.E2E_FOREIGN_VERSION_ID?.trim() || "";
  const reference = env.E2E_FOREIGN_QUOTE_REFERENCE?.trim() || "";
  const tenantSlug = env.E2E_FOREIGN_TENANT_SLUG?.trim() || "";

  if (!quoteId && !versionId && !reference && !tenantSlug) {
    return { ...STAGING_FOREIGN_QUOTE, source: "registry" };
  }
  if (!quoteId || !versionId || !reference || !tenantSlug) {
    throw new ForeignFixtureError(
      "override needs E2E_FOREIGN_QUOTE_ID, E2E_FOREIGN_VERSION_ID, E2E_FOREIGN_QUOTE_REFERENCE and E2E_FOREIGN_TENANT_SLUG"
    );
  }
  if (!UUID.test(quoteId) || !UUID.test(versionId)) {
    throw new ForeignFixtureError("quote and version IDs must be lowercase UUIDs");
  }
  if (quoteId === versionId) {
    throw new ForeignFixtureError("quote and version IDs must differ");
  }
  if (tenantSlug === E2E_TENANT_SLUG) {
    throw new ForeignFixtureError(`the fixture must belong to a tenant other than ${E2E_TENANT_SLUG}`);
  }
  return { tenantSlug, quoteId, versionId, reference, source: "env" };
}

/** A denial is a 404 that does not echo the foreign document. */
export function isOpaqueDenial(
  status: number,
  body: string,
  fixture: Pick<ForeignQuoteFixture, "reference" | "versionId">
): boolean {
  return status === 404 && !body.includes(fixture.reference) && !body.includes(fixture.versionId);
}

/** A run that skipped either control is never reported as passed. */
export function assertForeignControlsRan(checks: Record<string, unknown>): void {
  if (checks.foreignTenantQuoteDenied !== true || checks.foreignTenantPdfDenied !== true) {
    throw new ForeignFixtureError("cross-tenant quote and PDF controls must both run");
  }
}
