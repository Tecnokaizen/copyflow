/** PR #93 regression: real OrderWorkspace/OrderCollection, HTTP doubles, no credentials.
 * PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/order-collection-ui-smoke.mjs
 * Every browser request stays on localhost; no production, Supabase or R2 access.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd();
const out = await mkdtemp(path.join(tmpdir(), "order-collection-ui-"));
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {OrderWorkspace} from './components/orders/detail/order-workspace';
    createRoot(document.getElementById('root')).render(<OrderWorkspace/>);`, resolveDir: root, loader: "tsx" },
  jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), bundle: true,
  outfile: path.join(out, "app.js"), platform: "browser",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "next-browser-boundary", setup(api) {
    api.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "test-next" }));
    api.onLoad({ filter: /.*/, namespace: "test-next" }, ({ path: module }) => ({
      contents: module.endsWith("navigation")
        ? `export const useParams=()=>({id:'order-1'}); export const useSearchParams=()=>new URLSearchParams();
          export const usePathname=()=>'/orders/order-1'; export const useRouter=()=>({push:()=>{},replace:()=>{}});`
        : `import React from 'react'; export default function Link({href,children,prefetch,...props}) {return React.createElement('a',{...props,href},children)}`,
      resolveDir: root,
    }));
  } }],
});
execFileSync(process.execPath, ["node_modules/tailwindcss/lib/cli.js", "-i", "app/globals.css", "-o", path.join(out, "style.css")], { cwd: root, stdio: "pipe" });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (["/app.js", "/app.css", "/style.css"].includes(pathname)) {
    res.setHeader("Content-Type", pathname.endsWith("js") ? "text/javascript" : "text/css");
    res.end(await readFile(path.join(out, pathname.slice(1))));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
let assertions = 0;
let lastPage;
function check(actual, expected, message) { assert.deepEqual(actual, expected, message); assertions++; }
const statuses = [
  { id: "status-1", name: "Recibido", code: "received", is_initial: true, is_ready: false, is_closed: false, is_cancelled: false },
  { id: "status-2", name: "En proceso", code: "processing", is_ready: false, is_closed: false, is_cancelled: false },
];

async function setup(width) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: "Europe/Madrid" });
  lastPage = page;
  page.setDefaultTimeout(10000);
  const events = [];
  const errors = [];
  let collection = { total_amount: "100.00", paid_amount: "20.00", pending_amount: "80.00", collection_state: "partial", row_version: "9007199254740993", payments: [
    { id: "payment-1", amount: "20.00", paid_at: "2026-10-13T10:00:00Z", created_at: "2026-10-13T10:00:00Z", actor_name: "Personal de prueba", voided_at: null, void_reason: null },
  ] };
  let order = { id: "order-1", reference: "DEMO-001", title: "Pedido de prueba local", description: null, priority: "normal", due_at: null,
    received_at: "2026-10-13T09:00:00Z", ready_at: null, delivered_at: null, archived_at: null, version: collection.row_version,
    customer_notification_status: "not_notified", notes: null, external_folder_url: null, client_id: null, client: null,
    status_id: "status-1", status: statuses[0], service_id: null, service: null, entry_channel: null, entry_channel_id: null,
    assigned_team_member: null, assigned_team_member_id: null, order_context: null, order_context_id: null, store: null, store_id: null,
    file_status: null, file_status_id: null, quote_status: null, quote_status_id: null, payment_status: null, payment_status_id: null, delivery_method: null, delivery_method_id: null };
  let failWrite = null;
  let failRead = false;
  let paymentIndex = 1;
  const bump = () => { collection = { ...collection, row_version: String(BigInt(collection.row_version) + 1n) }; order.version = collection.row_version; };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const req = route.request();
    const parsed = new URL(req.url());
    check(parsed.origin, url, "Browser never leaves the local harness");
    const pathname = parsed.pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const method = req.method();
    const body = req.postDataJSON();
    events.push({ pathname, method, body });
    const json = (result, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
    if (pathname === "/api/context") return json({ tenant: { id: "tenant-demo", slug: "demo", name: "Demo local" }, membership: { role: "staff" }, user: { id: "user-demo", full_name: "Personal de prueba" }, features: { quotes: true } });
    if (pathname === "/api/order-statuses") return json({ statuses });
    if (pathname === "/api/orders/options") return json({ services: [], stores: [], entry_channels: [], order_contexts: [], team_members: [], max_file_bytes: 1048576 });
    if (pathname === "/api/orders/management-options") return json({ file_statuses: [], quote_statuses: [], payment_statuses: [], delivery_methods: [] });
    if (pathname.endsWith("/activity")) return json({ activity: [] });
    if (pathname.endsWith("/files")) return json({ files: [], max_file_bytes: 1048576 });
    if (pathname === "/api/orders/order-1" && method === "GET") return json({ tenant: "demo", order });
    if (pathname.endsWith("/payments") && method === "GET") return failRead ? json({ error: "Lectura de cobro interrumpida" }, 500) : json(collection);
    if (failWrite) { const fail = failWrite; failWrite = null; return json(fail.body, fail.status); }
    if (pathname === "/api/orders/order-1" && method === "PATCH") {
      check(body.expected_version, order.version, "Status uses current order version");
      bump(); order = { ...order, status_id: body.status_id, status: statuses.find(s => s.id === body.status_id) };
      return json({ version: order.version, status: order.status, order });
    }
    if (pathname.endsWith("/total") && method === "PATCH") {
      if (body.expected_version !== collection.row_version) return json({ code: "conflict", error: "El pedido cambió." }, 409);
      bump(); collection = { ...collection, total_amount: Number(body.total_amount).toFixed(2), pending_amount: (Number(body.total_amount) - Number(collection.paid_amount)).toFixed(2) };
      return json(collection);
    }
    if (pathname.endsWith("/payments") && method === "POST") {
      bump(); collection = { ...collection, paid_amount: (Number(collection.paid_amount) + Number(body.amount)).toFixed(2), pending_amount: (Number(collection.pending_amount) - Number(body.amount)).toFixed(2),
        payments: [...collection.payments, { ...body, id: `payment-${++paymentIndex}`, actor_name: "Personal de prueba", voided_at: null }] };
      return json(collection);
    }
    throw new Error(`Unexpected API request: ${method} ${pathname}`);
  });
  await page.goto(url);
  await page.getByRole("button", { name: "Modificar total", exact: true }).waitFor();
  return { page, events, errors, bump, stored: () => collection, setFail: fail => { failWrite = fail; }, setReadFail: value => { failRead = value; } };
}
const reads = h => h.events.filter(e => e.pathname.endsWith("/payments") && e.method === "GET").length;
const writes = h => h.events.filter(e => e.method !== "GET");
async function openTotal(h) {
  await h.page.getByRole("button", { name: "Modificar total", exact: true }).click();
  await h.page.getByRole("dialog").getByLabel("Importe", { exact: true }).waitFor();
}
async function saveTotal(h, amount) {
  await h.page.getByRole("dialog").getByLabel("Importe", { exact: true }).fill(amount);
  await h.page.getByRole("button", { name: "Guardar total", exact: true }).click();
}

