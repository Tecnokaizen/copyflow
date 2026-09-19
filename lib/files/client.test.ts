import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("prevalidateClientFile / max size", () => {
  it("rejects files over 100 MiB with Spanish message", async () => {
    const { prevalidateClientFile, MAX_ORDER_FILE_BYTES } =
      await import("./client");
    const file = {
      name: "huge.pdf",
      type: "application/pdf",
      size: MAX_ORDER_FILE_BYTES + 1,
    } as File;
    const message = prevalidateClientFile(file);
    assert.equal(typeof message, "string");
    assert.match(message!, /100 MB/);
    assert.equal(MAX_ORDER_FILE_BYTES, 104_857_600);
  });

  it("rejects blocked extensions", async () => {
    const { prevalidateClientFile } = await import("./client");
    const file = {
      name: "evil.exe",
      type: "application/octet-stream",
      size: 100,
    } as File;
    assert.match(prevalidateClientFile(file)!, /no admitido/i);
  });

  it("accepts allowlisted files", async () => {
    const { prevalidateClientFile } = await import("./client");
    const file = {
      name: "brief.pdf",
      type: "application/pdf",
      size: 2048,
    } as File;
    assert.equal(prevalidateClientFile(file), null);
  });
});

describe("public file DTO", () => {
  it("does not require storage_key for UI display", async () => {
    const { toPublicOrderFileDto } = await import("./dto");
    const dto = toPublicOrderFileDto({
      id: "f1",
      original_name: "a.pdf",
      content_type: "application/pdf",
      size_bytes: 10,
      status: "ready",
      created_at: "2026-01-01T00:00:00.000Z",
      completed_at: "2026-01-01T00:01:00.000Z",
      uploaded_by: "u1",
      storage_key: "secret/path",
    });
    assert.equal(dto.original_name, "a.pdf");
    assert.equal("storage_key" in dto, false);
    assert.equal("tenant_id" in dto, false);
  });
});

