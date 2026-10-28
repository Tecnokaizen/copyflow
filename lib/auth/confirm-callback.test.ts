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
  confirmedLoginPath,
  confirmedPath,
  parseConfirmCallback,
  resolveConfirmRedirect,
  type ConfirmAuthClient,
} from "./confirm-callback";

type Call =
  | { method: "verifyOtp"; type: string; token_hash: string }
  | { method: "exchangeCodeForSession"; code: string };

function fakeAuth(options: {
  verifyError?: string;
  verifyErrorCode?: string;
  exchangeError?: string;
  exchangeErrorCode?: string;
  exchangeThrows?: Error;
} = {}) {
  const calls: Call[] = [];
  let created = 0;

  const client: ConfirmAuthClient = {
    async verifyOtp({ type, token_hash }) {
      calls.push({ method: "verifyOtp", type, token_hash });
      return {
        error: options.verifyError
          ? { message: options.verifyError, code: options.verifyErrorCode }
          : null,
      };
    },
    async exchangeCodeForSession(code) {
      calls.push({ method: "exchangeCodeForSession", code });
      if (options.exchangeThrows) {
        throw options.exchangeThrows;
      }
      return {
        error: options.exchangeError
          ? { message: options.exchangeError, code: options.exchangeErrorCode }
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

/** Records the codes it is asked about and answers as configured. */
function fakeProbe(answer: boolean | Error) {
  const codes: string[] = [];
  return {
    codes,
    probe: async (code: string) => {
      codes.push(code);
      if (answer instanceof Error) {
        throw answer;
      }
      return answer;
    },
  };
}

const MISSING_VERIFIER_MESSAGE = "PKCE code verifier not found in storage.";

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

describe("/auth/confirm when the email is confirmed but there is no session", () => {
  // Owner decision (28/10): show "Correo confirmado. Ya puedes iniciar sesión"
  // only when the confirmation is real.

  it("opens the confirmed page when another device has no verifier but Supabase knows the code", async () => {
    const auth = fakeAuth({
      exchangeError: MISSING_VERIFIER_MESSAGE,
      exchangeErrorCode: "pkce_code_verifier_not_found",
    });
    const probe = fakeProbe(true);
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding&code=real-code"),
      auth.getAuthClient,
      probe.probe
    );

    assert.equal(destination, "/auth/confirmed?next=%2Fonboarding");
    assert.deepEqual(probe.codes, ["real-code"]);
  });

  it("keeps the error page for a made-up code without a verifier", async () => {
    const auth = fakeAuth({
      exchangeError: MISSING_VERIFIER_MESSAGE,
      exchangeErrorCode: "pkce_code_verifier_not_found",
    });
    const probe = fakeProbe(false);
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding&code=made-up"),
      auth.getAuthClient,
      probe.probe
    );

    assert.equal(destination, confirmErrorPath(MISSING_VERIFIER_MESSAGE));
    assert.deepEqual(probe.codes, ["made-up"]);
  });

  it("never shows success when the probe fails", async () => {
    const auth = fakeAuth({
      exchangeError: MISSING_VERIFIER_MESSAGE,
      exchangeErrorCode: "pkce_code_verifier_not_found",
    });
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding&code=abc"),
      auth.getAuthClient,
      fakeProbe(new Error("probe exploded")).probe
    );

    assert.equal(destination, confirmErrorPath("probe exploded"));
  });

  it("keeps the error page when no probe is given", async () => {
    const auth = fakeAuth({
      exchangeError: MISSING_VERIFIER_MESSAGE,
      exchangeErrorCode: "pkce_code_verifier_not_found",
    });
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding&code=abc"),
      auth.getAuthClient
    );

    assert.equal(destination, confirmErrorPath(MISSING_VERIFIER_MESSAGE));
  });

  it("opens the confirmed page when the link is used after the sign-up flow expired, without probing", async () => {
    const auth = fakeAuth({
      exchangeError: "invalid flow state, flow state has expired",
      exchangeErrorCode: "flow_state_expired",
    });
    const probe = fakeProbe(false);
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding&code=abc"),
      auth.getAuthClient,
      probe.probe
    );

    assert.equal(destination, "/auth/confirmed?next=%2Fonboarding");
    assert.deepEqual(probe.codes, []);
  });

  it("opens the confirmed page when Supabase rejects this browser's verifier, without probing", async () => {
    const auth = fakeAuth({
      exchangeError:
        "code challenge does not match previously saved code verifier",
      exchangeErrorCode: "bad_code_verifier",
    });
    const probe = fakeProbe(false);
    const destination = await resolveConfirmRedirect(
      params("next=%2Fonboarding&code=abc"),
      auth.getAuthClient,
      probe.probe
    );

    assert.equal(destination, "/auth/confirmed?next=%2Fonboarding");
    assert.deepEqual(probe.codes, []);
  });

  it("keeps the error page for an unknown code or any other error, without probing", async () => {
    for (const [code, message] of [
      ["flow_state_not_found", "invalid flow state, no valid flow state found"],
      ["unexpected_failure", "Unexpected failure"],
      [undefined, "network down"],
    ] as const) {
      const auth = fakeAuth({ exchangeError: message, exchangeErrorCode: code });
      const probe = fakeProbe(true);
      const destination = await resolveConfirmRedirect(
        params("next=%2Fonboarding&code=abc"),
        auth.getAuthClient,
        probe.probe
      );

      assert.equal(destination, confirmErrorPath(message), String(code));
      assert.deepEqual(probe.codes, [], String(code));
    }
  });

  it("never turns a failed token_hash verification into the confirmed page", async () => {
    const auth = fakeAuth({
      verifyError: "Token has expired or is invalid",
      verifyErrorCode: "flow_state_expired",
    });
    const probe = fakeProbe(true);
    const destination = await resolveConfirmRedirect(
      params("token_hash=h&type=signup&next=%2Fonboarding"),
      auth.getAuthClient,
      probe.probe
    );

    assert.equal(
      destination,
      confirmErrorPath("Token has expired or is invalid")
    );
    assert.deepEqual(probe.codes, []);
  });

  it("drops an external next on the confirmed page and its login link", async () => {
    const auth = fakeAuth({
      exchangeError: MISSING_VERIFIER_MESSAGE,
      exchangeErrorCode: "pkce_code_verifier_not_found",
    });
    const destination = await resolveConfirmRedirect(
      params(`next=${encodeURIComponent("https://evil.example/x")}&code=abc`),
      auth.getAuthClient,
      fakeProbe(true).probe
    );

    assert.equal(destination, "/auth/confirmed?next=%2F");
    assert.equal(confirmedPath("//evil.example"), "/auth/confirmed?next=%2F");
    assert.equal(confirmedLoginPath("https://evil.example/x"), "/auth/login");
  });

  it("sends the login link back to next", () => {
    assert.equal(
      confirmedLoginPath("/onboarding"),
      "/auth/login?next=%2Fonboarding"
    );
    assert.equal(confirmedLoginPath(undefined), "/auth/login");
    assert.equal(confirmedLoginPath("/"), "/auth/login");
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

  it("passes the Supabase Auth probe with the public URL and key", () => {
    const source = readFileSync(
      path.join(process.cwd(), "app/auth/confirm/route.ts"),
      "utf8"
    );

    assert.match(source, /createAuthCodeProbe\(\{/);
    assert.match(source, /NEXT_PUBLIC_SUPABASE_URL/);
    assert.match(source, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
    assert.doesNotMatch(source, /SERVICE_ROLE/);
  });

  it("has a confirmed page with the owner's text and a login link", () => {
    const source = readFileSync(
      path.join(process.cwd(), "app/auth/confirmed/page.tsx"),
      "utf8"
    );

    assert.match(source, /Correo confirmado/);
    assert.match(source, /Ya puedes iniciar sesión\./);
    assert.match(source, /confirmedLoginPath\(params\.next\)/);
  });
});
