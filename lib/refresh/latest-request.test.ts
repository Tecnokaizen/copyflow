import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { createLatestRequest, fetchLatestJson } from "./latest-request";

type Pending = { url: string; resolve: (body: unknown) => void; reject: (error: unknown) => void };

/** fetch whose responses the test releases in any order. */
function controlledFetch(options: { honorAbort: boolean }) {
  const pending: Pending[] = [];
  const fetchImpl = ((url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      if (options.honorAbort) {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError"))
        );
      }
      pending.push({
        url,
        resolve: (body) => resolve(new Response(JSON.stringify(body), { status: 200 })),
        reject,
      });
    })) as typeof fetch;
  return { fetchImpl, pending };
}

describe("createLatestRequest", () => {
  it("aborts and invalidates the previous ticket when a new one starts", () => {
    const request = createLatestRequest();
    const first = request.start();
    const second = request.start();

    assert.equal(first.signal.aborted, true);
    assert.equal(first.isCurrent(), false);
    assert.equal(second.signal.aborted, false);
    assert.equal(second.isCurrent(), true);
  });

  it("abort() leaves nothing current (unmount or filter change)", () => {
    const request = createLatestRequest();
    const ticket = request.start();
    request.abort();

    assert.equal(ticket.signal.aborted, true);
    assert.equal(ticket.isCurrent(), false);
  });
});

describe("fetchLatestJson", () => {
  for (const honorAbort of [false, true]) {
    it(`two responses out of order: only the latest applies (fetch ${honorAbort ? "honours" : "ignores"} abort)`, async () => {
      const request = createLatestRequest();
      const { fetchImpl, pending } = controlledFetch({ honorAbort });
      let data: unknown = "initial";
      const apply = (loaded: { body: unknown } | null) => {
        if (loaded) data = loaded.body;
      };

      // Unfiltered refresh after a create, then the user's search.
      const refresh = fetchLatestJson(request.start(), "/api/clients/list?page=1", fetchImpl).then(apply);
      const searched = fetchLatestJson(request.start(), "/api/clients/list?page=1&search=nuevo", fetchImpl).then(apply);

      pending[1].resolve({ clients: ["nuevo"] });
      await searched;
      pending[0].resolve({ clients: ["a", "b", "c"] });
      await refresh;

      assert.deepEqual(data, { clients: ["nuevo"] });
    });
  }

  it("applies a response that finished before the next request started", async () => {
    const request = createLatestRequest();
    const { fetchImpl, pending } = controlledFetch({ honorAbort: true });

    const first = fetchLatestJson(request.start(), "/api/team?active=true", fetchImpl);
    pending[0].resolve({ members: [1] });
    const loaded = await first;

    assert.ok(loaded);
    assert.equal(loaded.response.ok, true);
    assert.deepEqual(loaded.body, { members: [1] });
  });

  it("rethrows real errors of the current request and swallows those of a stale one", async () => {
    const request = createLatestRequest();
    const { fetchImpl, pending } = controlledFetch({ honorAbort: false });

    const stale = fetchLatestJson(request.start(), "/api/services?x=1", fetchImpl);
    const current = fetchLatestJson(request.start(), "/api/services?x=2", fetchImpl);

    pending[0].reject(new TypeError("network down"));
    assert.equal(await stale, null);

    pending[1].reject(new TypeError("network down"));
    await assert.rejects(current, /network down/);
  });

  it("returns null for a request aborted on unmount", async () => {
    const request = createLatestRequest();
    const { fetchImpl } = controlledFetch({ honorAbort: true });

    const loading = fetchLatestJson(request.start(), "/api/activity?page=1", fetchImpl);
    request.abort();

    assert.equal(await loading, null);
  });
});

describe("list pages use the latest-request guard", () => {
  const root = path.join(import.meta.dirname, "../..");
  const pages: Array<[string, RegExp]> = [
    ["app/clients/page.tsx", /\/api\/clients\/list\?/g],
    ["app/team/page.tsx", /\/api\/team\?/g],
    ["app/services/page.tsx", /\/api\/services\?/g],
    ["app/activity/page.tsx", /\/api\/activity\?/g],
  ];

  for (const [file, listUrl] of pages) {
    it(`${file} only loads its list through fetchLatestJson`, () => {
      const source = readFileSync(path.join(root, file), "utf8");
      assert.match(source, /useState\(createLatestRequest\)/);
      assert.match(source, /return \(\) => listRequest\.abort\(\);/);

      const urls = source.match(listUrl) ?? [];
      const guarded = source.match(/fetchLatestJson\(ticket, `/g) ?? [];
      assert.ok(urls.length > 0, `${file} no longer loads its list`);
      assert.equal(guarded.length, urls.length, `${file} has a list fetch without the guard`);
      assert.doesNotMatch(source, /await fetch\(`\/api\/(clients\/list|team|services|activity)\?/);
    });
  }
});
