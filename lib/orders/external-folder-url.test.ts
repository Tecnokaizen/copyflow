import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  externalLocationHref,
  normalizeExternalFolderUrl,
} from "./external-folder-url";

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

  it("accepts network paths, relative paths and plain references", () => {
    for (const value of [
      "\\\\servidor\\trabajos\\2026\\S4C-0020",
      "smb://nas.local/clientes/magerit",
      "file://servidor/compartido/pedido",
      "ftp://example.com/entrada",
      "Z:\\Clientes\\Magerit",
      "./clientes/magerit",
      "Clientes/Magerit/2026",
      "Lo trae el cliente en USB",
      "https://",
    ]) {
      assert.deepEqual(normalizeExternalFolderUrl(value), { ok: true, value });
    }
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

  it("rejects script-like schemes, control characters and non-strings", () => {
    assert.equal(normalizeExternalFolderUrl("javascript:alert(1)").ok, false);
    assert.equal(normalizeExternalFolderUrl(" JavaScript :alert(1)").ok, false);
    assert.equal(normalizeExternalFolderUrl("data:text/html,test").ok, false);
    assert.equal(normalizeExternalFolderUrl("vbscript:msgbox(1)").ok, false);
    assert.equal(normalizeExternalFolderUrl("linea 1\nlinea 2").ok, false);
    assert.equal(normalizeExternalFolderUrl("a\u0000b").ok, false);
    assert.equal(normalizeExternalFolderUrl(123).ok, false);
  });

  it("rejects values longer than 2048 characters", () => {
    const long = `https://example.com/${"a".repeat(2100)}`;
    assert.equal(normalizeExternalFolderUrl(long).ok, false);
  });

  it("trims surrounding whitespace", () => {
    assert.deepEqual(
      normalizeExternalFolderUrl("  https://example.com/x  "),
      { ok: true, value: "https://example.com/x" }
    );
  });
});

describe("externalLocationHref", () => {
  it("links only real http(s) URLs", () => {
    assert.equal(
      externalLocationHref("https://drive.google.com/x"),
      "https://drive.google.com/x"
    );
    assert.equal(externalLocationHref("http://example.com"), "http://example.com/");
  });

  it("never links paths, references or other schemes", () => {
    for (const value of [
      null,
      "",
      "\\\\servidor\\trabajos",
      "smb://nas/x",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "Lo trae el cliente",
      "https://",
    ]) {
      assert.equal(externalLocationHref(value), null, String(value));
    }
  });
});
