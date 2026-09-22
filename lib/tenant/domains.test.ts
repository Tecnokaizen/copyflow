import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  TENANT_BASE_DOMAIN,
  resolveTenantHost,
  resolveTenantOrigin,
  tenantHost,
  tenantOrigin,
  tenantRequestContextFromLocation,
} from "./domains";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("tenant domains", () => {
  it("keeps production helpers deterministic", () => {
    assert.equal(TENANT_BASE_DOMAIN, "app.gestcopy.com");
    assert.equal(tenantHost("sur4"), "sur4.app.gestcopy.com");
    assert.equal(tenantOrigin("sur4"), "https://sur4.app.gestcopy.com");
    assert.equal(resolveTenantOrigin("sur4"), "https://sur4.app.gestcopy.com");
    assert.equal(
      resolveTenantOrigin("sur4", {
        protocol: "https:",
        hostname: "app.gestcopy.com",
      }),
      "https://sur4.app.gestcopy.com"
    );
  });

  it("resolves local tenant origin from localhost:3000 context", () => {
    const context = tenantRequestContextFromLocation({
      protocol: "http:",
      hostname: "localhost",
      port: "3000",
    });

    assert.equal(
      resolveTenantHost("billing-sandbox", context),
      "billing-sandbox.localhost"
    );
    assert.equal(
      resolveTenantOrigin("billing-sandbox", context),
      "http://billing-sandbox.localhost:3000"
    );
  });

  it("preserves protocol/port for *.localhost and 127.0.0.1", () => {
    assert.equal(
      resolveTenantOrigin("billing-sandbox", {
        protocol: "http:",
        hostname: "demo.localhost",
        port: "3000",
      }),
      "http://billing-sandbox.localhost:3000"
    );
    assert.equal(
      resolveTenantOrigin("acme", {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "3000",
      }),
      "http://acme.localhost:3000"
    );
  });

  it("onboarding success redirect uses resolveTenantOrigin, not production-only tenantOrigin", () => {
    const form = readSource("components/onboarding/onboarding-form.tsx");
    assert.match(form, /resolveTenantOrigin/);
    assert.match(form, /tenantRequestContextFromLocation\(window\.location\)/);
    assert.doesNotMatch(
      form,
      /window\.location\.assign\(tenantOrigin\(/
    );
    assert.doesNotMatch(
      form,
      /const origin = tenantOrigin\(createdSlug\)/
    );

    const local = resolveTenantOrigin(
      "billing-sandbox",
      tenantRequestContextFromLocation({
        protocol: "http:",
        hostname: "localhost",
        port: "3000",
      })
    );
    assert.equal(local, "http://billing-sandbox.localhost:3000");
    assert.doesNotMatch(local, /app\.gestcopy\.com/);
  });
});
