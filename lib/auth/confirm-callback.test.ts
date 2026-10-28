/**
 * Regression tests for `/auth/confirm`.
 *
 * Staging S10 (28/10/2026): a public sign-up was confirmed by Supabase, but
 * the default email link came back with a PKCE `code` and the route only
 * accepted `token_hash` + `type`, so the user saw "No token hash or type" and
 * got no session. Both link shapes must keep working.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  INVALID_CONFIRM_TYPE,
  MISSING_CONFIRM_PARAMS,
  confirmErrorPath,
  parseConfirmCallback,
  resolveConfirmRedirect,
  type ConfirmAuthClient,
} from "./confirm-callback";

type Call =
  | { method: "verifyOtp"; type: string; token_hash: string }
  | { method: "exchangeCodeForSession"; code: string };

function fakeAuth(options: {
  verifyError?: string;
  exchangeError?: string;
  exchangeThrows?: Error;
} = {}) {
  const calls: Call[] = [];
  let created = 0;

  const client: ConfirmAuthClient = {
    async verifyOtp({ type, token_hash }) {
      calls.push({ method: "verifyOtp", type, token_hash });
      return {
        error: options.verifyError ? { message: options.verifyError } : null,
      };
    },
    async exchangeCodeForSession(code) {
      calls.push({ method: "exchangeCodeForSession", code });
      if (options.exchangeThrows) {
        throw options.exchangeThrows;
      }
      return {
        error: options.exchangeError
          ? { message: options.exchangeError }
          : null,
      };
    },
  };

  return {
    calls,
    created: () => created,
    getAuthClient: async () => {
      created += 1;
      return client;
    },
  };
}

function params(query: string) {
  return new URLSearchParams(query);
}

describe("/auth/confirm with a PKCE code (default Supabase email link)", () => {
  it("exchanges the code and continues to next, as in the S10 sign-up", async () => {
    const auth = fakeAuth();
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding&code=0b8c6c1e-5f1a-4c2e-9d0e-2f3a4b5c6d7e"),
      auth.getAuthClient
    );

    assert.equal(destination, "/onboarding");
    assert.deepEqual(auth.calls, [
      {
        method: "exchangeCodeForSession",
        code: "0b8c6c1e-5f1a-4c2e-9d0e-2f3a4b5c6d7e",
      },
    ]);
  });

  it("sends a failed exchange to the error page, not to next", async () => {
    const auth = fakeAuth({
      exchangeError: "PKCE code verifier not found in storage.",
    });
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding&code=abc"),
      auth.getAuthClient
    );

    assert.equal(
      destination,
      confirmErrorPath("PKCE code verifier not found in storage.")
    );
  });

  it("turns a thrown exchange into the error page", async () => {
    const auth = fakeAuth({ exchangeThrows: new Error("network down") });
    const destination = await resolveConfirmRedirect(
      params("code=abc"),
      auth.getAuthClient
    );

    assert.equal(destination, confirmErrorPath("network down"));
  });
});

describe("/auth/confirm with token_hash and type (custom email template)", () => {
  it("verifies the token and continues to next", async () => {
    const auth = fakeAuth();
    const destination = await resolveConfirmRedirect(
      params("token_hash=pkce_abc123&type=email&next=%2Fonboarding"),
      auth.getAuthClient
    );

    assert.equal(destination, "/onboarding");
    assert.deepEqual(auth.calls, [
      { method: "verifyOtp", type: "email", token_hash: "pkce_abc123" },
    ]);
  });

  it("accepts every Supabase email OTP type", async () => {
    for (const type of [
      "signup",
      "invite",
      "magiclink",
      "recovery",
      "email_change",
      "email",
    ]) {
      const request = parseConfirmCallback(
        params(`token_hash=h&type=${type}`)
      );
      assert.equal(request.kind, "token_hash", type);
    }
  });

  it("sends a failed verification to the error page", async () => {
    const auth = fakeAuth({ verifyError: "Token has expired or is invalid" });
    const destination = await resolveConfirmRedirect(
      params("token_hash=h&type=signup&next=%2Fonboarding"),
      auth.getAuthClient
    );

    assert.equal(
      destination,
      confirmErrorPath("Token has expired or is invalid")
    );
  });

  it("prefers token_hash when a link carries both shapes", async () => {
    const auth = fakeAuth();
    await resolveConfirmRedirect(
      params("token_hash=h&type=email&code=c"),
      auth.getAuthClient
    );

    assert.deepEqual(auth.calls, [
      { method: "verifyOtp", type: "email", token_hash: "h" },
    ]);
  });

  it("rejects an unknown type without calling Supabase", async () => {
    const auth = fakeAuth();
    const destination = await resolveConfirmRedirect(
      params("token_hash=h&type=admin"),
      auth.getAuthClient
    );

    assert.equal(destination, confirmErrorPath(INVALID_CONFIRM_TYPE));
    assert.equal(auth.created(), 0);
  });
});

describe("/auth/confirm without anything to verify", () => {
  it("shows Supabase's own error, e.g. a link opened twice", async () => {
    const auth = fakeAuth();
    const destination = await resolveConfirmRedirect(
      params(
        "next=%2Fonboarding&error=access_denied&error_code=otp_expired" +
          "&error_description=Email+link+is+invalid+or+has+expired"
      ),
      auth.getAuthClient
    );

    assert.equal(
      destination,
      confirmErrorPath("Email link is invalid or has expired")
    );
    assert.equal(auth.created(), 0);
  });

  it("keeps the missing-parameters error and never creates a client", async () => {
    const auth = fakeAuth();
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding"),
      auth.getAuthClient
    );

    assert.equal(destination, confirmErrorPath(MISSING_CONFIRM_PARAMS));
    assert.equal(auth.created(), 0);
  });

  it("ignores blank values", () => {
    assert.deepEqual(parseConfirmCallback(params("code=%20&token_hash=")), {
      kind: "error",
      message: MISSING_CONFIRM_PARAMS,
    });
  });
});

describe("/auth/confirm destination", () => {
  it("never follows an external next after a successful exchange", async () => {
    for (const next of [
      "https://evil.example/x",
      "//evil.example/x",
      "/javascript:alert(1)",
    ]) {
      const auth = fakeAuth();
      const destination = await resolveConfirmRedirect(
        params(`code=abc&next=${encodeURIComponent(next)}`),
        auth.getAuthClient
      );
      assert.equal(destination, "/", next);
    }
  });

  it("defaults to / when next is missing", async () => {
    const auth = fakeAuth();
    assert.equal(
      await resolveConfirmRedirect(params("code=abc"), auth.getAuthClient),
      "/"
    );
  });
});

describe("/auth/confirm route wiring", () => {
  it("delegates to resolveConfirmRedirect and redirects once", () => {
    const source = readFileSync(
      path.join(process.cwd(), "app/auth/confirm/route.ts"),
      "utf8"
    );

    assert.match(source, /resolveConfirmRedirect\(/);
    assert.equal(source.match(/redirect\(/g)?.length, 1);
    assert.doesNotMatch(source, /No token hash or type/);
  });
});