describe("uploadOrderFile pipeline", () => {
  const originalFetch = globalThis.fetch;
  const originalXHR = globalThis.XMLHttpRequest;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXHR;
    mock.restoreAll();
  });

  function mockXhrSuccess(assertHeaders?: Record<string, string>) {
    class FakeXHR {
      status = 200;
      upload = {
        onprogress: null as ((ev: ProgressEvent) => void) | null,
      };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      private headers: Record<string, string> = {};

      open() {}
      setRequestHeader(key: string, value: string) {
        this.headers[key] = value;
      }
      send() {
        if (assertHeaders) {
          for (const [k, v] of Object.entries(assertHeaders)) {
            assert.equal(this.headers[k], v);
          }
        }
        void Promise.resolve().then(() => {
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded: 50,
            total: 100,
          } as ProgressEvent);
          this.upload.onprogress?.({
            lengthComputable: true,
            loaded: 100,
            total: 100,
          } as ProgressEvent);
          this.onload?.();
        });
      }
    }
    // @ts-expect-error test stub
    globalThis.XMLHttpRequest = FakeXHR;
  }

  function mockXhrFailure() {
    class FakeXHR {
      status = 403;
      upload = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open() {}
      setRequestHeader() {}
      send() {
        void Promise.resolve().then(() => this.onload?.());
      }
    }
    // @ts-expect-error test stub
    globalThis.XMLHttpRequest = FakeXHR;
  }

  it("runs INIT → PUT → COMPLETE and uses required_headers", async () => {
    const { uploadOrderFile } = await import("./client");
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    let completeCalled = false;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push({
        url,
        method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (method === "POST" && url.endsWith("/files")) {
        return new Response(
          JSON.stringify({
            file_id: "file-1",
            upload_url: "https://r2.example/put",
            required_headers: { "Content-Type": "application/pdf" },
            expires_at: "2099-01-01T00:00:00.000Z",
          }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      if (method === "POST" && url.includes("/complete")) {
        completeCalled = true;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    mockXhrSuccess({ "Content-Type": "application/pdf" });

    const phases: string[] = [];
    const file = {
      name: "doc.pdf",
      type: "application/pdf",
      size: 12,
    } as File;

    const result = await uploadOrderFile("order-1", file, {
      onPhase: (phase) => phases.push(phase),
    });

    assert.equal(result.fileId, "file-1");
    assert.equal(completeCalled, true);
    assert.deepEqual(
      calls.map((c) => c.method + " " + c.url.replace(/^.*\/api/, "/api")),
      [
        "POST /api/orders/order-1/files",
        "POST /api/orders/order-1/files/file-1/complete",
      ],
    );
    assert.deepEqual(calls[0]?.body, {
      filename: "doc.pdf",
      content_type: "application/pdf",
      size_bytes: 12,
    });
    assert.ok(phases.includes("initializing"));
    assert.ok(phases.includes("uploading"));
    assert.ok(phases.includes("completing"));
    assert.ok(phases.includes("success"));
  });

  it("does not call COMPLETE when PUT fails", async () => {
    const { uploadOrderFile } = await import("./client");
    let completeCalled = false;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/files")) {
        return new Response(
          JSON.stringify({
            file_id: "file-2",
            upload_url: "https://r2.example/put",
            required_headers: { "Content-Type": "text/plain" },
            expires_at: "2099-01-01T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      if (url.includes("/complete")) {
        completeCalled = true;
        return new Response("{}", { status: 200 });
      }
      return new Response("no", { status: 500 });
    }) as typeof fetch;

    mockXhrFailure();

    const file = {
      name: "note.txt",
      type: "text/plain",
      size: 4,
    } as File;

    await assert.rejects(() => uploadOrderFile("order-1", file), /subir/);
    assert.equal(completeCalled, false);
  });

  it("retry path issues a fresh INIT (new upload_url)", async () => {
    const { uploadOrderFile } = await import("./client");
    const initBodies: unknown[] = [];
    let initCount = 0;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (method === "POST" && url.endsWith("/files")) {
        initCount += 1;
        initBodies.push(init?.body ? JSON.parse(String(init.body)) : null);
        return new Response(
          JSON.stringify({
            file_id: `file-${initCount}`,
            upload_url: `https://r2.example/put-${initCount}`,
            required_headers: { "Content-Type": "application/pdf" },
            expires_at: "2099-01-01T00:00:00.000Z",
          }),
          { status: 201 },
        );
      }
      if (url.includes("/complete")) {
        return new Response("{}", { status: 200 });
      }
      return new Response("no", { status: 500 });
    }) as typeof fetch;

    mockXhrSuccess({ "Content-Type": "application/pdf" });

    const file = {
      name: "a.pdf",
      type: "application/pdf",
      size: 8,
    } as File;

    await uploadOrderFile("order-9", file);
    await uploadOrderFile("order-9", file);

    assert.equal(initCount, 2);
    assert.equal(initBodies.length, 2);
  });
});

describe("deleteOrderFile", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("calls DELETE /api/orders/:orderId/files/:fileId", async () => {
    const { deleteOrderFile } = await import("./client");
    let seenUrl = "";
    let seenMethod = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenMethod = init?.method ?? "GET";
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    await deleteOrderFile("ord-1", "file-9");
    assert.equal(seenMethod, "DELETE");
    assert.match(seenUrl, /\/api\/orders\/ord-1\/files\/file-9$/);
  });
});

describe("archived order mutation controls", () => {
  it("UI section source hides mutate controls when canMutate is false", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../../components/files/order-files-section.tsx"),
      "utf8",
    );
    assert.match(source, /canMutate && showDropzone/);
    assert.match(source, /canMutate && !loading/);
    assert.match(source, /archived/);
    assert.doesNotMatch(source, /storage_key/);
    assert.doesNotMatch(source, /FILES_SIGNING_SECRET/);
    assert.doesNotMatch(source, /tenant_id/);
  });

  it("workspace wires remount key and canMutateOrderActions for files section", () => {
    const source = readFileSync(
      join(
        import.meta.dirname,
        "../../components/orders/detail/order-workspace.tsx",
      ),
      "utf8",
    );
    assert.match(source, /OrderFilesSection/);
    assert.match(source, /key=\{order\.id\}/);
    assert.match(source, /canMutateOrderActions/);
    assert.match(source, /isOrderArchived\(order\)/);
  });

  it("files section guards async updates and silent refresh failures", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../../components/files/order-files-section.tsx"),
      "utf8",
    );
    assert.match(source, /canApplyFilesUiUpdate/);
    assert.match(source, /createConcurrencyGate/);
    assert.match(source, /claimUploadLocalId/);
    assert.match(source, /SILENT_LIST_REFRESH_NOTICE/);
    assert.match(source, /actionError/);
    assert.doesNotMatch(source, /uploadQueueRef/);
    assert.doesNotMatch(source, /setDownloadError/);
  });
});

describe("putFileToPresignedUrl", () => {
  const originalXHR = globalThis.XMLHttpRequest;

  afterEach(() => {
    globalThis.XMLHttpRequest = originalXHR;
  });

  it("sends PUT with required headers", async () => {
    const { putFileToPresignedUrl } = await import("./client");
    const headersSeen: Record<string, string> = {};
    let method = "";
    let url = "";

    class FakeXHR {
      status = 200;
      upload = { onprogress: null as ((ev: ProgressEvent) => void) | null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;
      open(m: string, u: string) {
        method = m;
        url = u;
      }
      setRequestHeader(k: string, v: string) {
        headersSeen[k] = v;
      }
      send() {
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 1,
          total: 1,
        } as ProgressEvent);
        this.onload?.();
      }
    }
    // @ts-expect-error test stub
    globalThis.XMLHttpRequest = FakeXHR;

    const progress: number[] = [];
    await putFileToPresignedUrl(
      "https://r2.example/obj",
      new Blob(["x"]),
      { "Content-Type": "text/plain" },
      (p) => progress.push(p),
    );

    assert.equal(method, "PUT");
    assert.equal(url, "https://r2.example/obj");
    assert.equal(headersSeen["Content-Type"], "text/plain");
    assert.ok(progress.includes(100));
  });
});