try {
  for (const width of [390, 1280]) {
    const h = await setup(width);
    const { page } = h;
    const documentToken = await page.evaluate(() => window.documentToken = crypto.randomUUID());
    const before = reads(h);
    await page.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    await page.getByRole("dialog").getByRole("combobox").selectOption("status-2");
    await page.getByRole("button", { name: "Guardar estado", exact: true }).click();
    await page.getByText("Estado actualizado", { exact: true }).waitFor();
    check(reads(h), before, "Status leaves the existing collection component mounted and stale");
    await openTotal(h);
    check(reads(h), before + 1, "Opening total refreshes the collection");
    await saveTotal(h, "120");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    const firstTotal = writes(h).find(e => e.pathname.endsWith("/total"));
    check(firstTotal.body.expected_version, "9007199254740994", "Total after status uses the fresh opaque version");
    check(await page.evaluate(() => window.documentToken), documentToken, "No page reload");
    check(h.stored().total_amount, "120.00", "Total is saved after status change");

    // Another session changes the order after the dialog opens: reject, preserve draft,
    // refresh snapshot, and send exactly one new write only on explicit confirmation.
    await openTotal(h);
    h.bump();
    const conflictReads = reads(h);
    const conflictWrites = writes(h).length;
    await saveTotal(h, "130");
    await page.getByRole("dialog").getByRole("alert").filter({ hasText: "Hemos actualizado los importes" }).waitFor();
    check(await page.getByRole("dialog").getByLabel("Importe").inputValue(), "130", "Conflict keeps entered total");
    check(reads(h), conflictReads + 1, "Actual conflict refreshes exactly once");
    check(writes(h).length, conflictWrites + 1, "No automatic monetary retry");
    await page.screenshot({ path: path.join(out, `conflict-${width}.png`), fullPage: true });
    const refreshedVersion = h.stored().row_version;
    await page.getByRole("button", { name: "Guardar total", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    check(writes(h).at(-1).body.expected_version, refreshedVersion, "Explicit retry uses refreshed version");
    check(h.stored().total_amount, "130.00", "Explicit confirmation succeeds");

    // Failed refresh must not claim that data was refreshed.
    await openTotal(h); h.bump(); h.setReadFail(true);
    await saveTotal(h, "140");
    await page.getByRole("dialog").getByRole("alert").filter({ hasText: "No se pudieron actualizar los importes" }).waitFor();
    check(await page.getByRole("dialog").getByLabel("Importe").inputValue(), "140", "Failed refresh keeps draft");
    h.setReadFail(false);
    await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();

    // Business 409s, including uncoded legacy responses, keep the exact server message.
    for (const [operation, code, error] of [
      ["total", "order_archived", "El pedido archivado no admite cambios de cobro."],
      ["void", "already_voided", "Esa entrega ya estaba anulada."],
      ["payment", "idempotency_mismatch", "Esta confirmación ya se usó con otro importe."],
      ["payment", "conflict", "Conflicto ajeno al guardado del total."],
    ]) for (const coded of [false, true]) {
      if (operation === "total") await openTotal(h);
      else if (operation === "void") {
        await page.getByRole("button", { name: "Anular", exact: true }).first().click();
        await page.getByLabel("Motivo", { exact: true }).fill("Corrección de prueba");
      } else {
        await page.getByRole("button", { name: "Registrar entrega a cuenta", exact: true }).click();
        await page.getByRole("dialog").getByLabel("Importe", { exact: true }).fill("10");
        await page.getByRole("dialog").getByLabel("Método de pago").selectOption({ label: "Efectivo" });
      }
      const readCount = reads(h); const writeCount = writes(h).length;
      h.setFail({ status: 409, body: { error, ...(coded ? { code } : {}) } });
      const confirm = operation === "total" ? "Guardar total" : operation === "void" ? "Anular entrega" : "Confirmar entrega";
      await page.getByRole("dialog").getByRole("button", { name: confirm, exact: true }).click();
      await page.getByRole("dialog").getByRole("alert").filter({ hasText: error }).waitFor();
      check(await page.getByRole("dialog").getByRole("alert").innerText(), error, "Business error remains visible inside its dialog");
      check(await page.getByText(error, { exact: true }).count(), 1, "An open dialog shows the error exactly once");
      check(reads(h), readCount, "Business 409 does not refresh as a stale total");
      check(writes(h).length, writeCount + 1, "Business 409 is never retried automatically");
      if (operation === "payment") {
        // PR #95: a non-422 answer keeps the exact attempt locked (same key and data).
        check(await page.getByRole("dialog").getByLabel("Importe", { exact: true }).isDisabled(), true, "Payment 409 locks the attempt");
      }
      await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();
      if (operation === "payment") {
        // Leave the locked attempt (a new tab would not see it) before the next case.
        await page.evaluate(() => Object.keys(sessionStorage).filter(k => k.startsWith("gestcopy.payment-pending")).forEach(k => sessionStorage.removeItem(k)));
      }
    }

    // A failed read before opening total cannot open a form with an old version.
    h.setReadFail(true);
    await page.getByRole("button", { name: "Modificar total", exact: true }).click();
    await page.getByText("Lectura de cobro interrumpida", { exact: true }).waitFor();
    check(await page.getByRole("dialog").count(), 0, "Failed opening refresh leaves total dialog closed");
    h.setReadFail(false);

    // Basic successive payments retain their existing payload/idempotency contract.
    for (const amount of ["10", "15"]) {
      await page.getByRole("button", { name: "Registrar entrega a cuenta", exact: true }).click();
      await page.getByRole("dialog").getByLabel("Importe", { exact: true }).fill(amount);
      await page.getByRole("dialog").getByLabel("Método de pago").selectOption({ label: "Efectivo" });
      await page.getByRole("button", { name: "Confirmar entrega", exact: true }).click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    const payments = writes(h).filter(e => e.pathname.endsWith("/payments")).slice(-2);
    check(Object.keys(payments[0].body).sort(), ["amount", "idempotency_key", "paid_at", "payment_method", "receipt_file_id"], "Payments carry the PR #95 contract");
    check([payments[0].body.payment_method, payments[0].body.receipt_file_id], ["cash", null], "Method chosen, no receipt");
    check(payments[0].body.idempotency_key !== payments[1].body.idempotency_key, true, "Separate payment confirmations have distinct keys");
    check(h.stored().paid_amount, "45.00", "Successive payments accumulate");
    check(h.stored().pending_amount, "85.00", "Pending amount remains correct");
    check(h.stored().payments.length, 3, "No duplicate payments after failures");
    check(h.errors, [], "No browser runtime errors");
    results.push({ width, status: "PASS" });
    await page.close();
  }
  await writeFile(path.join(out, "results.json"), JSON.stringify({ status: "PASS", assertions, results, scope: "Real workspace and collection with localhost HTTP doubles; no production writes" }, null, 2));
  console.log(JSON.stringify({ status: "PASS", assertions, results, output: out }));
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
    console.error(await lastPage.locator("body").innerText());
  }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
