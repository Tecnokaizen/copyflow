import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LAST_OWNER_REQUIRED_MESSAGE } from "@/lib/access/owner-protection";
import {
  classifyAccessRpcError,
  publicMessageForAccessRpcError,
  rpcErrorDigest,
  statusForAccessRpcError,
} from "./rpc-error";
import { publicAccessUiError } from "./ui";

describe("last owner protection errors", () => {
  it("maps GTO01 to a clear last-owner message", () => {
    assert.equal(classifyAccessRpcError("GTO01"), "last_owner");
    assert.equal(statusForAccessRpcError("GTO01"), 403);
    assert.equal(
      publicMessageForAccessRpcError("GTO01"),
      LAST_OWNER_REQUIRED_MESSAGE
    );
    assert.equal(
      publicAccessUiError(403, {
        code: "GTO01",
        error: LAST_OWNER_REQUIRED_MESSAGE,
      }),
      LAST_OWNER_REQUIRED_MESSAGE
    );
  });

  it("joins message, details and hint for classification", () => {
    const digest = rpcErrorDigest({
      code: "42501",
      message: "permission denied",
      details: "invitation email mismatch",
      hint: "check jwt email",
    });
    assert.equal(digest.code, "42501");
    assert.match(digest.message ?? "", /invitation email mismatch/);
    assert.equal(
      classifyAccessRpcError(digest.code, digest.message),
      "email_mismatch"
    );
  });

  it("maps the SQL message even without the custom code", () => {
    assert.equal(
      classifyAccessRpcError("42501", "last owner required"),
      "last_owner"
    );
  });
});
