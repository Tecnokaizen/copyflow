/**
 * Tests for the Supabase Auth probe behind "Correo confirmado".
 *
 * The probe must only answer true when Supabase Auth recognises the code
 * (`bad_code_verifier` or `flow_state_expired`), so a made-up `code` never
 * shows success.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PROBE_CODE_VERIFIER,
  authErrorCode,
  createAuthCodeProbe,
  looksLikeAuthCode,
} from "./auth-code-probe";

/** Same shape as a Supabase Auth `auth_code` (a UUID); not a real one. */
const CODE = "0b8c6c1e-5f1a-4c2e-9d0e-2f3a4b5c6d7e";

type Recorded = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response | Promise<Response>) {
  const requests: Recorded[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { requests, fetchImpl };
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function probeWith(respond: () => Response | Promise<Response>) {
  const fake = fakeFetch(respond);
  const probe = createAuthCodeProbe({
    supabaseUrl: "https://project.supabase.co/",
    apiKey: "sb_publishable_test",
    fetchImpl: fake.fetchImpl,
  });
  return { probe, requests: fake.requests };
}

describe("Supabase Auth code probe", () => {
  it("asks the PKCE token endpoint with a verifier that never matches", async () => {
    const { probe, requests } = probeWith(() =>
      json(400, { code: 400, error_code: "bad_code_verifier", msg: "x" })
    );

    await probe(CODE);

    assert.equal(requests.length, 1);
    const [request] = requests;
    assert.equal(
      request.url,
      "https://project.supabase.co/auth/v1/token?grant_type=pkce"
    );
    assert.equal(request.init.method, "POST");
    assert.equal(request.init.cache, "no-store");
    assert.ok(request.init.signal, "has a timeout");
    assert.deepEqual(request.init.headers, {
      apikey: "sb_publishable_test",
      "Content-Type": "application/json",
    });
    assert.deepEqual(JSON.parse(String(request.init.body)), {
      auth_code: CODE,
      code_verifier: PROBE_CODE_VERIFIER,
    });
    // Supabase rejects an empty verifier before looking up the code.
    assert.ok(PROBE_CODE_VERIFIER.length > 0);
  });

  it("is true for a real code with the wrong verifier", async () => {
    const { probe } = probeWith(() =>
      json(400, {
        code: 400,
        error_code: "bad_code_verifier",
        msg: "code challenge does not match previously saved code verifier",
      })
    );
    assert.equal(await probe(CODE), true);
  });

  it("is true for a real code whose sign-up flow expired", async () => {
    const { probe } = probeWith(() =>
      json(422, {
        code: 422,
        error_code: "flow_state_expired",
        msg: "invalid flow state, flow state has expired",
      })
    );
    assert.equal(await probe(CODE), true);
  });

  it("reads the newer error shape too", async () => {
    const { probe } = probeWith(() =>
      json(400, { code: "bad_code_verifier", message: "x" })
    );
    assert.equal(await probe(CODE), true);
  });

  it("is false for an unknown code", async () => {
    const { probe } = probeWith(() =>
      json(404, {
        code: 404,
        error_code: "flow_state_not_found",
        msg: "invalid flow state, no valid flow state found",
      })
    );
    assert.equal(await probe(CODE), false);
  });

  it("is false for any other error", async () => {
    for (const body of [
      { code: 400, error_code: "validation_failed", msg: "x" },
      { code: 429, error_code: "over_request_rate_limit", msg: "x" },
      { message: "no code" },
    ]) {
      const { probe } = probeWith(() => json(400, body));
      assert.equal(await probe(CODE), false, JSON.stringify(body));
    }
  });

  it("is false for an unexpected success", async () => {
    const { probe } = probeWith(() => json(200, { access_token: "t" }));
    assert.equal(await probe(CODE), false);
  });

  it("is false when the body is not JSON", async () => {
    const { probe } = probeWith(
      () => new Response("<html>bad gateway</html>", { status: 502 })
    );
    assert.equal(await probe(CODE), false);
  });

  it("is false and does not throw when the request fails", async () => {
    const { probe } = probeWith(() => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await probe(CODE), false);
  });

  it("is false when Supabase does not answer in time", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // AbortSignal.timeout does not keep the process alive on its own, so
        // hold a timer until the abort arrives.
        const keepAlive = setTimeout(() => {}, 5000);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(init.signal?.reason);
        });
      })) as typeof fetch;
    const probe = createAuthCodeProbe({
      supabaseUrl: "https://project.supabase.co",
      apiKey: "k",
      fetchImpl,
      timeoutMs: 10,
    });
    assert.equal(await probe(CODE), false);
  });
});

describe("Supabase Auth code shape", () => {
  it("does not call Supabase for a code that is not a UUID", async () => {
    for (const code of [
      "made-up",
      "",
      "0b8c6c1e5f1a4c2e9d0e2f3a4b5c6d7e",
      `${CODE}x`,
      ` ${CODE}`,
      "'; drop table x; --",
    ]) {
      const { probe, requests } = probeWith(() =>
        json(400, { code: 400, error_code: "bad_code_verifier", msg: "x" })
      );
      assert.equal(await probe(code), false, code);
      assert.equal(requests.length, 0, code);
    }
  });

  it("accepts Supabase's UUID auth codes in either case", () => {
    assert.equal(looksLikeAuthCode(CODE), true);
    assert.equal(looksLikeAuthCode(CODE.toUpperCase()), true);
    assert.equal(looksLikeAuthCode("made-up"), false);
  });
});

describe("authErrorCode", () => {
  it("reads error_code first, then a string code", () => {
    assert.equal(
      authErrorCode({ code: 400, error_code: "bad_code_verifier" }),
      "bad_code_verifier"
    );
    assert.equal(
      authErrorCode({ code: "flow_state_expired" }),
      "flow_state_expired"
    );
  });

  it("returns null for anything else", () => {
    for (const body of [null, undefined, "x", 1, {}, { code: 400 }]) {
      assert.equal(authErrorCode(body), null, JSON.stringify(body));
    }
  });
});
