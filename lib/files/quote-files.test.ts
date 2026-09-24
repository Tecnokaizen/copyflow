import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFilesCapabilityPayload,
  buildQuoteFilesCapabilityPayload,
  createQuoteFilesCapability,
} from "./capability";
import { uploadHeadFailure } from "./complete-head";
import { buildQuoteFileStorageKey } from "./object-key";

const SECRET = "quote-files-test-signing-secret-32";

describe("quote file capability", () => {
  const input = {
    purpose: "create" as const,
    userId: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    quoteId: "33333333-3333-4333-8333-333333333333",
    fileId: "44444444-4444-4444-8444-444444444444",
    issuedAt: 1_700_000_000,
  };

  it("uses the quote payload and rejects tampered ids", () => {
    const capability = createQuoteFilesCapability(input, SECRET);
    const payload = buildQuoteFilesCapabilityPayload(input);
    assert.match(payload, /^files-v1-quote\|/);
    assert.equal(
      capability.signature,
      createHmac("sha256", SECRET).update(payload, "utf8").digest("hex")
    );
    assert.notEqual(
      buildFilesCapabilityPayload({ ...input, orderId: input.quoteId }),
      payload
    );

    const flipped = capability.signature.replace(/^./, (char) =>
      char === "a" ? "b" : "a"
    );
    assert.notEqual(flipped, capability.signature);

    const otherQuote = createQuoteFilesCapability(
      { ...input, quoteId: "55555555-5555-4555-8555-555555555555" },
      SECRET
    );
    const otherFile = createQuoteFilesCapability(
      { ...input, fileId: "66666666-6666-4666-8666-666666666666" },
      SECRET
    );
    assert.notEqual(otherQuote.signature, capability.signature);
    assert.notEqual(otherFile.signature, capability.signature);
  });

  it("keeps the historical order payload prefix", () => {
    const source = readFileSync(join(import.meta.dirname, "capability.ts"), "utf8");
    assert.match(source, /"files-v1"/);
    assert.match(
      readFileSync(
        join(
          import.meta.dirname,
          "../../supabase/migrations/20260918220000_order_files_v1.sql"
        ),
        "utf8"
      ),
      /files-v1\|/
    );
    assert.doesNotMatch(
      readFileSync(
        join(
          import.meta.dirname,
          "../../supabase/migrations/20260918220000_order_files_v1.sql"
        ),
        "utf8"
      ),
      /files-v1-quote/
    );
  });
});

describe("quote storage key and complete head", () => {
  it("builds quotes/{tenant}/{quote}/{file}", () => {
    assert.equal(
      buildQuoteFileStorageKey({
        tenantId: "22222222-2222-4222-8222-222222222222",
        quoteId: "33333333-3333-4333-8333-333333333333",
        fileId: "44444444-4444-4444-8444-444444444444",
      }),
      "quotes/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444"
    );
  });

  it("fails a missing object and a size mismatch, and accepts a matching head", () => {
    assert.equal(uploadHeadFailure({ exists: false, contentLength: null }, 10), "missing");
    assert.equal(uploadHeadFailure({ exists: true, contentLength: 9 }, 10), "mismatch");
    assert.equal(uploadHeadFailure({ exists: true, contentLength: 10 }, 10), null);
  });
});

describe("quote files client and section", () => {
  it("targets quote endpoints and reuses the order files section", async () => {
    const { deleteQuoteFile, listQuoteFiles } = await import("./client");
    const seen: string[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? "GET"} ${String(input)}`);
      if ((init?.method ?? "GET") === "DELETE") {
        return new Response(null, { status: 204 });
      }
      return new Response(
        JSON.stringify({ files: [], max_file_bytes: 1048576 }),
        { status: 200 }
      );
    }) as typeof fetch;
    try {
      await listQuoteFiles("quote-1");
      await deleteQuoteFile("quote-1", "file-9");
    } finally {
      globalThis.fetch = original;
    }
    assert.deepEqual(seen, [
      "GET /api/quotes/quote-1/files",
      "DELETE /api/quotes/quote-1/files/file-9",
    ]);

    const section = readFileSync(
      join(import.meta.dirname, "../../components/quotes/quote-files-section.tsx"),
      "utf8"
    );
    assert.match(section, /OrderFilesSection/);
    assert.match(section, /uploadQuoteFile/);
    assert.match(section, /requestQuoteFileDownload/);
    assert.match(section, /deleteQuoteFile/);
    const page = readFileSync(
      join(import.meta.dirname, "../../app/quotes/[id]/page.tsx"),
      "utf8"
    );
    assert.match(page, /QuoteFilesSection/);
  });
});
