import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import ts from "typescript";

import { isUuid } from "../team/payload";
import { receiptFilename } from "./receipt";

const ORDER_ID = "6f1c2f8e-1b2a-4c3d-9e4f-0a1b2c3d4e5f";
const PDF = Buffer.from("%PDF-1.7 fake receipt");

type Options = {
  denied?: 401 | 403 | 503;
  missing?: boolean;
  renderFails?: boolean;
  reference?: string;
};

function route(options: Options = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const supabase = { marker: "session-client" };
  const json = (body: unknown, init?: ResponseInit) => {
    const headers = new Headers(init?.headers);
    headers.set("Cache-Control", "private, no-store, max-age=0, must-revalidate");
    return Response.json(body, { ...init, headers });
  };
  const deps: Record<string, unknown> = {
    "next/server": { NextRequest: Request },
    "@/lib/http/operational-cache": { operationalJson: json },
    "@/lib/tenant/access-response": {
      requireCurrentAccess: async (name: string) => {
        calls.push({ name: "requireCurrentAccess", args: [name] });
        return options.denied
          ? { ok: false, response: Response.json({ code: "SESSION_EXPIRED" }, { status: options.denied }) }
          : { ok: true, context: { tenant: { id: "tenant-a", name: "Taller", slug: "a" }, user: { id: "u" } } };
      },
    },
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/team/payload": { isUuid },
    "@/lib/print/load-receipt": {
      loadCustomerReceipt: async (...args: unknown[]) => {
        calls.push({ name: "loadCustomerReceipt", args });
        if (options.missing) return { status: "not_found" };
        const reference = options.reference ?? "S4C-0020";
        return {
          status: "ok",
          logo: null,
          model: { reference, filename: receiptFilename(reference), title: "Encuadernaciones Magerit" },
        };
      },
    },
    "@/lib/print/receipt-logo": {
      loadReceiptLogo: async (...args: unknown[]) => {
        calls.push({ name: "loadReceiptLogo", args });
        return undefined;
      },
    },
    "@/lib/print/receipt-pdf/render": {
      renderCustomerReceiptPdf: async (...args: unknown[]) => {
        calls.push({ name: "renderCustomerReceiptPdf", args });
        if (options.renderFails) throw new Error("font missing at /var/task/assets");
        return PDF;
      },
    },
  };
  const source = readFileSync(new URL("../../app/api/orders/[id]/receipt/route.ts", import.meta.url), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as Record<string, (request: Request, context: unknown) => Promise<Response>> };
  new Function("require", "module", "exports", js)((name: string) => {
    if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`);
    return deps[name];
  }, mod, mod.exports);
  return {
    calls,
    supabase,
    exports: mod.exports,
    get: (id = ORDER_ID, query = "") =>
      mod.exports.GET(new Request(`https://a.local/api/orders/${id}/receipt${query}`), {
        params: Promise.resolve({ id }),
      }),
  };
}

describe("GET /api/orders/[id]/receipt (SUR4 E4)", () => {
  it("only exposes GET", () => {
    assert.deepEqual(Object.keys(route().exports).filter((key) => typeof route().exports[key] === "function"), ["GET"]);
  });

  it("answers 401/403/503 from the session guard before reading anything", async () => {
    for (const denied of [401, 403, 503] as const) {
      const h = route({ denied });
      const response = await h.get();
      assert.equal(response.status, denied);
      assert.deepEqual(h.calls.map((call) => call.name), ["requireCurrentAccess"]);
    }
  });

  it("answers 404 for a malformed id without touching the database", async () => {
    for (const id of ["bad", "../../etc", `${ORDER_ID}x`]) {
      const h = route();
      const response = await h.get(id);
      assert.equal(response.status, 404);
      assert.equal(response.headers.get("Cache-Control")?.startsWith("private, no-store"), true);
      assert.deepEqual(h.calls.map((call) => call.name), ["requireCurrentAccess"]);
    }
  });

  it("answers 404 for an order of another tenant or a missing one, without rendering", async () => {
    const h = route({ missing: true });
    const response = await h.get();
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("Content-Type")?.includes("application/json"), true);
    assert.equal(response.headers.get("Cache-Control")?.startsWith("private, no-store"), true);
    assert.equal(h.calls.some((call) => call.name === "renderCustomerReceiptPdf"), false);
  });

  it("binds the receipt to the session tenant, whatever the query says", async () => {
    const h = route();
    await h.get(ORDER_ID, "?tenant_id=tenant-b&tenant=b&profile=ficha");
    const load = h.calls.find((call) => call.name === "loadCustomerReceipt");
    assert.deepEqual(load?.args, [ORDER_ID, { supabase: h.supabase, tenant: { id: "tenant-a", name: "Taller", slug: "a" } }]);
  });

  it("serves the PDF inline, private and not stored, named only by the reference", async () => {
    const h = route();
    const response = await h.get();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/pdf");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Content-Disposition"), 'inline; filename="Resguardo-S4C-0020.pdf"');
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), PDF);
    assert.deepEqual(h.calls.map((call) => call.name), [
      "requireCurrentAccess",
      "loadCustomerReceipt",
      "loadReceiptLogo",
      "renderCustomerReceiptPdf",
    ]);
  });

  it("keeps the file name to safe characters of the reference", async () => {
    const response = await route({ reference: 'S4C/0020"; filename="x.pdf' }).get();
    const disposition = response.headers.get("Content-Disposition") ?? "";
    assert.equal(disposition, 'inline; filename="Resguardo-S4C-0020-filename-x-pdf.pdf"');
    assert.equal((disposition.match(/"/g) ?? []).length, 2);
  });

  it("answers 503 without details when the PDF cannot be rendered", async () => {
    const response = await route({ renderFails: true }).get();
    assert.equal(response.status, 503);
    const body = JSON.stringify(await response.json());
    assert.equal(body.includes("/var/task"), false);
    assert.equal(response.headers.get("Cache-Control")?.startsWith("private, no-store"), true);
  });

  it("is covered by the release gate guard list and never uses the service role", () => {
    const source = readFileSync(new URL("../../app/api/orders/[id]/receipt/route.ts", import.meta.url), "utf8");
    assert.match(source, /requireCurrentAccess\(/);
    assert.equal(/createAdminClient|service_role|putDocumentOnce|presign/.test(source), false);
  });
});
