/**
 * Regression tests for password recovery (`/auth/recovery`).
 *
 * Before: the email sent users to /auth/update-password, which showed the form
 * even when the link was expired, already used or opened in another browser.
 * Saving then failed with "Auth session missing!" and success went to the
 * starter's /protected page. Recovery now opens the session on the server and
 * explains every failure in Spanish, for both PKCE `code` and `token_hash`.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RECOVERY_FAILURE_MESSAGES } from "./auth-messages";
import {
  legacyRecoveryForwardPath,
  parseRecoveryCallback,
  recoveryFailurePath,
  recoveryFailureReason,
  recoveryStateFromHash,
  resolveRecoveryRedirect,
  updatePasswordPath,
  type RecoveryAuthClient,
} from "./recovery-callback";

type Call =
  | { method: "verifyOtp"; type: string; token_hash: string }
  | { method: "exchangeCodeForSession"; code: string };

type FakeError = { message: string; code?: string; name?: string; status?: number };

function fakeAuth(
  options: {
    verifyError?: FakeError;
    exchangeError?: FakeError;
    exchangeThrows?: unknown;
  } = {}
) {
  const calls: Call[] = [];
  let created = 0;

  const client: RecoveryAuthClient = {
    async verifyOtp({ type, token_hash }) {
      calls.push({ method: "verifyOtp", type, token_hash });
      return { error: options.verifyError ?? null };
    },
    async exchangeCodeForSession(code) {
      calls.push({ method: "exchangeCodeForSession", code });
      if (options.exchangeThrows) throw options.exchangeThrows;
      return { error: options.exchangeError ?? null };
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

function query(params: Record<string, string>) {
  return new URLSearchParams(params);
}

const CODE = "6f1c1f9e-8f0a-4b7e-9d55-3b1f0f6f2a10";

describe("resolveRecoveryRedirect: valid links open the new-password form", () => {
  it("exchanges a PKCE code and goes to /auth/update-password", async () => {
    const auth = fakeAuth();
    const destination = await resolveRecoveryRedirect(
      query({ code: CODE, next: "/orders" }),
      auth.getAuthClient
    );
    assert.equal(destination, "/auth/update-password?next=%2Forders");
    assert.deepEqual(auth.calls, [{ method: "exchangeCodeForSession", code: CODE }]);
  });

  it("verifies token_hash with type recovery (custom template, any browser)", async () => {
    const auth = fakeAuth();
    const destination = await resolveRecoveryRedirect(
      query({ token_hash: "pkce_abc123", type: "recovery", next: "/" }),
      auth.getAuthClient
    );
    assert.equal(destination, "/auth/update-password");
    assert.deepEqual(auth.calls, [
      { method: "verifyOtp", type: "recovery", token_hash: "pkce_abc123" },
    ]);
  });

  it("prefers token_hash when a link carries both shapes", async () => {
    const auth = fakeAuth();
    await resolveRecoveryRedirect(
      query({ token_hash: "hash", type: "recovery", code: CODE }),
      auth.getAuthClient
    );
    assert.deepEqual(auth.calls.map((call) => call.method), ["verifyOtp"]);
  });

  it("never goes straight to next: the new password comes first", async () => {
    const auth = fakeAuth();
    const destination = await resolveRecoveryRedirect(
      query({ code: CODE, next: "/quotes/new" }),
      auth.getAuthClient
    );
    assert.ok(destination.startsWith("/auth/update-password"));
  });
});

describe("resolveRecoveryRedirect: expired links", () => {
  it("maps the Supabase redirect for an old or used link (otp_expired)", async () => {
    const auth = fakeAuth();
    const destination = await resolveRecoveryRedirect(
      query({
        error: "access_denied",
        error_code: "otp_expired",
        error_description: "Email link is invalid or has expired",
        next: "/orders",
      }),
      auth.getAuthClient
    );
    assert.equal(
      destination,
      "/auth/forgot-password?next=%2Forders&error=link_expired"
    );
    assert.equal(auth.created(), 0, "no Supabase client for a provider error");
  });

  it("maps a PKCE flow older than 5 minutes (flow_state_expired)", async () => {
    const auth = fakeAuth({
      exchangeError: { message: "invalid flow state, flow state has expired", code: "flow_state_expired" },
    });
    const destination = await resolveRecoveryRedirect(
      query({ code: CODE }),
      auth.getAuthClient
    );
    assert.equal(destination, "/auth/forgot-password?error=link_expired");
  });

  it("maps an expired token_hash", async () => {
    const auth = fakeAuth({
      verifyError: { message: "Email link is invalid or has expired", code: "otp_expired" },
    });
    const destination = await resolveRecoveryRedirect(
      query({ token_hash: "hash", type: "recovery" }),
      auth.getAuthClient
    );
    assert.equal(destination, "/auth/forgot-password?error=link_expired");
  });

  it("uses the description when Supabase sends no code", async () => {
    assert.equal(
      parseRecoveryCallback(
        query({ error_description: "Email link is invalid or has expired" })
      ).kind,
      "failure"
    );
    assert.equal(
      recoveryFailureReason({ message: "Email link is invalid or has expired" }),
      "link_expired"
    );
  });
});

describe("resolveRecoveryRedirect: link opened in another browser", () => {
  it("maps a missing code verifier returned as an error", async () => {
    const auth = fakeAuth({
      exchangeError: {
        name: "AuthPKCECodeVerifierMissingError",
        message: "PKCE code verifier not found in storage.",
        code: "pkce_code_verifier_not_found",
        status: 400,
      },
    });
    const destination = await resolveRecoveryRedirect(
      query({ code: CODE, next: "/orders" }),
      auth.getAuthClient
    );
    assert.equal(
      destination,
      "/auth/forgot-password?next=%2Forders&error=link_other_browser"
    );
  });

  it("maps a missing code verifier thrown by the SDK", async () => {
    const thrown = Object.assign(
      new Error("PKCE code verifier not found in storage."),
      { name: "AuthPKCECodeVerifierMissingError", code: "pkce_code_verifier_not_found", status: 400 }
    );
    const auth = fakeAuth({ exchangeThrows: thrown });
    const destination = await resolveRecoveryRedirect(
      query({ code: CODE }),
      auth.getAuthClient
    );
    assert.equal(destination, "/auth/forgot-password?error=link_other_browser");
  });

  it("maps a verifier from a newer request in this browser (bad_code_verifier)", async () => {
    const auth = fakeAuth({
      exchangeError: { message: "code challenge does not match previously saved code verifier", code: "bad_code_verifier" },
    });
    assert.equal(
      await resolveRecoveryRedirect(query({ code: CODE }), auth.getAuthClient),
      "/auth/forgot-password?error=link_other_browser"
    );
  });

  it("explains the other-browser case in Spanish and offers a new link", () => {
    const message = RECOVERY_FAILURE_MESSAGES.link_other_browser;
    assert.match(message, /mismo navegador donde pediste el cambio/);
    assert.match(message, /pide uno nuevo/i);
  });
});

describe("resolveRecoveryRedirect: invalid links", () => {
  it("rejects a link without code or token", async () => {
    const auth = fakeAuth();
    assert.equal(
      await resolveRecoveryRedirect(query({ next: "/orders" }), auth.getAuthClient),
      "/auth/forgot-password?next=%2Forders&error=link_invalid"
    );
    assert.equal(auth.created(), 0);
  });

  it("only opens sessions for type=recovery", async () => {
    for (const type of ["signup", "magiclink", "invite", "email_change", ""]) {
      const auth = fakeAuth();
      const destination = await resolveRecoveryRedirect(
        query({ token_hash: "hash", type }),
        auth.getAuthClient
      );
      assert.equal(destination, "/auth/forgot-password?error=link_invalid", type);
      assert.equal(auth.created(), 0, type);
    }
  });

  it("maps a used or unknown code (flow_state_not_found)", async () => {
    const auth = fakeAuth({
      exchangeError: { message: "invalid flow state, no valid flow state found", code: "flow_state_not_found" },
    });
    assert.equal(
      await resolveRecoveryRedirect(query({ code: CODE }), auth.getAuthClient),
      "/auth/forgot-password?error=link_invalid"
    );
  });

  it("reports a network failure as temporary", async () => {
    const auth = fakeAuth({
      exchangeThrows: Object.assign(new Error("fetch failed"), {
        name: "AuthRetryableFetchError",
        status: 0,
      }),
    });
    assert.equal(
      await resolveRecoveryRedirect(query({ code: CODE }), auth.getAuthClient),
      "/auth/forgot-password?error=service_unavailable"
    );
  });
});

describe("recovery redirects stay internal", () => {
  const hostile = [
    "https://evil.example/steal",
    "//evil.example",
    "/\\evil.example",
    "javascript:alert(1)",
    "/%0d%0aSet-Cookie:x=1",
    "/auth/login",
    "/auth/update-password",
    "/api/orders",
  ];

  it("drops external, auth and API destinations from next", async () => {
    for (const next of hostile) {
      const success = await resolveRecoveryRedirect(
        query({ code: CODE, next }),
        fakeAuth().getAuthClient
      );
      const failure = await resolveRecoveryRedirect(
        query({ next }),
        fakeAuth().getAuthClient
      );
      for (const destination of [success, failure]) {
        assert.ok(destination.startsWith("/auth/"), `${next} -> ${destination}`);
        assert.ok(!destination.includes("evil"), `${next} -> ${destination}`);
        assert.doesNotMatch(destination, /[\r\n]/);
        const kept = new URL(destination, "http://safe.local").searchParams.get("next");
        assert.ok(
          kept === null ||
            (kept.startsWith("/") &&
              !kept.startsWith("//") &&
              !/^\/(auth|api)(\/|$)/.test(kept)),
          `${next} kept ${kept}`
        );
      }
    }
  });

  it("keeps internal destinations with their query", () => {
    assert.equal(
      updatePasswordPath("/orders?status=open"),
      "/auth/update-password?next=%2Forders%3Fstatus%3Dopen"
    );
    assert.equal(
      recoveryFailurePath("link_expired", "/orders?status=open"),
      "/auth/forgot-password?next=%2Forders%3Fstatus%3Dopen&error=link_expired"
    );
  });
});

describe("legacyRecoveryForwardPath: links sent before /auth/recovery", () => {
  it("forwards a PKCE code that landed on /auth/update-password", () => {
    assert.equal(
      legacyRecoveryForwardPath(query({ code: CODE })),
      `/auth/recovery?code=${CODE}&next=%2F`
    );
  });

  it("forwards the Supabase error for an expired link", () => {
    const forward = legacyRecoveryForwardPath(
      query({ error: "access_denied", error_code: "otp_expired", error_description: "Email link is invalid or has expired" })
    );
    assert.ok(forward);
    const params = new URL(forward, "http://safe.local").searchParams;
    assert.equal(params.get("error_code"), "otp_expired");
  });

  it("does nothing for a normal visit or a bare type", () => {
    assert.equal(legacyRecoveryForwardPath(query({})), null);
    assert.equal(legacyRecoveryForwardPath(query({ next: "/orders" })), null);
    assert.equal(legacyRecoveryForwardPath(query({ type: "recovery" })), null);
  });

  it("drops unknown parameters and unsafe next", () => {
    const forward = legacyRecoveryForwardPath(
      query({ code: CODE, next: "https://evil.example", redirect: "https://evil.example" })
    );
    assert.equal(forward, `/auth/recovery?code=${CODE}&next=%2F`);
  });
});

describe("recoveryStateFromHash: errors Supabase puts in the URL fragment", () => {
  it("reads an expired link from the fragment (implicit flow, or next to the PKCE query)", () => {
    assert.deepEqual(
      recoveryStateFromHash(
        "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb="
      ),
      { failure: "link_expired", shouldClear: true }
    );
  });

  it("falls back to error or error_description when error_code is missing", () => {
    assert.equal(
      recoveryStateFromHash("#error_description=Email+link+is+invalid+or+has+expired").failure,
      "link_expired"
    );
    assert.equal(recoveryStateFromHash("#error=server_error").failure, "link_invalid");
  });

  it("clears tokens from the address bar without reporting a failure", () => {
    assert.deepEqual(
      recoveryStateFromHash("#access_token=secret&refresh_token=secret&type=recovery"),
      { failure: null, shouldClear: true }
    );
  });

  it("leaves unrelated fragments alone", () => {
    assert.deepEqual(recoveryStateFromHash(""), { failure: null, shouldClear: false });
    assert.deepEqual(recoveryStateFromHash("#top"), { failure: null, shouldClear: false });
  });
});
