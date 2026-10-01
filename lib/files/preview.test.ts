import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  contentDispositionAttachment,
  contentDispositionInline,
} from "./access";
import {
  requestOrderFilePreview,
  requestQuoteFilePreview,
} from "./client";
import {
  isCurrentPreviewRequest,
  isPreviewableFilename,
  resolveFilePreview,
  runFilePreview,
  type PreviewFileRecord,
} from "./preview";

const SECRET_KEY = "tenants/secret-storage-key/object";

function readyFile(
  name: string,
  contentType: string | null = "application/octet-stream",
): PreviewFileRecord {
  return {
    original_name: name,
    content_type: contentType,
    status: "ready",
    deleted_at: null,
    storage_key: SECRET_KEY,
  };
}

function presignSpy() {
  const calls: Array<{
    key: string;
    responseContentDisposition: string;
    responseContentType: string;
  }> = [];
  return {
    calls,
    presign: async (args: {
      key: string;
      expiresIn: number;
      responseContentDisposition: string;
      responseContentType: string;
    }) => {
      calls.push(args);
      return "https://r2.example/signed";
    },
  };
}

async function preview(overrides: Partial<Parameters<typeof runFilePreview>[0]>) {
  const spy = presignSpy();
  const result = await runFilePreview({
    idsValid: true,
    parentFound: true,
    parentMissingError: "Order not found",
    file: readyFile("informe.pdf"),
    presign: spy.presign,
    now: Date.parse("2026-09-29T12:00:00.000Z"),
    ...overrides,
  });
  return { result, spy };
}

describe("preview policy", () => {
  it("allows pdf and raster images with a server-forced MIME", () => {
    assert.deepEqual(resolveFilePreview("Arte.PDF"), {
      previewable: true,
      kind: "pdf",
      contentType: "application/pdf",
    });
    for (const [name, contentType] of [
      ["foto.jpg", "image/jpeg"],
      ["foto.jpeg", "image/jpeg"],
      ["foto.PNG", "image/png"],
      ["foto.webp", "image/webp"],
      ["anim.gif", "image/gif"],
    ] as const) {
      assert.deepEqual(resolveFilePreview(name), {
        previewable: true,
        kind: "image",
        contentType,
      });
    }
  });

  it("rejects svg, office, archives and other non-preview formats", () => {
    for (const name of [
      "logo.svg",
      "scan.tif",
      "scan.tiff",
      "phone.heic",
      "phone.heif",
      "nota.doc",
      "nota.docx",
      "tabla.xls",
      "tabla.xlsx",
      "deck.ppt",
      "deck.pptx",
      "texto.odt",
      "tabla.ods",
      "nota.rtf",
      "datos.csv",
      "nota.txt",
      "marca.ai",
      "vector.eps",
      "capa.psd",
      "maqueta.indd",
      "paquete.zip",
      "paquete.rar",
      "paquete.7z",
      "sin-extension",
      "doble.pdf.svg",
    ]) {
      assert.equal(isPreviewableFilename(name), false, name);
    }
    assert.equal(isPreviewableFilename("seguro.svg.pdf"), true);
  });
});

