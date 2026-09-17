import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowsUnauthenticatedPath } from "@/lib/invitations/public-path";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

function withEnv(
  values: Record<string, string | undefined>,
  fn: () => void
) {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(values)) {
    previous.set(key, process.env[key]);
    const next = values[key];
    if (next === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = next;
    }
  }
  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe("Kiosk tenant hostname", () => {
  it("isolates DEMO and SUR4 by production hostname", () => {
    withEnv({ VERCEL_ENV: undefined, TENANT_PREVIEW_BASE_DOMAIN: undefined }, () => {
      assert.equal(
        getSubdomainFromHostname("demo.app.gestcopy.com"),
        "demo"
      );
      assert.equal(
        getSubdomainFromHostname("sur4.app.gestcopy.com"),
        "sur4"
      );
    });
  });

  it("resolves preview base domain only when VERCEL_ENV=preview", () => {
    withEnv(
      {
        VERCEL_ENV: "preview",
        TENANT_PREVIEW_BASE_DOMAIN: "preview.app.gestcopy.com",
      },
      () => {
        assert.equal(
          getSubdomainFromHostname("demo.preview.app.gestcopy.com"),
          "demo"
        );
        assert.equal(
          getSubdomainFromHostname("demo.app.gestcopy.com"),
          "demo"
        );
      }
    );

    withEnv(
      {
        VERCEL_ENV: "production",
        TENANT_PREVIEW_BASE_DOMAIN: "preview.app.gestcopy.com",
      },
      () => {
        assert.equal(
          getSubdomainFromHostname("demo.preview.app.gestcopy.com"),
          null
        );
        assert.equal(
          getSubdomainFromHostname("demo.app.gestcopy.com"),
          "demo"
        );
      }
    );

    withEnv(
      {
        VERCEL_ENV: undefined,
        TENANT_PREVIEW_BASE_DOMAIN: "preview.app.gestcopy.com",
      },
      () => {
        assert.equal(
          getSubdomainFromHostname("demo.preview.app.gestcopy.com"),
          null
        );
      }
    );
  });

  it("fails closed for invalid or ambiguous production hostnames", () => {
    withEnv({ VERCEL_ENV: undefined, TENANT_PREVIEW_BASE_DOMAIN: undefined }, () => {
      for (const hostname of [
        "app.gestcopy.com",
        "app.app.gestcopy.com",
        "deep.demo.app.gestcopy.com",
        "gestcopy.com",
        "demo.evil.test",
        "",
      ]) {
        assert.equal(getSubdomainFromHostname(hostname), null, hostname);
      }
    });
  });

  it("rejects nested and invalid preview hostnames", () => {
    withEnv(
      {
        VERCEL_ENV: "preview",
        TENANT_PREVIEW_BASE_DOMAIN: "preview.app.gestcopy.com",
      },
      () => {
        for (const hostname of [
          "preview.app.gestcopy.com",
          "app.preview.app.gestcopy.com",
          "deep.demo.preview.app.gestcopy.com",
          "demo.preview.evil.test",
        ]) {
          assert.equal(getSubdomainFromHostname(hostname), null, hostname);
        }
      }
    );
  });
});

describe("Kiosk public route boundary", () => {
  it("allows only Kiosk while internal routes stay protected", () => {
    assert.equal(allowsUnauthenticatedPath("/kiosk"), true);
    assert.equal(allowsUnauthenticatedPath("/kiosk/confirmation"), true);
    for (const pathname of [
      "/counter",
      "/orders",
      "/orders/quick",
      "/clients",
      "/team",
    ]) {
      assert.equal(allowsUnauthenticatedPath(pathname), false, pathname);
    }
  });
});
