import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  PRODUCTION_APP_ORIGIN,
  parseTrustedAuthority,
  resolveTrustedAppOriginFromHints,
  resolveTrustedLocalProtocol,
  resolveTrustedTenantOriginFromHints,
} from "./trusted-origin";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

const localDev = { allowLocalDevelopment: true as const };
const productionRuntime = { allowLocalDevelopment: false as const };

describe("trusted Gestcopy origins", () => {
  it("production app and tenant origins are fixed", () => {
    assert.equal(PRODUCTION_APP_ORIGIN, "https://app.gestcopy.com");
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "app.gestcopy.com",
        forwardedProtoHeader: "https",
        ...productionRuntime,
      }),
      "https://app.gestcopy.com"
    );
    assert.equal(
      resolveTrustedTenantOriginFromHints(
        { hostHeader: "sur4.app.gestcopy.com", ...productionRuntime },
        "sur4"
      ),
      "https://sur4.app.gestcopy.com"
    );
  });

  it("development preserves localhost / 127.0.0.1 port for app origin", () => {
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "localhost:3000",
        forwardedProtoHeader: "http",
        ...localDev,
      }),
      "http://localhost:3000"
    );
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "127.0.0.1:3000",
        ...localDev,
      }),
      "http://127.0.0.1:3000"
    );
  });

  it("development resolves *.localhost tenant origin with port", () => {
    assert.equal(
      resolveTrustedTenantOriginFromHints(
        {
          hostHeader: "copistera-e2e.localhost:3000",
          forwardedProtoHeader: "http",
          ...localDev,
        },
        "copistera-e2e"
      ),
      "http://copistera-e2e.localhost:3000"
    );
  });

  it("production never preserves localhost / 127.0.0.1 / *.localhost", () => {
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "localhost:3000",
        forwardedProtoHeader: "http",
        ...productionRuntime,
      }),
      "https://app.gestcopy.com"
    );
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "127.0.0.1:3000",
        ...productionRuntime,
      }),
      "https://app.gestcopy.com"
    );
    assert.equal(
      resolveTrustedTenantOriginFromHints(
        {
          hostHeader: "foo.localhost:3000",
          ...productionRuntime,
        },
        "foo"
      ),
      "https://foo.app.gestcopy.com"
    );
    // Default / omitted flag is not local development.
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "localhost:3000",
      }),
      "https://app.gestcopy.com"
    );
  });

  it("does not reflect Host or x-forwarded-host evil.example", () => {
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "evil.example",
        forwardedHostHeader: "evil.example",
        forwardedProtoHeader: "https",
        ...productionRuntime,
      }),
      "https://app.gestcopy.com"
    );
    assert.equal(
      resolveTrustedTenantOriginFromHints(
        {
          hostHeader: "evil.example",
          forwardedHostHeader: "evil.example",
          ...productionRuntime,
        },
        "sur4"
      ),
      "https://sur4.app.gestcopy.com"
    );
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "localhost:3000",
        forwardedHostHeader: "evil.example",
        ...localDev,
      }),
      "http://localhost:3000"
    );
    assert.doesNotMatch(
      resolveTrustedAppOriginFromHints({
        hostHeader: "evil.example",
        ...productionRuntime,
      }),
      /evil\.example/
    );
  });

  it("does not reflect arbitrary x-forwarded-proto", () => {
    assert.equal(resolveTrustedLocalProtocol("ftp"), "http");
    assert.equal(resolveTrustedLocalProtocol("javascript"), "http");
    assert.equal(resolveTrustedLocalProtocol("https"), "https");
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "localhost:3000",
        forwardedProtoHeader: "ftp",
        ...localDev,
      }),
      "http://localhost:3000"
    );
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "evil.example",
        forwardedProtoHeader: "ftp",
        ...productionRuntime,
      }),
      "https://app.gestcopy.com"
    );
  });

  it("rejects malformed authorities", () => {
    assert.equal(parseTrustedAuthority("demo.app.gestcopy.com@evil.test"), null);
    assert.equal(
      parseTrustedAuthority("demo.app.gestcopy.com:443,evil.test"),
      null
    );
  });

  it("request-origin only allows local development via NODE_ENV", () => {
    const adapter = readSource("lib/tenant/request-origin.ts");
    assert.match(adapter, /allowLocalDevelopment:\s*process\.env\.NODE_ENV === "development"/);
    assert.doesNotMatch(adapter, /VERCEL_ENV/);
  });

  it("checkout and onboarding use trusted origin resolvers", () => {
    const checkout = readSource("lib/billing/checkout.ts");
    const onboarding = readSource("app/api/onboarding/route.ts");
    assert.match(checkout, /resolveTrustedTenantOrigin/);
    assert.match(checkout, /resolveTrustedAppOrigin|appHostOriginFromRequest/);
    assert.doesNotMatch(
      checkout,
      /x-forwarded-host[\s\S]*\$\{proto\}:\/\/\$\{host/
    );
    assert.match(onboarding, /appHostOriginFromRequest/);
  });
});
