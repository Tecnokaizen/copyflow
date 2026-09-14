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

    const response = await fetchLive("/api/orders/mine", {
      signal: undefined,
    });
    const body = (await response.json()) as { tenant: string };

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.input, "/api/orders/mine");
    assert.equal(calls[0]?.init?.cache, "no-store");
    assert.equal(body.tenant, "sur4");
  });
});
