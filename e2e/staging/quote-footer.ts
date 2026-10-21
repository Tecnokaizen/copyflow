/** Staging: the tenant quote footer is printed exactly as configured (#144).
 * Synthetic `e2e` tenant only, through the existing guard and harness. For each
 * case it saves the footer in Settings, prepares a synthetic quote, generates
 * its commercial PDF in Staging R2, downloads it and reads what the PDF draws.
 * The original footer is restored at the end, also on failure. Never sends email.
 *
 *   set -a; source .env.e2e.local; set +a
 *   PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs npx tsx e2e/staging/quote-footer.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded at runtime, outside package.json. */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { drawnLines, type DrawnLine } from "../../lib/quotes/pdf/pdf-inspect";
import { quoteFooterLines } from "../../lib/quotes/pdf/render";
import { quoteFooterFromBranding } from "../../lib/tenant/branding";
import { classifyRequest, r2BucketFromUrl, resolveStagingTarget } from "./guard";
import { Harness } from "./harness";
import { Redactor } from "./redact";
import { requireSyntheticEmail, runId } from "./synthetic";

type FooterCase = { name: string; footer: string | null; lines?: string[]; items?: number };
// Generic data only: no real tenant text, address or format.
const CASES: FooterCase[] = [
  { name: "1-una-linea", footer: "<p>Empresa Ejemplo S.L. · CIF B00000000 · Calle Mayor 123, 28000 Madrid · Tel. 900 000 000</p>",
    lines: ["Empresa Ejemplo S.L. · CIF B00000000 · Calle Mayor 123, 28000 Madrid · Tel. 900 000 000"] },
  { name: "2-dos-lineas", footer: "<p>Empresa Ejemplo S.L. · CIF B00000000 · Calle Mayor 123, bajo izquierda · 28000 Madrid (España)</p><p>Tel. 900 000 000 · info@empresa-ejemplo.test · www.empresa-ejemplo.test</p>",
    lines: ["Empresa Ejemplo S.L. · CIF B00000000 · Calle Mayor 123, bajo izquierda · 28000 Madrid (España)", "Tel. 900 000 000 · info@empresa-ejemplo.test · www.empresa-ejemplo.test"] },
  { name: "3-tres-lineas", footer: "<p>Empresa Ejemplo S.L.<br>Calle Mayor 123, 28000 Madrid<br>Inscrita en el Registro Mercantil de Madrid, tomo 0000, folio 00, hoja M-000000</p>",
    lines: ["Empresa Ejemplo S.L.", "Calle Mayor 123, 28000 Madrid", "Inscrita en el Registro Mercantil de Madrid, tomo 0000, folio 00, hoja M-000000"] },
  { name: "4-cuatro-lineas-blanco-formato", footer: "<p><strong>Empresa Ejemplo S.L.</strong> · CIF B00000000</p><p></p><p><em>Horario:</em> lunes a viernes de 9:00 a 14:00 y de 16:00 a 19:30</p><p><a href=\"https://empresa-ejemplo.test\">empresa-ejemplo.test</a> · <u>info@empresa-ejemplo.test</u></p>",
    lines: ["Empresa Ejemplo S.L. · CIF B00000000", "", "Horario: lunes a viernes de 9:00 a 14:00 y de 16:00 a 19:30", "empresa-ejemplo.test · info@empresa-ejemplo.test"] },
  { name: "5-lineas-largas", footer: "<p>Condiciones: los precios incluyen IVA salvo indicación contraria; la validez de la oferta es de 30 días desde la fecha de emisión y los plazos de entrega se confirman al aceptar el presupuesto.</p><p>Pago: https://pagos.empresa-ejemplo.test/presupuestos/referencia-larga-sin-espacios-0123456789abcdefghijklmnopqrstuvwxyz0123456789abcdef</p>" },
  { name: "6-vacio", footer: null, lines: [] },
  { name: "7-varias-paginas", items: 40, footer: "<p>Empresa Ejemplo S.L. · CIF B00000000 · Calle Mayor 123, bajo izquierda · 28000 Madrid (España)</p><p>Tel. 900 000 000 · info@empresa-ejemplo.test</p>",
    lines: ["Empresa Ejemplo S.L. · CIF B00000000 · Calle Mayor 123, bajo izquierda · 28000 Madrid (España)", "Tel. 900 000 000 · info@empresa-ejemplo.test"] },
];
const PAGE_LABEL = /^\d+ \/ \d+$/;
const RIGHT_EDGE = 595.28 - 40;

/**
 * Optional: E2E_FOOTER_FILE runs a single case with a footer exactly as a
 * tenant saved it (raw `branding.quote_footer`), read from a local file kept
 * outside git. The expected printed lines come from the server's own parser
 * and renderer, so the check does not depend on any tenant-specific format.
 */
