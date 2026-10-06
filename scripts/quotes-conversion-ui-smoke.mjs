/** Real quote components and CSS, with deterministic HTTP doubles. No production access.
 * Node 22. Reuses the existing browser integration approach; no added dependencies.
 * PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/quotes-draft-ui-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), "quotes-draft-browser-"));
const out = process.env.SMOKE_OUTPUT_DIR || temp;
await mkdir(out, { recursive: true });
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ThemeProvider} from 'next-themes';
    import {QuoteCommercialEditor} from './components/quotes/quote-commercial-editor';
    import {QuotesList} from './components/quotes/quotes-list';
    import {OrderSourceQuote} from './components/orders/detail/order-source-quote';
    const params = new URLSearchParams(location.search);
    createRoot(document.getElementById('root')).render(<ThemeProvider attribute="class" forcedTheme={params.get('theme') || 'light'}>
      {params.get('mode') === 'source' ? <OrderSourceQuote quote={{id:'quote-1',reference:'P-0001',total:'121.00',currency:'EUR',status:'accepted',version_number:2}}/> : params.get('mode') === 'list' ? <QuotesList/> : <QuoteCommercialEditor quoteId="quote-1"/>}</ThemeProvider>);`, resolveDir: root, loader: "tsx" },
  jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), bundle: true,
  outfile: path.join(temp, "app.js"), platform: "browser",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "next-browser-boundary", setup(api) {
    api.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "test-next" }));
    api.onLoad({ filter: /.*/, namespace: "test-next" }, ({ path: module }) => ({ contents: module.endsWith("navigation")
      ? `import {useSyncExternalStore} from 'react';
        const subscribe = cb => {window.addEventListener('popstate',cb);return ()=>window.removeEventListener('popstate',cb)};
        export const useSearchParams = () => new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));
        export const usePathname = () => '/quotes';
        export const useRouter = () => ({push: url=>{window.lastNavigation=url},replace: url=>{const p=new URL(url,location.origin);history.replaceState(null,'',location.pathname+p.search);window.dispatchEvent(new PopStateEvent('popstate'))}});`
      : `import React from 'react'; export default function Link({href,children,prefetch,...props}) {return React.createElement('a',{...props,href},children)}`,
      resolveDir: root,
    }));
  } }],
});
execFileSync(process.execPath, ["node_modules/tailwindcss/lib/cli.js", "-i", "app/globals.css", "-o", path.join(temp, "style.css")], { cwd: root, stdio: "pipe" });
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (["/app.js", "/app.css", "/style.css"].includes(pathname)) {
    res.setHeader("Content-Type", pathname.endsWith("js") ? "text/javascript" : "text/css");
    res.end(await readFile(path.join(temp, pathname.slice(1))));
  } else {
    res.setHeader("Content-Type", "text/html");
    res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
const url = `http://127.0.0.1:${server.address().port}`;
const results = []; let assertions = 0; let lastPage; let lastEvents;
function check(actual, expected, description) { assert.deepEqual(actual, expected, description); assertions++; }
function fixture(state = "draft", legacy = false) {
  const v = { pdf_file_id: null, id: "version-2", quote_id: "quote-1", version_number: 2, state, title: "Catálogos", description: "<p>Material para evento</p>", terms: "<p>Pago a 30 días</p>", issue_date: "2026-10-05", valid_until: "2026-10-31", currency: "EUR", prices_include_tax: false, subtotal: "100.00", tax_total: "21.00", total: "121.00", row_version: 4, created_at: "2026-10-05T12:00:00Z", locked_at: state === "draft" ? null : "2026-10-05T12:01:00Z", sent_at: state === "sent" ? "2026-10-05T12:02:00Z" : null, tax_breakdown: [] };
  const q = { ...v, id: "quote-1", reference: "P-0001", row_version: 55, title: "Catálogos", status: { id: "status-1", code: "draft", name: "Borrador" }, client: { id: "client-1", name: "Cliente de prueba" }, current_version_id: legacy ? null : v.id, current_version_number: legacy ? null : 2, current_version_state: legacy ? null : state, contact_name: "Raquel", contact_email: "raquel@example.com", contact_phone: "600123456", billing_name: "Cliente de prueba SL", tax_id: "B12345678", billing_address: "Calle Mayor 1", notes: "<p>Pago a 30 días</p>", converted_order_id: null, service: null, assignee: null, converted_order: null };
  const item = { id: "line-1", position: 1, concept: "Impresión", description: "A4", quantity: "1", unit: "ud", unit_price: "100", discount_percent: "0", tax_rate: "21", subtotal: "100.00", tax_amount: "21.00", total: "121.00" };
  return { quote: q, current_version: legacy ? null : v, items: legacy ? [] : [item], versions: legacy ? [] : [v, { ...v, id: "version-1", version_number: 1, state: "sent", pdf_file_id: "pdf-old", locked_at: "2026-10-04T12:01:00Z", sent_at: "2026-10-04T12:02:00Z", total: "80.00" }] };
}
async function setup(width, theme, { state = "draft", legacy = false, mode = "editor", denied = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } }); page.setDefaultTimeout(10000);
  lastPage = page;
  let stored = fixture(state, legacy); let fail = null; let readFail = false; const events = []; const errors = [];
  lastEvents = events;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", async (route) => {
    const req = route.request(); const pathname = new URL(req.url()).pathname; const method = req.method();
    const body = req.postDataJSON(); events.push({ pathname, method, body });
    let result = {}; let status = 200;
    if (pathname === "/api/context") result = { tenant: { id: "tenant-a", slug: "demo", name: "Gestcopy Demo" }, membership: { role: "owner" }, features: { quotes: true } };
    else if (pathname === "/api/quotes/statuses") result = { statuses: [ { id: "status-1", code: "draft", name: "Borrador" }, { id: "status-2", code: "sent", name: "Enviado" } ] };
    else if (pathname === "/api/quotes") result = { quotes: [stored.quote], total: 1, total_pages: 1 };
    else if (pathname === "/api/stores") result = {stores:[{id:"store-1",name:"Tienda de prueba"}]};
    else if (pathname === "/api/services") result = { services: [{ id: "service-1", name: "Impresión digital" }] };
    else if (pathname === "/api/team") result = { members: [{ id: "member-1", name: "Persona de prueba" }] };
    else if (pathname === "/api/clients") result = { clients: [] };
    else if (pathname.endsWith("/activity")) result = { events: [] };
    else if (pathname.endsWith("/files")) result = { files: [] };
    else if (denied) { result = { error: "Acceso no disponible" }; status = denied; }
    else if (pathname === "/api/quotes/quote-1" && method === "GET") {
      if (readFail) { status = 500; result = { error: "Read failed" }; } else result = stored;
    } else if (fail) { status = fail.status; result = { code: fail.code, error: fail.error ?? "Error simulado" }; fail = null; }
    else if (pathname.endsWith('/convert')) {
      check(Object.keys(body).sort(),['assigned_team_member_id','due_at','expected_row_version','priority','service_id','store_id'],'Explicit conversion contract');
      check(body.expected_row_version,stored.quote.row_version,'Conversion concurrency token');
      stored.quote.converted_order_id='order-1';stored.quote.converted_order={id:'order-1',reference:'O-0001'};stored.quote.row_version++;
      result={ok:true,order:stored.quote.converted_order,replayed:false,quote:{converted_order_id:'order-1'}};
    }
    else if (/\/(send|accept|reject)$/.test(pathname)) {
      const action = pathname.split('/').at(-1);
      check(body.version_id, stored.current_version.id, "Transition exact current version");
      check(body.expected_row_version, stored.quote.row_version, "Transition quote concurrency token");
      const code = action === 'send' ? 'sent' : action === 'accept' ? 'accepted' : 'rejected';
      stored.quote.status = { id: `status-${code}`, code, name: {sent:'Enviado',accepted:'Aceptado',rejected:'Rechazado'}[code] };
      stored.quote.row_version++;
      if (action === 'accept') stored.quote.accepted_version_id = stored.current_version.id;
      stored.current_version.state = 'sent'; stored.versions[0] = stored.current_version;
      result = {ok:true,quote:stored.quote,current_version:stored.current_version,replayed:false};
    }
    else if (pathname.endsWith("/pdf") && method === "POST") {
      const file = { id: "pdf-current", size_bytes: 18000, completed_at: "2026-10-05T14:00:00Z" };
      stored.current_version = { ...stored.current_version, pdf_file_id: file.id, pdf_file: file };
      stored.versions[0] = stored.current_version; result = { file, replayed: false };
    }
    else if (pathname.endsWith("/draft") && method === "PUT") {
      check(body.expected_row_version, stored.current_version.row_version, "Version concurrency token");
      check("total" in body.items[0], false, "No client totals in payload");
      stored.current_version = { ...stored.current_version, ...body.header, subtotal: "800.00", tax_total: "187.65", total: "987.65", row_version: stored.current_version.row_version + 1 };
      stored.quote = { ...stored.quote, ...body.header, row_version: stored.quote.row_version + 1, subtotal: "800.00", tax_total: "187.65", total: "987.65" };
      stored.items = body.items.map((item, index) => ({ ...item, id: `saved-${index}`, position: index + 1, subtotal: "800.00", tax_amount: "187.65", total: "987.65" }));
      stored.versions[0] = stored.current_version;
      result = { version: stored.current_version, totals: stored.current_version };
    } else if (pathname.endsWith("/prepare")) {
      check(body.expected_row_version, stored.current_version.row_version, "Prepare uses token after save");
      stored.current_version = { ...stored.current_version, state: "prepared", row_version: stored.current_version.row_version + 1, locked_at: "2026-10-05T13:00:00Z" };
      stored.quote.current_version_state = "prepared"; stored.versions[0] = stored.current_version;
      result = { quote: stored.quote, prepared_version: stored.current_version, totals: stored.current_version };
    } else if (pathname.endsWith("/versions")) {
      if (stored.current_version.state !== "draft") {
        const v = { ...stored.current_version, pdf_file_id: null, pdf_file: null, id: "version-3", version_number: 3, state: "draft", row_version: 0, locked_at: null };
        stored = { ...stored, current_version: v, versions: [v, ...stored.versions], quote: { ...stored.quote, current_version_id: v.id, current_version_number: 3, current_version_state: "draft" } };
      }
      result = { version: stored.current_version, replayed: true, created: false };
    } else if (pathname.endsWith("/draft") && method === "POST") { stored = fixture(); result = { version: stored.current_version, replayed: true }; }
    else if (pathname === "/api/quotes/quote-1" && method === "PATCH") {
      check(Object.keys(body).sort(), ["assigned_team_member_id", "client_id", "expected_row_version", "operational_only", "service_id"], "Operational PATCH never includes document columns");
      stored.quote = { ...stored.quote, service: { id: body.service_id, name: "Impresión digital" }, row_version: stored.quote.row_version + 1 }; result = { quote: stored.quote };
    }
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
  });
  await page.goto(`${url}/?theme=${theme}&mode=${mode}`);
  return { page, events, errors, setFail: (next) => { fail = next; }, setReadFail: (next) => { readFail = next; }, stored: () => stored };
}
try {
  for (const width of [390, 768, 1280]) for (const theme of ["light", "dark"]) {
    const h = await setup(width, theme); const { page, events } = h;
    await page.getByRole("heading", { name: "Cabecera comercial" }).waitFor();
    check(await page.getByLabel("Título / trabajo").inputValue(), "Catálogos", "Loads commercial header");
    check(await page.getByRole("button", { name: "Generar PDF", exact: true }).count(), 0, "Draft has no PDF CTA");
    await page.screenshot({ path: path.join(out, `editor-${width}-${theme}.png`), fullPage: true });
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "No page horizontal overflow");
    await page.getByLabel("Título / trabajo").fill("Trabajo editado");
    await page.getByLabel("Persona de contacto").fill("Contacto editado");
    await page.getByLabel("Nombre fiscal").fill("Nueva razón social");
    await page.getByRole("button", { name: "Añadir línea", exact: true }).click();
    await page.getByLabel("Concepto", { exact: true }).nth(1).fill("Encuadernación");
    await page.getByLabel("Cantidad", { exact: true }).nth(1).fill("2");
    await page.getByRole("button", { name: "Subir partida 2", exact: true }).click();
    check(await page.getByLabel("Concepto", { exact: true }).first().inputValue(), "Encuadernación", "Reorders lines");
    await page.getByRole("button", { name: "Eliminar partida 2", exact: true }).click();
    check(await page.getByTestId("quote-item").count(), 1, "Deletes line");
    await page.getByLabel("Cantidad", { exact: true }).fill("0");
    await page.getByRole("alert").filter({ hasText: "cantidad inválido" }).waitFor();
    check(await page.getByRole("button", { name: "Preparar presupuesto", exact: true }).isDisabled(), true, "Invalid draft cannot prepare");
    await page.getByLabel("Cantidad", { exact: true }).fill("2");
    h.setFail({ status: 400, error: "Validación del servidor" });
    await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Validación del servidor" }).waitFor();
    check(await page.getByLabel("Título / trabajo").inputValue(), "Trabajo editado", "Preserves edits after error");
    h.setFail({ status: 409, code: "stale_row_version" });
    await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: path.join(out, `conflict-${width}-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Cancelar y mantener lo escrito", exact: true }).click();
    check(await page.getByLabel("Título / trabajo").inputValue(), "Trabajo editado", "Cancel conflict preserves input");
    await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Borrador guardado" }).waitFor();
    check(await page.getByTestId("quote-totals").innerText().then(t => t.includes("987,65")), true, "Authoritative server total");
    check(await page.getByText("Cambios sin guardar. Los importes se actualizarán al guardar.", { exact: true }).count(), 0, "Busy transition does not emit a false text edit");
    const saveEvent = events.filter(e => e.method === "PUT").at(-1);
    check(saveEvent.body.header.title, "Trabajo editado", "Sends edited header");
    check(saveEvent.body.header.contact_name, "Contacto editado", "Sends edited contact");
    await page.getByLabel("Título / trabajo").fill("Mantener local");
    h.setFail({ status: 409, code: "stale_row_version" });
    await page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
    await page.getByRole("button", { name: "Recargar versión actual", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Versión actual recargada" }).waitFor();
    check(await page.getByLabel("Título / trabajo").inputValue(), "Trabajo editado", "Reload takes current version");
    await page.getByLabel("Título / trabajo").fill("Preparar mis cambios");
    await page.getByRole("button", { name: "Preparar presupuesto", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    const before = events.filter(e => e.pathname.endsWith("/prepare")).length;
    check(before, 0, "Prepare waits for confirmation");
    await page.getByRole("button", { name: "Preparar y bloquear versión", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Versión preparada y bloqueada" }).waitFor();
    check(await page.getByLabel("Título / trabajo").isDisabled(), true, "Prepared is readonly");
    check(h.stored().quote.status.code, "draft", "Prepared preserves commercial status");
    check(await page.getByText("Borrador", { exact: true }).count() > 0, true, "UI never marks quote sent on prepare");
    check(await page.getByLabel("Título / trabajo").inputValue(), "Preparar mis cambios", "Prepare saved local edits first");
    await page.screenshot({ path: path.join(out, `prepared-${width}-${theme}.png`), fullPage: true });
    check(await page.getByRole("button", { name: "Generar PDF", exact: true }).count(), 1, "Prepared without PDF offers generation");
    h.setFail({ status: 409, code: "STORAGE_QUOTA_EXCEEDED", error: "No queda espacio suficiente" });
    await page.getByRole("button", { name: "Generar PDF", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "No queda espacio suficiente" }).waitFor();
    check(await page.getByRole("link", { name: "Vista previa PDF" }).count(), 0, "Quota error leaves no document link");
    await page.getByRole("button", { name: "Generar PDF", exact: true }).click();
    await page.getByRole("link", { name: "Vista previa PDF", exact: true }).waitFor();
    check(await page.getByRole("link", { name: "Vista previa PDF", exact: true }).getAttribute("href"), "/api/quotes/quote-1/versions/version-2/pdf", "Current PDF uses version endpoint");
    check(await page.getByRole("link", { name: "Descargar PDF", exact: true }).getAttribute("href"), "/api/quotes/quote-1/versions/version-2/pdf?download=1", "Download uses secure entry point");
    check(await page.getByText("Documento preparado", { exact: true }).count(), 1, "Prepared document indicator");
    check(events.filter(e => e.pathname.endsWith('/pdf')).every(e => e.body === null), true, "PDF generation sends no client document payload");
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "PDF controls responsive");
    await page.screenshot({ path: path.join(out, `pdf-${width}-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Nueva versión", exact: true }).dblclick();
    await page.getByRole("status").filter({ hasText: "Borrador de versión abierto" }).waitFor();
    check(h.stored().versions.filter(v => v.state === "draft").length, 1, "New version replay opens only one draft");
    check(await page.getByLabel("Título / trabajo").isEnabled(), true, "New version opens editable draft");
    await page.getByRole("button").filter({ hasText: "v1 · Enviada" }).click();
    await page.getByRole("heading", { name: "Resumen histórico v1", exact: true }).waitFor();
    check(await page.getByRole("button", { name: "Guardar borrador", exact: true }).count(), 0, "Historical sent has no editor");
    check(await page.getByRole("link", { name: "Vista previa PDF", exact: true }).getAttribute("href"), "/api/quotes/quote-1/versions/version-1/pdf", "Sent history opens its own PDF");
    await page.getByRole("button", { name: "Volver a versión actual", exact: true }).click();
    await page.getByRole("button").filter({ hasText: "v2 · Preparada" }).click();
    await page.getByRole("heading", { name: "Resumen histórico v2", exact: true }).waitFor();
    check(await page.getByLabel("Título / trabajo").count(), 0, "Historical prepared cannot be edited");
    check(await page.getByRole("link", { name: "Vista previa PDF", exact: true }).getAttribute("href"), "/api/quotes/quote-1/versions/version-2/pdf", "Prepared history opens its own PDF");
    await page.screenshot({ path: path.join(out, `history-${width}-${theme}.png`), fullPage: true });
    await page.getByRole("button", { name: "Volver a versión actual", exact: true }).click();
    await page.getByRole("button", { name: "Editar gestión", exact: true }).click();
    await page.getByLabel("Servicio", { exact: true }).selectOption("service-1");
    await page.getByRole("button", { name: "Guardar gestión", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "Gestión operativa guardada" }).waitFor();
    check(events.some(e => /\/(send|status|convert|accept|reject)$/.test(e.pathname)), false, "No excluded workflow requests");
    check(h.errors, [], "No browser errors");
    await page.close();
    const list = await setup(width, theme, { mode: "list" });
    await list.page.getByText("P-0001", { exact: true }).filter({ visible: true }).waitFor();
    check(await list.page.getByText(/121,00/).filter({ visible: true }).count() > 0, true, "List shows total");
    check(await list.page.getByRole("button", { name: "Caducados", exact: true }).isVisible(), true, "Expired filter visible");
    await Promise.all([list.page.waitForResponse(res => res.url().includes("status=expired")), list.page.getByRole("button", { name: "Caducados", exact: true }).click()]);
    check(list.events.filter(e => /\/api\/quotes\/quote-1$/.test(e.pathname)).length, 0, "List avoids per-quote detail fetches");
    check(await list.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "List responsive overflow");
    await list.page.screenshot({ path: path.join(out, `list-${width}-${theme}.png`), fullPage: true });
    check(list.errors, [], "No list browser errors"); await list.page.close();
    for (const decision of ['accept','reject']) {
      const flow = await setup(width, theme, {state:'prepared'}); const p = flow.page;
      await p.getByRole('button',{name:'Generar PDF',exact:true}).click();
      await p.getByRole('button',{name:'Marcar como enviado',exact:true}).click();
      await p.getByRole('dialog').getByText('Esto no enviará ningún correo.',{exact:false}).waitFor();
      check(flow.events.some(e=>e.pathname.endsWith('/send')),false,'Send waits for explicit confirmation');
      await p.getByRole('button',{name:'Confirmar',exact:true}).click();
      await p.getByRole('button',{name:'Marcar aceptado',exact:true}).waitFor();
      check(await p.getByRole('link',{name:'Vista previa PDF',exact:true}).count(),1,'Sent PDF visible');
      await p.screenshot({path:path.join(out,`sent-${decision}-${width}-${theme}.png`),fullPage:true});
      await p.getByRole('button',{name:decision==='accept'?'Marcar aceptado':'Marcar rechazado',exact:true}).click();
      await p.getByRole('button',{name:'Confirmar',exact:true}).click();
      await p.getByRole('status').filter({hasText:'Estado comercial registrado'}).waitFor();
      check(await p.getByRole('button',{name:'Nueva versión',exact:true}).count(),decision==='accept'?0:1,'Decision controls new version');
      if (decision==='accept') {
        check(await p.getByText('Versión aceptada: v2',{exact:true}).count(),1,'Exact accepted version displayed');
        await p.getByRole('button',{name:'Convertir en pedido',exact:true}).click();
        await p.getByRole('button',{name:'Confirmar y crear pedido',exact:true}).waitFor();
        await p.getByLabel('Tienda',{exact:true}).selectOption('store-1');
        await p.getByLabel('Servicio',{exact:true}).selectOption('service-1');
        await p.getByLabel('Responsable',{exact:true}).selectOption('member-1');
        await p.getByLabel('Prioridad',{exact:true}).selectOption('high');
        await p.getByLabel('Fecha y hora de entrega',{exact:true}).fill('2026-12-10T10:30');
        check(flow.events.some(e=>e.pathname.endsWith('/convert')),false,'Conversion waits for final confirmation');
        check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Conversion modal responsive');
        await p.screenshot({path:path.join(out,`conversion-modal-${width}-${theme}.png`),fullPage:true});
        await p.getByRole('button',{name:'Confirmar y crear pedido',exact:true}).dblclick();
        await p.getByRole('status').filter({hasText:'Convertido en pedido O-0001'}).waitFor();
        check(await p.getByRole('button',{name:'Convertir en pedido',exact:true}).count(),0,'No second conversion action');
        check(await p.getByRole('link',{name:'Abrir pedido O-0001',exact:true}).getAttribute('href'),'/orders/order-1','Opens returned order');
        check(flow.events.filter(e=>e.pathname.endsWith('/convert')).length,1,'Double click creates one request');
        check(flow.events.find(e=>e.pathname.endsWith('/convert')).body.priority,'high','Chosen priority submitted');
      }
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Commercial actions responsive');
      check(flow.errors,[],'No transition browser errors');
      await p.screenshot({path:path.join(out,`${decision}-${width}-${theme}.png`),fullPage:true});
      await p.close();
    }
    const origin=await setup(width,theme,{mode:'source'});
    await origin.page.getByRole('heading',{name:'Presupuesto origen',exact:true}).waitFor();
    check(await origin.page.getByRole('link',{name:'Ver presupuesto',exact:true}).getAttribute('href'),'/quotes/quote-1','Order source uses authenticated quote page');
    check(await origin.page.getByText(/Aceptado · v2/).count(),1,'Source accepted version shown');
    check(await origin.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Order source responsive');
    await origin.page.screenshot({path:path.join(out,`order-source-${width}-${theme}.png`),fullPage:true});await origin.page.close();
    results.push({ width, theme, status: "PASS" });
    console.log(`PASS ${width}px ${theme}`);
  }
  for (const state of ["prepared", "sent"]) {
    const h = await setup(390, "dark", { state });
    await h.page.getByRole("heading", { name: "Cabecera comercial" }).waitFor();
    check(await h.page.getByLabel("Título / trabajo").isDisabled(), true, `${state} current is readonly`);
    check(await h.page.getByRole("button", { name: "Guardar borrador", exact: true }).count(), 0, "No writable save");
    await h.page.close();
  }
  const legacy = await setup(390, "light", { legacy: true });
  await legacy.page.getByRole("button", { name: "Abrir borrador comercial", exact: true }).click();
  await legacy.page.getByRole("heading", { name: "Cabecera comercial" }).waitFor();
  check(legacy.events.filter(e => e.pathname.endsWith("/draft") && e.method === "POST").length, 1, "Explicit idempotent legacy ensure");
  await legacy.page.getByLabel("Título / trabajo").fill("Guardado con error de lectura");
  legacy.setReadFail(true);
  await legacy.page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await legacy.page.getByRole("alert").filter({ hasText: "Borrador guardado. No se pudieron refrescar" }).waitFor();
  check(await legacy.page.getByTestId("quote-totals").innerText().then(t=>t.includes("987,65")), true, "Write acknowledged despite read failure");
  legacy.setReadFail(false);
  await legacy.page.getByLabel("Título / trabajo").fill("Segunda escritura");
  await legacy.page.getByRole("button", { name: "Guardar borrador", exact: true }).click();
  await legacy.page.getByRole("status").filter({ hasText: "Borrador guardado" }).waitFor();
  await legacy.page.close();
  for (const denied of [403, 404]) {
    const h = await setup(390, "light", { denied });
    await h.page.getByText("Acceso no disponible", { exact: true }).waitFor();
    check(await h.page.getByRole("button", { name: "Guardar borrador", exact: true }).count(), 0, "API gate never offers editor");
    check(h.events.filter(e => e.method !== "GET").length, 0, "API gate never creates draft");
    await h.page.close();
  }
  await writeFile(path.join(out, "results.json"), JSON.stringify({ status: "PASS", assertions, results, scope: "Real components and CSS with HTTP doubles; server gates covered by HTTP tests, SQL already validated separately." }, null, 2));
  console.log(JSON.stringify({ status: "PASS", assertions, output: out }));
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: path.join(out, "failure.png"), fullPage: true });
    console.error(await lastPage.locator("body").innerText());
    console.error(JSON.stringify(lastEvents));
  }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
