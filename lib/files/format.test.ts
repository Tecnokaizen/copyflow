import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatFileSize, formatFileTimestamp } from "./format";
import { fileKindFromFilename, fileKindLabel } from "./file-kind";

describe("formatFileSize", () => {
  it("formats bytes in Spanish locale units", () => {
    assert.equal(formatFileSize(512), "512 B");
    assert.match(formatFileSize(8_400_000), /MB/);
  });
});

describe("formatFileTimestamp", () => {
  it("returns em dash for empty", () => {
    assert.equal(formatFileTimestamp(null), "—");
  });
});

describe("fileKindFromFilename", () => {
  it("maps common extensions to visual kinds", () => {
    assert.equal(fileKindFromFilename("a.pdf"), "pdf");
    assert.equal(fileKindFromFilename("photo.PNG"), "image");
    assert.equal(fileKindFromFilename("sheet.xlsx"), "spreadsheet");
    assert.equal(fileKindFromFilename("pack.zip"), "archive");
    assert.equal(fileKindLabel("pdf"), "PDF");
  });
});