async function savedFooterCase(file: string): Promise<FooterCase> {
  const raw = await readFile(file, "utf8");
  const footer = quoteFooterFromBranding({ quote_footer: raw });
  assert.ok(footer, "E2E_FOOTER_FILE: the saved footer is empty or not accepted by Settings");
  const lines = (await quoteFooterLines(footer)).map((runs) => runs.map((run) => run.text).join("").trim());
  return { name: "configuracion-guardada", footer: raw, lines };
}

/** Footer lines, top to bottom: from the bottom margin up, one line height apart (the body sits ≥ 18 pt higher). */
function footerBand(lines: DrawnLine[]) {
  const band: DrawnLine[] = [];
  for (const line of lines.filter((drawn) => !PAGE_LABEL.test(drawn.text)).sort((a, b) => a.y - b.y)) {
    if (band.length ? line.y - band[band.length - 1].y < 12 : line.y < 50) band.push(line);
    else break;
  }
  return band.reverse();
}

async function main() {
  const target = resolveStagingTarget();
  requireSyntheticEmail(process.env.E2E_USER_EMAIL);
  assert.ok(process.env.E2E_USER_PASSWORD, "E2E_USER_PASSWORD is required");
  const run = runId();
  const dir = path.join(process.env.E2E_ARTIFACTS_DIR ?? "e2e-artifacts", "quote-footer-" + run);
  const redactor = new Redactor([process.env.E2E_USER_PASSWORD, process.env.VERCEL_AUTOMATION_BYPASS_SECRET]);
  const h = new Harness(target, redactor, dir, process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const result: any = { run, baseUrl: target.baseUrl, deploymentSha: process.env.E2E_DEPLOYMENT_SHA ?? null, cases: [], checks: {} };
  let oldFooter: string | null = null, footerChanged = false;
  let p: any;
  async function call(url: string, method = "GET", data?: unknown) {
    assert.ok(url.startsWith("/api/"));
    const r = await p.request.fetch(target.baseUrl + url, { method, data, timeout: 60000, maxRedirects: 0 });
    const text = await r.text(); let body: any; try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 300) }; }
    return { status: r.status(), body, headers: r.headers() };
  }
  try {
    await h.start(process.env.PLAYWRIGHT_MODULE!); p = h.page;
    await h.step("login and tenant gate", async () => {
      await p.goto(target.baseUrl + "/auth/login");
      await p.locator("#email").fill(process.env.E2E_USER_EMAIL!); await p.locator("#password").fill(process.env.E2E_USER_PASSWORD!);
      await Promise.all([p.waitForURL((u: URL) => u.origin === target.baseUrl && !u.pathname.startsWith("/auth/")), p.getByRole("button", { name: "Login", exact: true }).click()]);
      const c = await call("/api/context"); assert.equal(c.status, 200); assert.equal(c.body.tenant.slug, "e2e"); assert.equal(c.body.features.quotes, true);
      result.checks.tenantE2E = true;
    });
    await h.step("remember the e2e footer", async () => {
      const current = await call("/api/settings/organization"); assert.equal(current.status, 200);
      oldFooter = current.body.quote_footer || null;
      result.originalFooterSha256 = createHash("sha256").update(oldFooter ?? "").digest("hex");
      // Kept on disk before any change, so it can be restored by hand if the process dies.
      await writeFile(path.join(dir, "e2e-footer-original.json"), JSON.stringify({ sha256: result.originalFooterSha256, quote_footer: oldFooter }, null, 2));
    });
    const client = await h.step("synthetic client", async () => {
      const r = await call("/api/clients", "POST", { name: "E2E Cliente pie " + run, email: `e2e-footer-${run.toLowerCase()}@example.com` });
      assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.client?.id); return r.body.client.id as string;
    });
    const today = new Date().toISOString().slice(0, 10);
    const validUntil = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    const cases = process.env.E2E_FOOTER_FILE ? [await savedFooterCase(process.env.E2E_FOOTER_FILE)] : CASES;
    for (const c of cases) {
      await h.step(`footer case ${c.name}`, async () => {
        const saved = await call("/api/settings/organization", "PATCH", { quote_footer: c.footer });
        assert.equal(saved.status, 200, JSON.stringify(saved.body)); footerChanged = true;
        const items = Array.from({ length: c.items ?? 2 }, (_, i) => ({ concept: `Partida ${i + 1}`, description: null, quantity: "1", unit: "ud", unit_price: "10", discount_percent: "0", tax_rate: "21" }));
        const created = await call("/api/quotes/create-draft", "POST", { creation_id: randomUUID(), prepare: true, client_id: client, service_id: null, assigned_team_member_id: null,
          header: { title: `E2E Pie ${c.name} ${run}`, description: "<p>Prueba del pie del presupuesto.</p>", terms: "<p>Condiciones de prueba.</p>",
            contact_name: null, contact_email: null, contact_phone: null, billing_name: null, tax_id: null, billing_address: null,
            issue_date: today, valid_until: validUntil, currency: "EUR", prices_include_tax: true }, items });
        assert.equal(created.status, 200, JSON.stringify(created.body));
        const quoteId = created.body.quote_id as string; let version = created.body.version;
        if (version.state !== "prepared") {
          const prepared = await call(`/api/quotes/${quoteId}/prepare`, "POST", { version_id: version.id, expected_row_version: version.row_version });
          assert.equal(prepared.status, 200, JSON.stringify(prepared.body)); version = prepared.body.version ?? version;
        }
        const endpoint = `/api/quotes/${quoteId}/versions/${version.id}/pdf`;
        const generated = await call(endpoint, "POST"); assert.equal(generated.status, 200, JSON.stringify(generated.body));
        const redirect = await call(endpoint); assert.equal(redirect.status, 307);
        const location = redirect.headers.location; assert.equal(classifyRequest(target, location), "allow"); assert.equal(r2BucketFromUrl(location), target.r2Bucket);
        const download = await p.request.get(location, { timeout: 30000 }); assert.equal(download.status(), 200);
        const bytes = Buffer.from(await download.body()); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
        await writeFile(path.join(dir, `${c.name}.pdf`), bytes);
        const detail = await call(`/api/quotes/${quoteId}`); assert.equal(detail.status, 200);
        const reference = detail.body.quote.reference as string;
        const pdf = await PDFDocument.load(bytes);
        const pages = pdf.getPages().map((page) => drawnLines(pdf, page));
        const footers = pages.map((lines) => footerBand(lines).map((line) => line.text.trim()));
        // A footer saved by a real tenant stays in the PDF only: the report keeps line hashes.
        const printed = c.name === "configuracion-guardada"
          ? footers[0].map((line) => createHash("sha256").update(line).digest("hex").slice(0, 16)) : footers[0];
        const report: any = { name: c.name, reference, pages: pages.length, sha256: createHash("sha256").update(bytes).digest("hex"), printedLines: footers[0].length, printed };
        pages.forEach((lines, index) => {
          const texts = lines.map((line) => line.text);
          assert.equal(texts.some((text) => text.includes(`${reference} · EUR`)), false, `${c.name}: no reference · currency line`);
          assert.ok(texts.includes(reference), `${c.name}: header reference on page ${index + 1}`);
          assert.ok(texts.includes(`${index + 1} / ${pages.length}`), `${c.name}: page number ${index + 1}`);
          assert.deepEqual(footers[index], footers[0], `${c.name}: same footer on every page`);
          for (const line of footerBand(lines)) assert.ok(line.right <= RIGHT_EDGE, `${c.name}: ${line.right} inside the right margin`);
        });
        if (c.lines) assert.deepEqual(footers[0], c.lines, `${c.name}: printed as configured`);
        else {
          // Long lines: every character once, in order, and wrapped only where needed.
          const typed = (c.footer ?? "").replace(/<[^>]+>/g, "").replace(/\s/g, "");
          assert.equal(footers[0].join("").replace(/\s/g, ""), typed, `${c.name}: nothing cut or added`);
          assert.ok(footers[0].length > 2, `${c.name}: long lines wrap`);
        }
        if (c.items) assert.ok(pages.length > 1, `${c.name}: several pages`);
        result.cases.push(report);
      }, 180000);
    }
    h.assertNoProductionEgress();
    result.checks.noProductionEgress = true; result.status = "passed";
  } catch (e) { result.status = "failed"; result.error = redactor.text(e instanceof Error ? e.message : String(e)); console.error(result.error); }
  finally {
    if (footerChanged) {
      try {
        const r = await call("/api/settings/organization", "PATCH", { quote_footer: oldFooter }); assert.equal(r.status, 200);
        const check = await call("/api/settings/organization");
        result.restoredFooterSha256 = createHash("sha256").update(check.body.quote_footer || "").digest("hex");
        assert.equal(result.restoredFooterSha256, result.originalFooterSha256);
        result.checks.footerRestored = true;
      } catch (e) { result.status = "failed"; result.footerRestoreError = redactor.text(String(e)); }
    }
    await h.finish(result); console.log(JSON.stringify(result, null, 2)); console.log("Artifacts: " + dir);
  }
  process.exitCode = result.status === "passed" ? 0 : 1;
}
void main();
