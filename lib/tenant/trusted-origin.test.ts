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

describe("trusted Gestcopy origins", () => {
  it("production app and tenant origins are fixed", () => {
    assert.equal(PRODUCTION_APP_ORIGIN, "https://app.gestcopy.com");
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "app.gestcopy.com",
        forwardedProtoHeader: "https",
      }),
      "https://app.gestcopy.com"
    );
    assert.equal(
      resolveTrustedTenantOriginFromHints(
        { hostHeader: "sur4.app.gestcopy.com" },
        "sur4"
      ),
      "https://sur4.app.gestcopy.com"
    );
  });

  it("localhost and 127.0.0.1 preserve port for app origin", () => {
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "localhost:3000",
        forwardedProtoHeader: "http",
      }),
      "http://localhost:3000"
    );
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "127.0.0.1:3000",
      }),
      "http://127.0.0.1:3000"
    );
  });

  it("*.localhost resolves local tenant origin with port", () => {
    assert.equal(
      resolveTrustedTenantOriginFromHints(
        {
          hostHeader: "copistera-e2e.localhost:3000",
          forwardedProtoHeader: "http",
        },
        "copistera-e2e"
      ),
      "http://copistera-e2e.localhost:3000"
    );
  });

  it("does not reflect Host or x-forwarded-host evil.example", () => {
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "evil.example",
        forwardedHostHeader: "evil.example",
        forwardedProtoHeader: "https",
      }),
      "https://app.gestcopy.com"
    );
    assert.equal(
      resolveTrustedTenantOriginFromHints(
        {
          hostHeader: "evil.example",
          forwardedHostHeader: "evil.example",
        },
        "sur4"
      ),
      "https://sur4.app.gestcopy.com"
    );
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "localhost:3000",
        forwardedHostHeader: "evil.example",
      }),
      "http://localhost:3000"
    );
    assert.doesNotMatch(
      resolveTrustedAppOriginFromHints({
        hostHeader: "evil.example",
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
      }),
      "http://localhost:3000"
    );
    assert.equal(
      resolveTrustedAppOriginFromHints({
        hostHeader: "evil.example",
        forwardedProtoHeader: "ftp",
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
