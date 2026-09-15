import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createKioskCapability,
  trustedKioskRequestContext,
} from "./trusted-request";

function headers(values: Record<string, string>) {
  return new Headers(values);
}

describe("trustedKioskRequestContext", () => {
  it("accepts Vercel-overwritten host and client IP headers", () => {
    assert.deepEqual(
      trustedKioskRequestContext(
        headers({
          host: "demo.app.gestcopy.com",
          "x-forwarded-host": "demo.app.gestcopy.com",
          "x-vercel-forwarded-for": "203.0.113.8",
        }),
        { VERCEL: "1", NODE_ENV: "production" }
      ),
      {
        tenantSlug: "demo",
        clientAddress: "203.0.113.8",
      }
    );
  });

  it("rejects spoofed, ambiguous and malformed Vercel headers", () => {
    const cases = [
      {
        host: "demo.app.gestcopy.com",
        "x-forwarded-host": "sur4.app.gestcopy.com",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
      {
        host: "demo.app.gestcopy.com",
        "x-forwarded-host": "demo.app.gestcopy.com",
        "x-vercel-forwarded-for": "203.0.113.8, 10.0.0.1",
      },
      {
        host: "demo.app.gestcopy.com",
        "x-forwarded-host": "demo.app.gestcopy.com",
        "x-vercel-forwarded-for": "not-an-ip",
      },
      {
        host: "deep.demo.app.gestcopy.com",
        "x-forwarded-host": "deep.demo.app.gestcopy.com",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
      {
        host: "demo.app.gestcopy.com:443,evil.test",
        "x-forwarded-host": "demo.app.gestcopy.com:443,evil.test",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
      {
        host: "demo.app.gestcopy.com@evil.test",
        "x-forwarded-host": "demo.app.gestcopy.com@evil.test",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
    ];
    for (const value of cases) {
      assert.equal(
        trustedKioskRequestContext(
          headers(value),
          { VERCEL: "1", NODE_ENV: "production" }
        ),
        null
      );
    }
  });

  it("uses only Host with a fixed client key in local development", () => {
    assert.deepEqual(
      trustedKioskRequestContext(
        headers({
          host: "demo.localhost:3000",
          "x-forwarded-host": "sur4.localhost:3000",
          "x-forwarded-for": "198.51.100.9",
        }),
        { NODE_ENV: "development" }
      ),
      { tenantSlug: "demo", clientAddress: "local-development" }
    );
  });

  it("fails closed outside Vercel and local development", () => {
    assert.equal(
      trustedKioskRequestContext(
        headers({ host: "demo.app.gestcopy.com" }),
        { NODE_ENV: "production" }
      ),
      null
    );
  });
});

describe("createKioskCapability", () => {
  it("binds tenant, client and issuance time without exposing the IP", () => {
    const capability = createKioskCapability(
      {
        tenantSlug: "demo",
        clientAddress: "203.0.113.8",
        issuedAt: 1_789_000_000,
      },
      { purpose: "bootstrap", binding: "bootstrap" },
      "k".repeat(32)
    );
    assert.equal(capability.tenantSlug, "demo");
    assert.equal(capability.issuedAt, 1_789_000_000);
    assert.equal(capability.purpose, "bootstrap");
    assert.equal(capability.binding, "bootstrap");
    assert.match(capability.clientKey, /^[a-f0-9]{64}$/);
    assert.match(capability.signature, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(capability).includes("203.0.113.8"), false);
  });

  it("changes signature across tenants and rejects weak secrets", () => {
    const secret = "k".repeat(32);
    const base = {
      clientAddress: "203.0.113.8",
      issuedAt: 1_789_000_000,
    };
    const demo = createKioskCapability(
      { ...base, tenantSlug: "demo" },
      { purpose: "bootstrap", binding: "bootstrap" },
      secret
    );
    const sur4 = createKioskCapability(
      { ...base, tenantSlug: "sur4" },
      { purpose: "bootstrap", binding: "bootstrap" },
      secret
    );
    assert.notEqual(demo.signature, sur4.signature);
    const submit = createKioskCapability(
      { ...base, tenantSlug: "demo" },
      {
        purpose: "submit",
        binding:
          "permit|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|" + "f".repeat(64),
      },
      secret
    );
    assert.notEqual(demo.signature, submit.signature);
    const alteredSubmit = createKioskCapability(
      { ...base, tenantSlug: "demo" },
      {
        purpose: "submit",
        binding:
          "permit|aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa|" + "e".repeat(64),
      },
      secret
    );
    assert.notEqual(submit.signature, alteredSubmit.signature);
    assert.throws(
      () =>
        createKioskCapability(
          { ...base, tenantSlug: "demo" },
          { purpose: "bootstrap", binding: "bootstrap" },
          "short"
        ),
      /signing secret/i
    );
  });
});
