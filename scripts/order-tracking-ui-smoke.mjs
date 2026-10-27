/** Visual tracking: real OrderWorkspace, local HTTP doubles, no credentials.
 * PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/order-tracking-ui-smoke.mjs
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
const out = await mkdtemp(path.join(tmpdir(), "order-tracking-ui-"));
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
const statuses = [
  { id: "received", code: "received", name: "Recibido", is_initial: true },
  { id: "design", code: "design", name: "Diseño final aprobado" },
  { id: "production", code: "production", name: "En producción" },
  { id: "ready", code: "ready", name: "Terminado", is_ready: true },
  { id: "delivered", code: "delivered", name: "Entregado", is_closed: true },
  { id: "cancelled", code: "cancelled", name: "Cancelado", is_cancelled: true },
].map((s, i) => ({ ...s, active: true, sort_order: i * 10 }));
const audit = (previous, next, created_at = "2026-10-26T10:00:00Z") => ({
  id: `${previous}-${next}-${created_at}`, entity_type: "order", entity_id: "order-1", action: previous ? "order.status_changed" : "order.created",
  previous_values: previous ? { status_id: previous, status_name: statuses.find(s => s.id === previous)?.name } : null,
  new_values: { status_id: next, status_name: statuses.find(s => s.id === next)?.name }, created_at, metadata: {}, actor: null,
});
async function setup(width, theme, mode) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: "Europe/Madrid" });
  page.setDefaultTimeout(10000);
  const errors = [], writes = [];
  let failed = mode === "error";
  let history = mode === "legacy" || mode === "error" ? [] : [audit(null, "received", "2026-10-25T09:00:00Z"), audit("received", "production")];
  const statusId = mode === "cancelled" ? "cancelled" : "production";
  if (mode === "cancelled") history = [audit("received", "cancelled")];
  const catalogue = mode === "long-name" ? statuses.map(s => ({ ...s, name: `${s.name} · ${"ConfiguraciónDelTenant".repeat(10)}` })) : statuses;
  let order = { id: "order-1", reference: "DEMO-001", title: "Pedido de prueba local", description: null, priority: "normal", due_at: null,
    received_at: "2026-10-25T09:00:00Z", ready_at: null, delivered_at: null, archived_at: mode === "archived" ? "2026-10-27T10:00:00Z" : null, version: "1",
    customer_notification_status: "not_notified", notes: null, external_folder_url: null, client_id: null, client: null,
    status_id: statusId, status: catalogue.find(s => s.id === statusId), service_id: null, service: null, entry_channel: null, entry_channel_id: null,
    assigned_team_member: null, assigned_team_member_id: null, order_context: null, order_context_id: null, store: null, store_id: null,
    file_status: null, file_status_id: null, quote_status: null, quote_status_id: null, payment_status: null, payment_status_id: null, delivery_method: null, delivery_method_id: null };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const req = route.request(), parsed = new URL(req.url());
    assert.equal(parsed.origin, url, "Every request remains local");
    const pathname = parsed.pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const json = (result, status = 200) => route.fulfill({ status, json: result });
    if (req.method() !== "GET") writes.push({ pathname, body: req.postDataJSON() });
    if (pathname === "/api/context") return json({ tenant: { id: "tenant-demo", slug: "demo", name: "Demo local" }, membership: { role: mode === "staff" ? "staff" : "viewer" }, user: { id: "user-demo", full_name: "Persona de prueba" }, features: { quotes: false } });
    if (pathname === "/api/order-statuses") return mode === "catalogue-error" ? json({ error: "Unavailable" }, 500) : json({ statuses: catalogue });
    if (pathname === "/api/orders/options") return json({ services: [], stores: [], entry_channels: [], order_contexts: [], team_members: [] });
    if (pathname === "/api/orders/management-options") return json({ file_statuses: [], quote_statuses: [], payment_statuses: [], delivery_methods: [] });
    if (pathname.endsWith("/activity")) return failed ? json({ error: "Unavailable" }, 500) : json({ order: { id: order.id }, activity: history });
    if (pathname.endsWith("/files")) return json({ files: [], max_file_bytes: 1048576 });
    if (pathname.endsWith("/payments")) return json({ total_amount: null, paid_amount: "0.00", pending_amount: null, collection_state: "undefined", row_version: order.version, payments: [] });
    if (pathname === "/api/orders/order-1" && req.method() === "GET") return json({ tenant: "demo", order });
    if (pathname === "/api/orders/order-1" && req.method() === "PATCH") {
      const body = req.postDataJSON();
      assert.equal(body.expected_version, order.version);
      history.push(audit(order.status_id, body.status_id, "2026-10-27T11:00:00Z"));
      order = { ...order, status_id: body.status_id, status: catalogue.find(s => s.id === body.status_id), version: "2" };
      return json({ version: order.version, status: order.status, order });
    }
    throw new Error(`Unexpected request: ${req.method()} ${pathname}`);
  });
  await page.goto(url);
  await page.evaluate(theme => document.documentElement.classList.toggle("dark", theme === "dark"), theme);
  const timeline = page.locator("section").filter({ has: page.getByRole("heading", { name: "Seguimiento del pedido", exact: true }) });
  await timeline.getByText(["error", "catalogue-error"].includes(mode) ? /No se pudo cargar el recorrido completo/ : /Las fechas corresponden/).waitFor();
  return { page, timeline, errors, writes, recover: () => { failed = false; history = [audit("received", "production")]; } };
}
try {
  for (const width of [390, 768, 1280]) {
    for (const theme of ["light", "dark"]) {
      for (const mode of ["viewer", "legacy", "cancelled", "archived", "long-name", "error", "catalogue-error"]) {
        const h = await setup(width, theme, mode), { page, timeline } = h;
        const current = timeline.locator('[aria-current="step"]');
        assert.equal(await current.count(), 1, "One current step, independent of colour");
        assert.equal(await timeline.getByRole("list", { name: "Recorrido del pedido" }).count(), 1);
        assert.equal(await timeline.getByRole("button").count(), 0, "Informational timeline has no inert controls");
        if (mode === "legacy") {
          assert.equal(await timeline.getByText("Completado · paso registrado", { exact: true }).count(), 0);
          assert.equal(await timeline.locator("time").count(), 0);
          await timeline.getByText("Fecha de entrada no registrada").waitFor();
        } else if (mode === "cancelled") {
          assert.match(await current.innerText(), /Cancelado/);
          assert.equal(await timeline.getByText("Sin paso registrado", { exact: true }).count(), 4);
        } else if (mode === "catalogue-error") {
          assert.equal(await timeline.getByRole("listitem").count(), 1);
          assert.equal(await timeline.locator("time").count(), 0);
        } else if (mode === "error") {
          assert.equal(await timeline.getByRole("listitem").count(), 1);
          h.recover();
          await page.evaluate(() => { dispatchEvent(new Event("blur")); dispatchEvent(new Event("focus")); });
          await timeline.getByText(/Las fechas corresponden/).waitFor();
          assert.equal(await timeline.getByText("Completado · paso registrado", { exact: true }).count(), 1);
        } else {
          assert.equal(await timeline.getByText("Completado · paso registrado", { exact: true }).count(), 1);
          assert.equal(await timeline.getByText("Sin paso registrado", { exact: true }).count(), 1);
          assert.equal(await timeline.getByText("Pendiente", { exact: true }).count(), 2);
          assert.equal(await timeline.locator("time").count(), 2);
          if (mode === "archived") await timeline.getByText("Pedido archivado · seguimiento en consulta.").waitFor();
        }
        const overflow = await timeline.evaluate(el => el.scrollWidth > el.clientWidth || el.getBoundingClientRect().right > innerWidth);
        assert.equal(overflow, false, `${width}/${theme}/${mode}: timeline fits viewport`);
        assert.equal(h.writes.length, 0, "Reading timeline does not write data");
        assert.deepEqual(h.errors, []);
        if (mode === "viewer" && width !== 768) await timeline.screenshot({ path: path.join(out, `tracking-${width}-${theme}.png`) });
        results.push({ width, theme, mode, pass: true });
        await page.close();
      }
    }
  }
  // Existing keyboard status action updates the saved timeline, with no new API.
  const h = await setup(390, "light", "staff");
  await h.page.getByRole("button", { name: "Cambiar estado", exact: true }).focus();
  await h.page.keyboard.press("Enter");
  await h.page.getByRole("dialog").getByRole("combobox").selectOption("ready");
  await h.page.getByRole("button", { name: "Guardar estado", exact: true }).focus();
  await h.page.keyboard.press("Enter");
  await h.timeline.locator('[aria-current="step"]').getByText("Terminado", { exact: true }).waitFor();
  await h.timeline.getByText("Última entrada registrada: 27/10/2026, 12:00").waitFor();
  const delivery = h.timeline.getByRole("listitem").filter({ hasText: "Entregado" });
  assert.match(await delivery.innerText(), /Pendiente/);
  assert.equal(h.writes.length, 1, "Only the existing status mutation writes");
  assert.equal(h.writes[0].pathname, "/api/orders/order-1");
  assert.deepEqual(h.errors, []);
  await h.page.reload();
  await h.page.getByRole("heading", { name: "Seguimiento del pedido" }).waitFor();
  await h.page.locator('[aria-current="step"]').getByText("Terminado", { exact: true }).waitFor();
  results.push({ width: 390, theme: "light", mode: "keyboard-status-save-and-reload", pass: true });
  await h.page.close();
  await writeFile(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ out, scenarios: results.length, results }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
