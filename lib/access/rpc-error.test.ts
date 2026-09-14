import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LAST_OWNER_REQUIRED_MESSAGE } from "@/lib/access/owner-protection";
import {
  classifyAccessRpcError,
  publicMessageForAccessRpcError,
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

  it("maps the SQL message even without the custom code", () => {
    assert.equal(
      classifyAccessRpcError("42501", "last owner required"),
      "last_owner"
    );
  });
});
