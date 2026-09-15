import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fetchLive } from "./fetch-live";

describe("fetchLive", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("forces cache: no-store without changing the URL", async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return new Response(JSON.stringify({ tenant: "sur4" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const mine = await fetchLive("/api/orders/mine", { signal: undefined });
    const counter = await fetchLive("/api/orders/counter", {
      signal: undefined,
    });
    const body = (await mine.json()) as { tenant: string };

    assert.equal(calls.length, 2);
    assert.equal(calls[0]?.input, "/api/orders/mine");
    assert.equal(calls[1]?.input, "/api/orders/counter");
    assert.equal(calls[0]?.init?.cache, "no-store");
    assert.equal(calls[1]?.init?.cache, "no-store");
    assert.equal(body.tenant, "sur4");
    assert.equal(counter.ok, true);
  });
});
