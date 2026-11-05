import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildAuthRecoveryUrl,
  getPostAuthRedirectPath,
} from "./safe-next-path";

const EXTERNAL = [
  "https://evil.example",
  "http://evil.example/orders",
  "//evil.example",
  "///evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "javascript:alert(1)",
  "/javascript:alert(1)",
  "data:text/html,hi",
  "/orders\u0000",
  "orders",
  "",
  "   ",
];

describe("getPostAuthRedirectPath (after login or a new password)", () => {
  it("keeps internal pages with query and hash", () => {
    assert.equal(getPostAuthRedirectPath("/orders"), "/orders");
    assert.equal(getPostAuthRedirectPath("/orders?status=open#top"), "/orders?status=open#top");
    assert.equal(
      getPostAuthRedirectPath("/invitations/accept?token=abc"),
      "/invitations/accept?token=abc"
    );
  });

  it("rejects external or malformed destinations", () => {
    for (const raw of EXTERNAL) {
      assert.equal(getPostAuthRedirectPath(raw), "/", JSON.stringify(raw));
    }
    assert.equal(getPostAuthRedirectPath(null), "/");
    assert.equal(getPostAuthRedirectPath(undefined), "/");
  });

  it("rejects auth screens (login loops) and API routes", () => {
    for (const raw of [
      "/auth",
      "/auth/login",
      "/auth/login?next=/orders",
      "/auth/update-password",
      "/auth/recovery?code=x",
      "/api/orders",
      "/api",
    ]) {
      assert.equal(getPostAuthRedirectPath(raw), "/", raw);
    }
    // Only exact segments: similar names are app pages.
    assert.equal(getPostAuthRedirectPath("/authors"), "/authors");
    assert.equal(getPostAuthRedirectPath("/apiary"), "/apiary");
  });

  it("uses the given fallback", () => {
    assert.equal(getPostAuthRedirectPath("https://evil.example", "/orders"), "/orders");
  });
});

describe("buildAuthRecoveryUrl", () => {
  it("points at /auth/recovery on the same origin, with a safe next", () => {
    assert.equal(
      buildAuthRecoveryUrl("https://sur4.app.gestcopy.com", "/orders"),
      "https://sur4.app.gestcopy.com/auth/recovery?next=%2Forders"
    );
  });

  it("always carries ?next= so a template can append &token_hash=...", () => {
    for (const next of [undefined, null, "", "https://evil.example", "/auth/login"]) {
      assert.equal(
        buildAuthRecoveryUrl("https://app.gestcopy.com", next),
        "https://app.gestcopy.com/auth/recovery?next=%2F"
      );
    }
  });

  it("no longer sends recovery emails to /auth/update-password", () => {
    assert.ok(!buildAuthRecoveryUrl("https://app.gestcopy.com", "/").includes("update-password"));
  });
});
