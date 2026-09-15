import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createKioskRateLimiter,
  kioskClientKey,
} from "./rate-limit";

describe("Kiosk request rate limiting", () => {
  it("limits one client within the window and resets afterwards", () => {
    let now = 1_000;
    const limiter = createKioskRateLimiter({
      limit: 2,
      windowMs: 60_000,
      now: () => now,
    });
    assert.equal(limiter.allow("client-a"), true);
    assert.equal(limiter.allow("client-a"), true);
    assert.equal(limiter.allow("client-a"), false);
    assert.equal(limiter.allow("client-b"), true);

    now += 60_001;
    assert.equal(limiter.allow("client-a"), true);
  });

  it("uses the first forwarded address without trusting body data", () => {
    const request = new Request("https://demo.app.gestcopy.com/api/kiosk/orders", {
      headers: {
        "x-forwarded-for": "203.0.113.10, 10.0.0.1",
      },
    });
    assert.equal(kioskClientKey(request), "203.0.113.10");
  });

  it("caps unique client keys and prunes expired entries", () => {
    let now = 1_000;
    const limiter = createKioskRateLimiter({
      limit: 2,
      windowMs: 60_000,
      maxKeys: 2,
      now: () => now,
    });
    assert.equal(limiter.allow("client-a"), true);
    assert.equal(limiter.allow("client-b"), true);
    assert.equal(limiter.allow("client-c"), false);

    now += 60_001;
    assert.equal(limiter.allow("client-c"), true);
  });
});
