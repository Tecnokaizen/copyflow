import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildFilesCapabilityPayload,
  createFilesCapability,
  FILES_CAPABILITY_TTL_SECONDS,
  requireFilesSigningSecret,
} from "./capability";

const SECRET = "files-signing-secret-at-least-32-chars!!";

describe("files capability", () => {
  it("builds the exact canonical payload", () => {
    assert.equal(
      buildFilesCapabilityPayload({
        purpose: "create",
        userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        orderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        fileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        issuedAt: 1_800_000_000,
      }),
      [
        "files-v1",
        "create",
        "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        "1800000000",
      ].join("|")
    );
  });

  it("signs with HMAC-SHA256 hex (64 chars)", () => {
    const input = {
      purpose: "complete" as const,
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      orderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      fileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      issuedAt: 1_800_000_000,
    };
    const cap = createFilesCapability(input, SECRET);
    assert.equal(cap.issuedAt, input.issuedAt);
    assert.match(cap.signature, /^[a-f0-9]{64}$/);
    const expected = createHmac("sha256", SECRET)
      .update(buildFilesCapabilityPayload(input), "utf8")
      .digest("hex");
    assert.equal(cap.signature, expected);
  });

  it("rejects short secrets", () => {
    assert.throws(() => requireFilesSigningSecret("short"), /at least 32/);
    assert.throws(
      () =>
        createFilesCapability(
          {
            purpose: "delete",
            userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            orderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            fileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            issuedAt: 1,
          },
          "too-short"
        ),
      /at least 32/
    );
  });

  it("pins TTL contract to 120 seconds", () => {
    assert.equal(FILES_CAPABILITY_TTL_SECONDS, 120);
  });

  it("never embeds the secret in the signature payload", () => {
    const payload = buildFilesCapabilityPayload({
      purpose: "create",
      userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      tenantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      orderId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      fileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      issuedAt: 42,
    });
    assert.equal(payload.includes(SECRET), false);
  });
});
