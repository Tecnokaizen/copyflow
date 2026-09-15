import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OPERATIONAL_CACHE_CONTROL,
  isOperationalApiPath,
  operationalJson,
} from "./operational-cache";

describe("operational API cache policy", () => {
  it("marks orders and dashboard paths as operational", () => {
    assert.equal(isOperationalApiPath("/api/orders"), true);
    assert.equal(isOperationalApiPath("/api/orders/mine"), true);
    assert.equal(isOperationalApiPath("/api/orders/counter"), true);
    assert.equal(isOperationalApiPath("/api/orders/abc/activity"), true);
    assert.equal(isOperationalApiPath("/api/dashboard"), true);
    assert.equal(isOperationalApiPath("/api/clients"), false);
    assert.equal(isOperationalApiPath("/api/context"), false);
  });

  it("sends private no-store headers on JSON responses", async () => {
    const response = operationalJson({ tenant: "sur4" }, { status: 200 });
    assert.equal(
      response.headers.get("Cache-Control"),
      OPERATIONAL_CACHE_CONTROL
    );
    assert.equal(response.headers.get("Pragma"), "no-cache");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { tenant: "sur4" });
  });
});
