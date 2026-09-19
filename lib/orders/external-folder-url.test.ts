import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeExternalFolderUrl } from "./external-folder-url";

describe("normalizeExternalFolderUrl", () => {
  it("accepts http(s) URLs", () => {
    assert.deepEqual(
      normalizeExternalFolderUrl("https://drive.google.com/folder/123"),
      { ok: true, value: "https://drive.google.com/folder/123" }
    );
    assert.deepEqual(normalizeExternalFolderUrl("http://example.com/folder"), {
      ok: true,
      value: "http://example.com/folder",
    });
  });

  it("normalizes null/blank to null", () => {
    assert.deepEqual(normalizeExternalFolderUrl(null), {
      ok: true,
      value: null,
    });
    assert.deepEqual(normalizeExternalFolderUrl(""), {
      ok: true,
      value: null,
    });
    assert.deepEqual(normalizeExternalFolderUrl("   "), {
      ok: true,
      value: null,
    });
  });

  it("rejects unsafe or invalid schemes and non-URLs", () => {
    assert.equal(normalizeExternalFolderUrl("javascript:alert(1)").ok, false);
    assert.equal(normalizeExternalFolderUrl("data:text/html,test").ok, false);
    assert.equal(normalizeExternalFolderUrl("ftp://example.com").ok, false);
    assert.equal(normalizeExternalFolderUrl("not-a-url").ok, false);
    assert.equal(normalizeExternalFolderUrl(123).ok, false);
  });

  it("rejects values longer than 2048 characters", () => {
    const long = `https://example.com/${"a".repeat(2100)}`;
    assert.equal(normalizeExternalFolderUrl(long).ok, false);
  });

  it("trims surrounding whitespace on valid URLs", () => {
    assert.deepEqual(
      normalizeExternalFolderUrl("  https://example.com/x  "),
      { ok: true, value: "https://example.com/x" }
    );
  });
});
