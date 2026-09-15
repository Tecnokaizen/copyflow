import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowsUnauthenticatedPath } from "@/lib/invitations/public-path";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

describe("Kiosk tenant hostname", () => {
  it("isolates DEMO and SUR4 by production hostname", () => {
    assert.equal(
      getSubdomainFromHostname("demo.app.gestcopy.com"),
      "demo"
    );
    assert.equal(
      getSubdomainFromHostname("sur4.app.gestcopy.com"),
      "sur4"
    );
  });

  it("fails closed for invalid or ambiguous production hostnames", () => {
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