describe("preview endpoint decisions", () => {
  it("allows a ready PDF and forces application/pdf", async () => {
    const { result, spy } = await preview({
      file: readyFile("contrato.pdf", "image/svg+xml"),
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.content_type, "application/pdf");
    assert.equal(result.body.kind, "pdf");
    assert.equal(result.body.preview_url, "https://r2.example/signed");
    assert.equal(spy.calls[0]?.responseContentType, "application/pdf");
    assert.match(spy.calls[0]?.responseContentDisposition ?? "", /^inline;/);
    assert.equal(JSON.stringify(result.body).includes(SECRET_KEY), false);
    assert.equal(JSON.stringify(result.body).includes("storage_key"), false);
  });

  it("allows png, jpg, webp and gif", async () => {
    for (const name of ["a.png", "a.jpg", "a.webp", "a.gif"]) {
      const { result } = await preview({ file: readyFile(name, "text/plain") });
      assert.equal(result.status, 200, name);
      assert.equal(result.body.kind, "image");
    }
  });

  it("denies svg, docx and zip", async () => {
    for (const name of ["logo.svg", "nota.docx", "paquete.zip"]) {
      const { result, spy } = await preview({
        file: readyFile(name, "application/pdf"),
      });
      assert.equal(result.status, 415, name);
      assert.equal(result.body.error, "Preview not supported");
      assert.equal(spy.calls.length, 0);
      assert.equal(JSON.stringify(result.body).includes(SECRET_KEY), false);
    }
  });

  it("hides missing, cross-parent and cross-tenant files", async () => {
    const missing = await preview({ file: null });
    assert.equal(missing.result.status, 404);
    const otherParent = await preview({
      parentFound: false,
      file: null,
    });
    assert.equal(otherParent.result.status, 404);
    assert.equal(otherParent.result.body.error, "Order not found");
    const badId = await preview({ idsValid: false, file: null });
    assert.equal(badId.result.status, 404);
    assert.equal(missing.spy.calls.length, 0);
    assert.equal(otherParent.spy.calls.length, 0);
  });

  it("hides a deleted file and rejects a pending upload", async () => {
    const deleted = await preview({
      file: { ...readyFile("a.pdf"), deleted_at: "2026-09-01T00:00:00.000Z" },
    });
    assert.equal(deleted.result.status, 404);
    const pending = await preview({
      file: { ...readyFile("a.pdf"), status: "pending" },
    });
    assert.equal(pending.result.status, 409);
    assert.equal(pending.result.body.code, "UPLOAD_INCOMPLETE");
    assert.equal(deleted.spy.calls.length, 0);
    assert.equal(pending.spy.calls.length, 0);
  });

  it("stops before signing when quote access is denied", async () => {
    const { result, spy } = await preview({
      accessDenied: { status: 403, body: { error: "Unauthorized" } },
      file: readyFile("a.pdf"),
    });
    assert.equal(result.status, 403);
    assert.equal(spy.calls.length, 0);
    assert.equal(JSON.stringify(result.body).includes(SECRET_KEY), false);
  });

  it("sanitizes Content-Disposition for inline and attachment", () => {
    const name = 'informe "final"\r\nX.pdf';
    const inline = contentDispositionInline(name);
    const attachment = contentDispositionAttachment(name);
    assert.match(inline, /^inline;/);
    assert.match(attachment, /^attachment;/);
    assert.equal(inline.includes('"'), true);
    assert.equal(inline.includes("\r"), false);
    assert.equal(inline.includes("\n"), false);
    assert.equal(inline.includes('""'), false);
    assert.match(inline, /filename="informe finalX\.pdf"/);
  });
});

describe("preview request races", () => {
  it("drops a late response that no longer matches the open file", () => {
    assert.equal(
      isCurrentPreviewRequest({ requestId: 1, activeId: 2, aborted: false }),
      false,
    );
    assert.equal(
      isCurrentPreviewRequest({ requestId: 1, activeId: 1, aborted: true }),
      false,
    );
    assert.equal(
      isCurrentPreviewRequest({ requestId: 2, activeId: 2, aborted: false }),
      true,
    );
  });
});

describe("preview client", () => {
  it("requests a fresh order or quote preview and forwards the abort signal", async () => {
    const seen: Array<{ url: string; signal: AbortSignal | null | undefined }> =
      [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), signal: init?.signal });
      return new Response(
        JSON.stringify({
          preview_url: "https://r2.example/one",
          expires_at: "2026-09-29T12:05:00.000Z",
          filename: "a.pdf",
          content_type: "application/pdf",
          kind: "pdf",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const controller = new AbortController();
    try {
      const order = await requestOrderFilePreview(
        "order-1",
        "file-1",
        controller.signal,
      );
      const quote = await requestQuoteFilePreview("quote-1", "file-2");
      assert.equal(order.kind, "pdf");
      assert.equal(quote.content_type, "application/pdf");
      assert.deepEqual(
        seen.map((entry) => entry.url),
        [
          "/api/orders/order-1/files/file-1/preview",
          "/api/quotes/quote-1/files/file-2/preview",
        ],
      );
      assert.equal(seen[0]?.signal, controller.signal);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("turns an unsupported preview into a user-facing error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Preview not supported" }), {
        status: 415,
      })) as typeof fetch;
    try {
      await assert.rejects(
        () => requestOrderFilePreview("order-1", "file-1"),
        /no se puede previsualizar/i,
      );
    } finally {
      globalThis.fetch = original;
    }
  });
});
