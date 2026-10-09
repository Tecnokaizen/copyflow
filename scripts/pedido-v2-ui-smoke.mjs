/** Browser integration of the real components with deterministic HTTP doubles.
 * Run with Node 22; provide Playwright via PLAYWRIGHT_MODULE or an installation.
 * No Supabase/R2 credentials or production writes. SQL tests cover real RLS.
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
const out = await mkdtemp(path.join(tmpdir(), "pedido-v2-ui-"));
await build({
  stdin: {
    contents: `import React from 'react'; import { createRoot } from 'react-dom/client';
      import { CreateOrderForm } from './components/orders/create-order-form';
      import { QuickOrderLayoutSettings } from './components/settings/quick-order-layout-settings';
      const mode = new URLSearchParams(location.search).get('mode') || 'quick';
      createRoot(document.getElementById('root')).render(mode === 'settings' ? <QuickOrderLayoutSettings/> : <CreateOrderForm mode={mode} onCancel={() => {}}/>);`,
    resolveDir: root, loader: "tsx",
  },
  jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"),
  bundle: true, outfile: path.join(out, "app.js"), platform: "browser",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "next-browser-boundary", setup(api) {
    api.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "test-next" }));
    api.onLoad({ filter: /.*/, namespace: "test-next" }, ({ path: module }) => ({
      contents: module.endsWith("navigation")
        ? "export const useRouter = () => ({push: (url) => { window.lastNavigation = url; }});"
        : "import React from 'react'; export default function Link({href, children, ...props}) { return React.createElement('a', {...props, href}, children); }",
      resolveDir: root,
    }));
  } }],
});
execFileSync(process.execPath, ["node_modules/tailwindcss/lib/cli.js", "-i", "app/globals.css", "-o", path.join(out, "style.css")], { cwd: root, stdio: "pipe" });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/app.js" || pathname === "/style.css") {
    res.setHeader("Content-Type", pathname.endsWith("js") ? "text/javascript" : "text/css");
    res.end(await readFile(path.join(out, pathname.slice(1))));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><main id="root" style="max-width:760px;margin:24px auto;padding:12px"></main><script src="/app.js"></script>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [390, 820, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error(error.message); });
    page.setDefaultTimeout(10000);
    let layout = {
      client: "primary", service: "primary", description: "primary", store: "hidden",
      due_at: "hidden", priority: "hidden", assigned_team_member: "hidden",
      entry_channel: "hidden", title: "more", order_context: "hidden", notes: "hidden",
      file_status: "primary", files: "primary",
    };
    const events = [];
    let body;
    let collection = { total_amount: null, paid_amount: "0.00", pending_amount: null, collection_state: "undefined", row_version: "1", payments: [] };
    const moneyRequests = [];
    let rejectPayment = true;
    let completeCalls = 0;
    const file = { id: "file-1", original_name: "arte.pdf", status: "ready", content_type: "application/pdf", size_bytes: 8, created_at: "2026-09-23T10:00:00Z", completed_at: null };
    await page.route("**/api/**", async (route) => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (pathname === "/api/settings/quick-order-layout") {
        if (req.method() === "PATCH") layout = req.postDataJSON().layout;
        return json({ layout, revision: "2026-09-23T10:00:00Z" });
      }
      if (pathname === "/api/orders/options") return json({
        tenant: "demo", services: [{ id: "service-a", name: "Impresión" }],
        stores: [{ id: "store-a", name: "Tienda centro" }],
        entry_channels: [], order_contexts: [],
        team_members: [{ id: "member-a", name: "Natalia" }], actor_role: "staff",
        file_statuses: [{ id: "state-a", name: "Pendiente", code: "pending" }],
        quick_order_layout: layout, max_file_bytes: 1048576,
      });
      if (pathname === "/api/clients/options") return json({ customer_types: [] });
      if (pathname === "/api/clients") {
        if (req.method() === "POST") return json({ client: { id: "client-a", name: "Cliente inline" } }, 201);
        return json({ clients: [] });
      }
      if (pathname === "/api/orders/saved-order/payments") {
        if (req.method() === "GET") return json(collection);
        const payment = req.postDataJSON(); moneyRequests.push(payment);
        if (rejectPayment) { rejectPayment = false; return json({ error: "No se pudo confirmar el cobro. Reintenta." }, 500); }
        collection = { ...collection, paid_amount: "30.00", pending_amount: "55.00", collection_state: "partial", row_version: "3", payments: [{ id: "payment-1", amount: "30.00", paid_at: payment.paid_at, created_at: payment.paid_at, actor_name: "Personal", voided_at: null }] };
        return json(collection);
      }
      if (pathname === "/api/orders/saved-order/total") {
        const payload = req.postDataJSON(); assert.equal(payload.expected_version, "1"); assert.equal(payload.total_amount, "85");
        collection = { ...collection, total_amount: "85.00", pending_amount: "85.00", collection_state: "unpaid", row_version: "2" };
        return json(collection);
      }
      if (pathname === "/api/orders") {
        events.push("create"); body = req.postDataJSON();
        await new Promise((resolve) => setTimeout(resolve, 100));
        return json({ order: { id: "saved-order", reference: "DEMO-001" } }, 201);
      }
      if (pathname === "/api/orders/saved-order/files") {
        if (req.method() === "POST") {
          events.push("init");
          return json({ file_id: file.id, upload_url: `${url}/api/mock-r2`, required_headers: { "Content-Type": "application/pdf" } }, 201);
        }
        return json({ files: completeCalls >= 2 ? [file] : [], max_file_bytes: 1048576 });
      }
      if (pathname === "/api/mock-r2") { events.push("put"); return route.fulfill({ status: 200, body: "" }); }
      if (pathname.endsWith("/complete")) {
        events.push("complete");
        return ++completeCalls === 1 ? json({ error: "Confirmación interrumpida" }, 500) : json({ ok: true });
      }
      if (pathname.endsWith("/download")) { events.push("download"); return json({ download_url: `${url}/api/download-blob`, filename: file.original_name }); }
      if (pathname === "/api/download-blob") return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.7" });
      throw new Error(`Unexpected request: ${req.method()} ${pathname}`);
    });

    await page.goto(url);
    await page.getByRole("button", { name: "Crear pedido", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Notas internas", { exact: true }).count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "Nombre del pedido" }).count(), 0);
    const title = page.getByRole("textbox", { name: "Título del pedido" });
    const clientSearch = page.getByPlaceholder(/Buscar cliente/);
    await title.waitFor();
    await page.getByPlaceholder("Ej. 200 tarjetas de visita", { exact: true }).waitFor();
    const titleBox = await title.boundingBox();
    const clientBox = await clientSearch.boundingBox();
    assert.ok(titleBox && clientBox && titleBox.y < clientBox.y);
    await title.fill("Pedido con archivos");
    assert.equal(await title.inputValue(), "Pedido con archivos");
    await page.getByLabel("Estado de archivos", { exact: false }).selectOption("state-a");
    await page.getByRole("button", { name: /Crear nuevo cliente/ }).click();
    await page.getByLabel("Nombre *", { exact: true }).fill("Cliente inline");
    await page.getByRole("button", { name: "Crear cliente", exact: true }).click();
    await page.getByText("Cliente inline", { exact: true }).waitFor();
    await page.getByLabel("Seleccionar archivos para el pedido").setInputFiles({ name: "arte.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7") });
    assert.deepEqual(events, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(out, `quick-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Crear pedido", exact: true }).dblclick();
    await page.getByRole("button", { name: "Reintentar archivos pendientes" }).waitFor();
    assert.deepEqual(events, ["create", "init", "put", "complete"]);
    assert.equal(body.file_status_id, "state-a");
    assert.equal(body.client_id, "client-a");
    assert.equal(body.title, "Pedido con archivos");
    await page.getByRole("button", { name: "Reintentar archivos pendientes" }).click();
    const download = width < 640 ? page.getByRole("menuitem", { name: "Descargar", exact: true }) : page.getByRole("button", { name: /Descargar/ }).first();
    if (width < 640) await page.getByRole("button", { name: "Acciones de arte.pdf" }).click();
    await download.waitFor();
    assert.deepEqual(events, ["create", "init", "put", "complete", "complete"]);
    const [downloaded] = await Promise.all([page.waitForEvent("download"), download.click()]);
    assert.equal(downloaded.suggestedFilename(), "arte.pdf");
    assert.ok(events.includes("download"));
    await page.getByRole("link", { name: "Abrir pedido", exact: true }).waitFor();
    await page.getByRole("button", { name: "Definir total", exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Crear otro' && button.disabled));
    assert.equal(await page.getByRole("button", { name: "Crear otro", exact: true }).isEnabled(), false);
    await page.getByRole("dialog").getByLabel("Importe", { exact: true }).fill("85");
    await page.getByRole("button", { name: "Guardar total", exact: true }).click();
    await page.getByRole("button", { name: "Modificar total", exact: true }).waitFor();
    assert.equal(await page.getByText("85,00 €", { exact: true }).count(), 2);
    await page.getByRole("button", { name: "Registrar entrega a cuenta", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Importe", { exact: true }).fill("30");
    await page.getByRole("button", { name: "Confirmar entrega", exact: true }).click();
    await page.getByText("No se pudo confirmar el cobro. Reintenta.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Confirmar entrega", exact: true }).click();
    await page.getByText("55,00 €", { exact: true }).waitFor();
    assert.equal(moneyRequests.length, 2);
    assert.equal(moneyRequests[0].idempotency_key, moneyRequests[1].idempotency_key);
    assert.equal(events.filter(event => event === "create").length, 1);
    assert.equal(await page.getByRole("button", { name: "Crear otro", exact: true }).isEnabled(), true);
    await page.screenshot({ path: path.join(out, `saved-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Crear otro", exact: true }).click();
    assert.equal(await page.getByText("arte.pdf", { exact: true }).count(), 0);
    const resetTitle = page.getByRole("textbox", { name: /Si lo dejas vacío se usará «Pedido»/ });
    await resetTitle.waitFor();
    assert.equal(await resetTitle.inputValue(), "");
    await page.getByRole("button", { name: "Crear pedido", exact: true }).click();
    await page.getByRole("heading", { name: "Pedido creado", exact: true }).waitFor();
    assert.equal(body.title, "Pedido");
    await page.getByRole("link", { name: "Abrir pedido", exact: true }).waitFor();

    await page.goto(`${url}/?mode=settings`);
    await page.getByLabel("Notas internas", { exact: true }).selectOption("primary");
    await page.getByLabel("Cliente", { exact: true }).selectOption("hidden");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await page.getByText("Configuración guardada", { exact: true }).waitFor();
    assert.equal(layout.notes, "primary"); assert.equal(layout.client, "hidden");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(out, `settings-${width}.png`), fullPage: true });
    await page.goto(url);
    await page.getByLabel("Notas internas", { exact: true }).waitFor();
    assert.equal(await page.getByPlaceholder(/Buscar cliente/).count(), 0);
    await page.getByRole("textbox", { name: "Título del pedido" }).waitFor();
    await page.goto(`${url}/?mode=full`);
    const fullTitle = page.getByRole("textbox", { name: "Título del pedido" });
    const fullClient = page.getByPlaceholder(/Buscar cliente/);
    await fullTitle.waitFor();
    await fullClient.waitFor();
    const fullTitleBox = await fullTitle.boundingBox();
    const fullClientBox = await fullClient.boundingBox();
    assert.ok(fullTitleBox && fullClientBox && fullTitleBox.y < fullClientBox.y);
    await fullTitle.fill("Carteles feria");
    assert.equal(await fullTitle.inputValue(), "Carteles feria");
    await page.getByText("Más opciones", { exact: true }).click();
    assert.equal(await page.getByLabel("Notas internas", { exact: true }).isVisible(), true);
    assert.equal(await fullTitle.isVisible(), true);
    await page.getByRole("button", { name: "Crear pedido", exact: true }).click();
    await page.getByRole("heading", { name: "Pedido creado", exact: true }).waitFor();
    assert.equal(body.title, "Carteles feria");
    await page.getByRole("link", { name: "Abrir pedido", exact: true }).waitFor();
    // Croquis: three compact columns on desktop; stacked fields on mobile.
    layout = {
      ...layout, client: "primary", store: "primary", due_at: "primary",
      assigned_team_member: "primary", priority: "primary",
      description: "primary", service: "primary",
    };
    await page.goto(url);
    const identification = page.getByTestId("quick-primary-identification");
    const assignment = page.getByTestId("quick-primary-assignment");
    const description = page.getByTestId("quick-primary-description");
    await description.waitFor();
    assert.equal(await identification.locator(":scope > div").count(), 3);
    assert.equal(await assignment.locator(":scope > div").count(), 3);
    assert.equal(await page.getByLabel("Prioridad", { exact: true }).count(), 1);
    const countColumns = (testId) => page.getByTestId(testId).evaluate((element) =>
      getComputedStyle(element).gridTemplateColumns.split(" ").filter(Boolean).length);
    assert.equal(await countColumns("quick-primary-identification"), width >= 1280 ? 3 : width >= 768 ? 2 : 1);
    assert.equal(await countColumns("quick-primary-assignment"), width >= 1280 ? 3 : width >= 768 ? 2 : 1);
    const firstRow = await identification.boundingBox();
    const secondRow = await assignment.boundingBox();
    const descriptionRow = await description.boundingBox();
    assert.ok(firstRow && secondRow && descriptionRow && firstRow.y < secondRow.y && secondRow.y < descriptionRow.y);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(out, `croquis-${width}.png`), fullPage: true });
    assert.deepEqual(errors, []);
    results.push({ width, passed: true, checks: "croquis columns desktop/mobile, primary tenant settings, title before client, custom title, empty fallback, inline client, save-before-upload, double submit, COMPLETE retry, canonical 85/30/55 collection, idempotent retry, no second order, collection dialog blocks reset, ficha link, reset, Settings, full form notes, overflow" });
    await page.close();
  }
  await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ results, artifacts: out }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
