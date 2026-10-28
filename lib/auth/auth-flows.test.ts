/**
 * Wiring checks for the auth screens: recovery goes through the server,
 * nothing sends users to the starter's /protected page, and the forms and
 * messages are in Spanish.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(path.join(root, dir))) {
    if (["node_modules", ".next", ".git"].includes(entry)) continue;
    const rel = path.posix.join(dir, entry);
    if (statSync(path.join(root, rel)).isDirectory()) {
      walk(rel, out);
    } else if (/\.(ts|tsx|mts|mjs)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

const AUTH_UI = [
  "app/auth/error/page.tsx",
  "app/auth/forgot-password/page.tsx",
  "app/auth/login/page.tsx",
  "app/auth/sign-up/page.tsx",
  "app/auth/sign-up-success/page.tsx",
  "app/auth/update-password/page.tsx",
  "components/forgot-password-form.tsx",
  "components/login-form.tsx",
  "components/sign-up-form.tsx",
  "components/update-password-form.tsx",
];

/** Visible English strings from the Supabase starter. */
const STARTER_ENGLISH = [
  "Login",
  "Logging in",
  "Sign up",
  "Forgot your password",
  "Don't have an account",
  "Don&apos;t have an account",
  "Already have an account",
  "Reset Your Password",
  "Check Your Email",
  "Send reset email",
  "Save new password",
  "New password",
  "Repeat Password",
  "Passwords do not match",
  "An error occurred",
  "Thank you for signing up",
  "Sorry, something went wrong",
  "Code error",
  "An unspecified error occurred",
  "Enter your email",
  "m@example.com",
];

describe("/protected is gone", () => {
  it("has no page and nothing navigates there", () => {
    assert.equal(existsSync(path.join(root, "app/protected")), false);
    const files = [...walk("app"), ...walk("components"), ...walk("lib"), "proxy.ts"];
    const offenders = files.filter((file) => /["'`]\/protected\b/.test(readSource(file)));
    assert.deepEqual(offenders, []);
  });

  it("old links open the app home", () => {
    const config = readSource("next.config.ts");
    assert.match(config, /source: "\/protected", destination: "\/", permanent: false/);
  });
});

describe("password recovery wiring", () => {
  it("asks Supabase to return to /auth/recovery, not to the form", () => {
    const form = readSource("components/forgot-password-form.tsx");
    assert.match(form, /redirectTo: buildAuthRecoveryUrl\(window\.location\.origin, safeNext\)/);
    assert.doesNotMatch(form, /\/auth\/update-password/);
  });

  it("opens the session in a route handler, redirecting outside try/catch", () => {
    const route = readSource("app/auth/recovery/route.ts");
    assert.match(route, /export async function GET\(request: NextRequest\)/);
    assert.match(route, /resolveRecoveryRedirect\(/);
    assert.match(route, /\(await createClient\(\)\)\.auth/);
    assert.match(route, /^\s*redirect\(destination\);/m);
    assert.doesNotMatch(route, /\btry\b/);
    assert.doesNotMatch(route, /createAdminClient|SERVICE_ROLE|SECRET_KEY|service_role/);
  });

  it("checks the session on the server before showing the form", () => {
    const page = readSource("app/auth/update-password/page.tsx");
    assert.match(page, /legacyRecoveryForwardPath\(query\)/);
    assert.match(page, /supabase\.auth\.getClaims\(\)/);
    assert.match(page, /recoveryFailurePath\("session_missing", nextPath\)/);
    assert.match(page, /<Suspense/);
  });

  it("goes to a safe internal page after saving, with a full navigation", () => {
    const form = readSource("components/update-password-form.tsx");
    assert.match(form, /getPostAuthRedirectPath\(nextPath\)/);
    assert.match(form, /window\.location\.assign\(destination\)/);
    assert.doesNotMatch(form, /router\.push/);
    assert.match(form, /PASSWORDS_DO_NOT_MATCH/);
  });

  it("login keeps next safe and passes it to recovery", () => {
    const form = readSource("components/login-form.tsx");
    assert.match(form, /const safeNext = getPostAuthRedirectPath\(nextPath\)/);
    assert.match(form, /authHrefWithNext\("\/auth\/forgot-password", safeNext\)/);
    assert.match(form, /window\.location\.assign\(safeNext\)/);
    const page = readSource("app/auth/login/page.tsx");
    assert.match(page, /getPostAuthRedirectPath\(params\.next\)/);
  });
});

describe("auth screens are in Spanish", () => {
  it("has no starter English left", () => {
    for (const file of AUTH_UI) {
      const source = readSource(file);
      for (const text of STARTER_ENGLISH) {
        // Match visible text and string literals, not identifiers like LoginForm.
        const pattern = new RegExp(`[>"'\`]\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);
        assert.doesNotMatch(source, pattern, `${file}: ${text}`);
      }
    }
  });

  it("never renders raw Supabase error messages", () => {
    for (const file of AUTH_UI) {
      const source = readSource(file);
      assert.doesNotMatch(source, /setError\(\s*error instanceof Error \? error\.message/, file);
      assert.doesNotMatch(source, /\{params\.error\}/, file);
    }
  });

  it("Staging E2E scripts click the Spanish login button", () => {
    for (const file of walk("e2e")) {
      const source = readSource(file);
      assert.doesNotMatch(source, /name:\s*["']Login["']/, file);
    }
  });
});
