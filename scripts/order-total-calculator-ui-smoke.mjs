/** Order line-item calculator: real OrderCollection + OrderTotalDialog, HTTP doubles, no credentials.
 * PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/order-total-calculator-ui-smoke.mjs
 * KEEP=1 keeps the local server running (prints its URL) for manual checks.
 * Every browser request stays on localhost; no production, Supabase or R2 access.
 * The doubles compute amounts with lib/orders/line-amounts (parity-tested against
 * quote_line_amounts_v1) and mimic replace_order_items_v1 / set_order_manual_total_v1.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const root = process.cwd();
const out = await mkdtemp(path.join(tmpdir(), "order-total-ui-"));
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {OrderCollection} from './components/orders/detail/order-collection';
    function App() { const [n, setN] = React.useState(0);
      return <main className="mx-auto max-w-3xl p-4"><p data-testid="changed">{n}</p>
        <OrderCollection orderId="order-1" canWrite archived={false} onChanged={() => setN((x) => x + 1)} /></main>; }
    createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: root, loader: "tsx" },
  jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), bundle: true,
  outfile: path.join(out, "app.js"), platform: "browser",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
});
await build({
  entryPoints: [path.join(root, "lib/orders/line-amounts.ts")], bundle: true, format: "esm", platform: "node",
  outfile: path.join(out, "engine.mjs"),
});
const { summarizeLines } = await import(path.join(out, "engine.mjs"));
execFileSync(process.execPath, ["node_modules/tailwindcss/lib/cli.js", "-i", "app/globals.css", "-o", path.join(out, "style.css")], { cwd: root, stdio: "pipe" });

// ------------------------------------------------------------------ doubles
const db = {
  version: 7, total: "50.00", paid: "20.00", mode: "manual", inclusive: false, items: [],
  totals: { subtotal: "0.00", tax: "0.00", total: "0.00" },
};
const requests = [];
const cents = (v) => (v == null ? null : BigInt(v.replace(".", "")));
const money = (c) => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
function collection() {
  const total = db.total;
  return {
    ok: true, total_amount: total, paid_amount: db.paid,
    pending_amount: total == null ? null : money(cents(total) - cents(db.paid)),
    collection_state: total == null ? "undefined" : cents(db.paid) >= cents(total) ? "paid" : cents(db.paid) > 0n ? "partial" : "unpaid",
    row_version: String(db.version),
    payments: [{ id: "p1", amount: db.paid, paid_at: "2026-11-04T10:00:00Z", created_at: "2026-11-04T10:00:00Z", created_by: null, voided_at: null, void_reason: null, payment_method: "cash", receipt: null }],
  };
}
function itemsState() {
  return {
    total_mode: db.mode, prices_include_tax: db.inclusive, items_subtotal: db.totals.subtotal,
    items_tax_total: db.totals.tax, items_total: db.totals.total, row_version: String(db.version),
    items: db.items.map((item, i) => ({ id: `i${i + 1}`, position: i + 1, ...item })),
  };
}
async function body(req) {
  let text = "";
  for await (const chunk of req) text += chunk;
  return text ? JSON.parse(text) : null;
}
function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
async function api(req, res, pathname) {
  if (pathname === "/api/context") return send(res, 200, { user: { id: "u1" }, tenant: { id: "t1" } });
  if (pathname === "/api/orders/order-1/payments" && req.method === "GET") return send(res, 200, collection());
  if (pathname === "/api/orders/order-1/items" && req.method === "GET") return send(res, 200, itemsState());
  if (pathname === "/api/orders/order-1/items" && req.method === "PUT") {
    const payload = await body(req);
    requests.push({ method: "PUT", payload });
    if (payload.expected_version !== String(db.version)) return send(res, 409, { code: "conflict", error: "El pedido cambió." });
    const summary = summarizeLines(payload.items, payload.prices_include_tax);
    if (cents(summary.total) < cents(db.paid)) return send(res, 422, { error: "El total no puede quedar por debajo de lo ya entregado a cuenta." });
    db.items = payload.items.map((item, i) => ({ ...item, ...summary.lines[i] }));
    db.inclusive = payload.prices_include_tax;
    db.mode = "items";
    db.totals = { subtotal: summary.subtotal, tax: summary.tax_total, total: summary.total };
    db.total = summary.total;
    db.version += 1;
    return send(res, 200, { items: itemsState(), collection: collection() });
  }
  if (pathname === "/api/orders/order-1/total" && req.method === "PATCH") {
    const payload = await body(req);
    requests.push({ method: "PATCH", payload });
    if (payload.expected_version !== String(db.version)) return send(res, 409, { code: "conflict", error: "El pedido cambió." });
    if (db.mode === "items" && payload.leave_items !== true) return send(res, 409, { error: "El total de este pedido sale de sus partidas." });
    if (cents(payload.total_amount) < cents(db.paid)) return send(res, 422, { error: "El total no puede quedar por debajo de lo ya entregado." });
    db.mode = "manual";
    db.total = payload.total_amount;
    db.version += 1;
    return send(res, 200, collection());
  }
  return send(res, 404, { error: "not found" });
}
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname.startsWith("/api/")) return api(req, res, pathname);
  if (["/app.js", "/style.css"].includes(pathname)) {
    res.setHeader("Content-Type", pathname.endsWith("js") ? "text/javascript" : "text/css");
    return res.end(await readFile(path.join(out, pathname.slice(1))));
  }
  res.setHeader("Content-Type", "text/html");
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise((resolve) => server.listen(Number(process.env.PORT || 0), "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
if (process.env.KEEP) {
  console.log(`order total calculator smoke server: ${url}`);
} else {
  await run();
}

async function run() {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
  const browser = await chromium.launch({ headless: true });
  let assertions = 0;
  const check = (actual, expected, message) => { assert.deepEqual(actual, expected, message); assertions++; };
  try {
    for (const width of [1280, 390]) {
      Object.assign(db, { version: 7, total: "50.00", paid: "20.00", mode: "manual", inclusive: false, items: [], totals: { subtotal: "0.00", tax: "0.00", total: "0.00" } });
      requests.length = 0;
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      page.setDefaultTimeout(10000);
      const dialog = page.getByRole("dialog");
      const preview = dialog.getByTestId("order-total-preview");
      await page.goto(url);
      await page.getByRole("button", { name: "Modificar total" }).click();

      // Manual order: opens on «Importe directo»; concepts start empty, VAT included by default.
      check(await dialog.getByRole("tab", { name: "Importe directo" }).getAttribute("aria-selected"), "true", "opens on direct amount");
      await dialog.getByRole("tab", { name: "Por conceptos" }).click();
      check(await dialog.getByLabel("Precios con IVA incluido").isChecked(), true, "VAT included by default");
      check(await dialog.getByTestId("order-total-row").count(), 1, "one empty row");
      check(await dialog.getByLabel("IVA de la partida 1").inputValue(), "21", "21 % by default");
      check(await dialog.getByText("Ya entregado a cuenta: 20,00 €").count(), 1, "paid amount shown");

      await dialog.getByLabel("Concepto de la partida 1").fill("Copias A4");
      await dialog.getByLabel("Cantidad de la partida 1").fill("100");
      await dialog.getByLabel("Precio unitario de la partida 1").fill("0,10");
      check(await dialog.getByLabel("Importe de la partida 1").textContent(), "10,00 €", "line amount");
      check(await preview.textContent(), "10,00 €", "VAT included: total is the sum of prices");
      check(await dialog.getByText("El total quedaría por debajo de lo ya entregado a cuenta.").count(), 1, "below paid warning");
      check(await dialog.getByRole("button", { name: "Guardar partidas" }).isDisabled(), true, "cannot save below paid");

      await dialog.getByRole("button", { name: "Añadir partida" }).click();
      await dialog.getByLabel("Concepto de la partida 2").fill("Encuadernación");
      await dialog.getByLabel("Cantidad de la partida 2").fill("2");
      await dialog.getByLabel("Precio unitario de la partida 2").fill("5,50");
      await dialog.getByLabel("IVA de la partida 2").selectOption("10");
      check(await preview.textContent(), "21,00 €", "mixed rates, VAT included");
      check(await dialog.getByText("Base 10 % · IVA").count(), 1, "breakdown per rate");
      await dialog.getByRole("button", { name: "Guardar partidas" }).click();
      await dialog.waitFor({ state: "detached" });
      check(requests.at(-1), { method: "PUT", payload: { expected_version: "7", prices_include_tax: true, items: [
        { concept: "Copias A4", description: null, quantity: "100", unit: null, unit_price: "0.10", discount_percent: "0", tax_rate: "21" },
        { concept: "Encuadernación", description: null, quantity: "2", unit: null, unit_price: "5.50", discount_percent: "0", tax_rate: "10" },
      ] } }, "PUT payload");
      check(await page.getByText("21,00 €").first().isVisible(), true, "order total updated");
      check(await page.getByText("1,00 €").first().isVisible(), true, "pending = total − paid");
      check(db.paid, "20.00", "payments untouched");

      // Reopen: lines are loaded; VAT added; one rate for all; duplicate and delete.
      await page.getByRole("button", { name: "Modificar total" }).click();
      check(await dialog.getByRole("tab", { name: "Por conceptos" }).getAttribute("aria-selected"), "true", "items mode reopens on concepts");
      check(await dialog.getByTestId("order-total-row").count(), 2, "saved lines loaded");
      check(await dialog.getByLabel("Precio unitario de la partida 1").inputValue(), "0,10", "price shown with comma");
      await dialog.getByLabel("Precios con IVA incluido").uncheck();
      check(await preview.textContent(), "24,20 €", "VAT added on top");
      await dialog.getByLabel("IVA para todas").selectOption("4");
      await dialog.getByRole("button", { name: "Aplicar" }).click();
      check(await dialog.getByLabel("IVA de la partida 2").inputValue(), "4", "rate applied to all");
      check(await preview.textContent(), "21,84 €", "4 % on 21,00");
      await dialog.getByRole("button", { name: "Duplicar la partida 1" }).click();
      check(await dialog.getByTestId("order-total-row").count(), 3, "duplicated");
      check(await dialog.getByLabel("Concepto de la partida 2").inputValue(), "Copias A4", "copy right after the source");
      await dialog.getByRole("button", { name: "Eliminar la partida 2" }).click();
      check(await dialog.getByTestId("order-total-row").count(), 2, "deleted");

      // Conflict: someone else changed the order; edits stay, version refreshes, retry works.
      db.version += 1;
      await dialog.getByRole("button", { name: "Guardar partidas" }).click();
      await dialog.getByText(/Hemos actualizado los importes y conservado tus datos/).waitFor();
      check(await dialog.getByText(/Hemos actualizado los importes y conservado tus datos/).count(), 1, "conflict message");
      check(await preview.textContent(), "21,84 €", "edits kept after conflict");
      await dialog.getByRole("button", { name: "Guardar partidas" }).click();
      await dialog.waitFor({ state: "detached" });
      check(requests.at(-1).payload.expected_version, "9", "retry uses the refreshed version");
      check(db.total, "21.84", "saved after retry");

      // Direct amount from items mode: one atomic call with leave_items.
      await page.getByRole("button", { name: "Modificar total" }).click();
      await dialog.getByRole("tab", { name: "Importe directo" }).click();
      check(await dialog.getByText(/Ahora el total sale de 2 partidas/).count(), 1, "explains the lines become reference");
      await dialog.getByLabel("Importe").fill("19");
      check(await dialog.getByRole("button", { name: "Guardar total" }).isDisabled(), true, "direct below paid blocked");
      await dialog.getByLabel("Importe").fill("30");
      await dialog.getByRole("button", { name: "Guardar total" }).click();
      await dialog.waitFor({ state: "detached" });
      check(requests.at(-1), { method: "PATCH", payload: { total_amount: "30.00", expected_version: "10", leave_items: true } }, "atomic switch");
      check(db.items.length, 2, "lines kept as reference");

      // Manual with reference lines: opens on direct and says the lines do not drive the total.
      await page.getByRole("button", { name: "Modificar total" }).click();
      check(await dialog.getByRole("tab", { name: "Importe directo" }).getAttribute("aria-selected"), "true", "manual reopens on direct");
      check(await dialog.getByText(/como referencia \(21,84 €\)\. No determinan el total/).count(), 1, "reference notice");
      await dialog.getByRole("tab", { name: "Por conceptos" }).click();
      check(await dialog.getByText(/guardadas como referencia y ahora no determinan el total/).count(), 1, "reference notice in concepts");
      check(await dialog.getByLabel("Precios con IVA incluido").isChecked(), false, "saved VAT treatment kept");
      await dialog.getByRole("tab", { name: "Importe directo" }).click();
      await dialog.getByLabel("Importe").fill("30");
      await dialog.getByRole("button", { name: "Guardar total" }).click();
      await dialog.waitFor({ state: "detached" });
      check(requests.at(-1).payload.leave_items, undefined, "manual order uses the legacy path");

      // No horizontal scroll on the page or in the dialog.
      await page.getByRole("button", { name: "Modificar total" }).click();
      await dialog.getByRole("tab", { name: "Por conceptos" }).click();
      const overflow = await page.evaluate(() => {
        const box = document.querySelector('[role="dialog"]');
        return { page: document.documentElement.scrollWidth > window.innerWidth, dialog: box.scrollWidth > box.clientWidth };
      });
      check(overflow, { page: false, dialog: false }, `no horizontal overflow at ${width}px`);
      await page.screenshot({ path: path.join(out, `calculator-${width}.png`) });
      await page.close();
    }
    console.log(`order total calculator UI smoke: ${assertions} assertions passed; screenshots in ${out}`);
  } finally {
    await browser.close();
    server.close();
  }
}
