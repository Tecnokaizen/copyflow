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
    import {QuotesList} from './components/quotes/quotes-list'; import {QuoteCreationEditor} from './components/quotes/quote-creation-editor';
    const params = new URLSearchParams(location.search);
    createRoot(document.getElementById('root')).render(<ThemeProvider attribute="class" forcedTheme={params.get('theme') || 'light'}>
      {params.get('mode') === 'new' ? <QuoteCreationEditor/> : params.get('mode') === 'list' ? <QuotesList/> : <QuoteCommercialEditor quoteId="quote-1"/>}</ThemeProvider>);`, resolveDir: root, loader: "tsx" },
  jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), bundle: true,
  outfile: path.join(temp, "app.js"), platform: "browser",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "next-browser-boundary", setup(api) {
    api.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "test-next" }));
    api.onLoad({ filter: /.*/, namespace: "test-next" }, ({ path: module }) => ({ contents: module.endsWith("navigation")
      ? `import {useSyncExternalStore} from 'react';
        const replaceState = history.replaceState.bind(history); history.replaceState = (...args) => {replaceState(...args);window.dispatchEvent(new PopStateEvent('popstate'))};
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
const ca = { id: 'e4400000-0000-4000-8000-000000000021', name: 'Clínica A', company_name: 'Clínica A SL', contact_name: 'Ana', email: 'ana@example.com', phone: '600111222', tax_id: 'A123', customer_type_id: null, customer_type_name: null, notes: null };
const cb = { ...ca, id: 'e4400000-0000-4000-8000-000000000022', name: 'Cliente B', company_name: null, contact_name: 'Bea', email: 'bea@example.com', phone: '600333444', tax_id: 'B456' };
async function setup(width, theme, mode = 'new', state = 'draft') {
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  const page = await context.newPage(); page.setDefaultTimeout(10000);
  lastPage = page; const events = [], errors = []; lastEvents = events; let failNext = false, failCommitted = false, failAck = false, unavailable = false; const ledger = new Map();
  let stored = fixture(state); stored.current_version.version_number = 1; stored.versions = [stored.current_version];
  stored.quote.current_version_number = 1; stored.quote.current_version_state = state;
  stored.quote.client = ca; stored.quote.contact_phone = ca.phone; stored.quote.contact_email = ca.email;
  stored.quote.billing_name = ca.company_name; stored.quote.tax_id = ca.tax_id;
  stored.current_version.client_manual_fields = ['contact_name'];
  if (state === 'sent') stored.quote.status = { id: 's', name: 'Enviado', code: 'sent' };
  function saveHeader(header, items) {
    Object.assign(stored.quote, header); stored.quote.row_version++;
    Object.assign(stored.current_version, header); stored.current_version.row_version++;
    stored.current_version.client_manual_fields = header.client_manual_fields;
    stored.items = items.map((item, n) => ({...stored.items[n], ...item, id: `saved-${n}`, position: n+1}));
  }
  page.on('pageerror', err => errors.push(err.message));
  await context.route('**/api/**', async route => {
    const req = route.request(), pathname = new URL(req.url()).pathname, method = req.method();
    const body = req.postDataJSON(); events.push({ pathname, method, body });
    let result = {}, status = 200;
    if (pathname === '/api/context') result = { tenant: { id: 'tenant-a', name: 'Demo', slug: 'demo' }, user: { id: 'actor' }, membership: { role: 'owner' }, features: { quotes: true } };
    else if (pathname === '/api/clients') result = { clients: [ca, cb] };
    else if (pathname === '/api/services') result = { services: [] };
    else if (pathname === '/api/team') result = { members: [] };
    else if (pathname.endsWith('/activity')) result = { events: [] };
    else if (pathname.endsWith('/files')) result = { files: [] };
    else if (pathname === '/api/quotes/creation-recovery') {
      const op = new URL(req.url()).searchParams.get('op');
      if (unavailable) { await route.abort('failed'); return; }
      if (method === 'POST') {
        const receipt = ledger.get(body.operation_id);
        if (!receipt) { status = 404; result = { error: 'No encontrado' }; }
        else { receipt.acknowledged_at ??= '2026-10-06T12:01:00Z'; result = { ok: true, quote_id: body.operation_id }; }
        if (failAck) { failAck = false; await route.abort('failed'); return; }
      } else result = { receipts: [...ledger.values()].filter(r => op ? r.operation_id === op : !r.acknowledged_at).map(({ payload, ...r }) => r) };
    }
    else if (pathname === '/api/quotes/create-draft') {
      if (failNext) { failNext = false; await route.abort('failed'); return; }
      const previous = ledger.get(body.creation_id);
      if (previous && JSON.stringify(previous.payload) !== JSON.stringify(body)) { status = 409; result = { error: 'Solicitud incompatible', code: 'creation_conflict' }; }
      else {
        ledger.set(body.creation_id, previous ?? { operation_id: body.creation_id, quote_id: body.creation_id, reference: `P-${ledger.size + 1}`, created_at: '2026-10-06T12:00:00Z', acknowledged_at: null, payload: body });
        result = { ok: true, quote_id: body.creation_id, version: { state: body.prepare ? 'prepared' : 'draft' } };
      }
      if (failCommitted) { failCommitted = false; await route.abort('failed'); return; }
    } else if (pathname === '/api/quotes/quote-1/draft' && method === 'PUT') {
      saveHeader(body.header, body.items); result = { version: stored.current_version };
    } else if (pathname === '/api/quotes/quote-1/client-draft') {
      stored.quote.client = body.fields.client_id === ca.id ? ca : body.fields.client_id === cb.id ? cb : null;
      saveHeader(body.draft.header, body.draft.items); result = { ok: true, version: stored.current_version };
    } else if (pathname === '/api/quotes/quote-1') result = stored;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await page.goto(`${url}/?mode=${mode}&theme=${theme}`);
  await page.getByRole('heading', { name: 'Datos del presupuesto', exact: true }).waitFor();
  if (mode === 'new') await page.getByLabel('Título / trabajo').waitFor({ state: 'visible' });
  return { page, context, events, errors, stored: () => stored, ledger, fail: () => { failNext = true; }, loseResponse: () => { failCommitted = true; }, loseAck: () => { failAck = true; }, unavailable: () => { unavailable = true; } };
}
async function fill(page) {
  await page.getByPlaceholder('Buscar cliente', { exact: false }).fill('Clínica');
  await page.getByRole('button').filter({ hasText: 'Clínica A SL' }).click();
  check(await page.getByLabel('Persona de contacto').inputValue(), 'Ana', 'Contact autofill');
  check(await page.getByLabel('Email', { exact: true }).inputValue(), 'ana@example.com', 'Email autofill');
  check(await page.getByLabel('Teléfono').inputValue(), '600111222', 'Phone autofill');
  check(await page.getByLabel('Nombre / razón social').inputValue(), 'Clínica A SL', 'Billing autofill');
  check(await page.getByLabel('NIF / CIF').inputValue(), 'A123', 'Tax autofill');
  await page.getByLabel('Persona de contacto').fill('Especial');
  await page.getByLabel('Email', { exact: true }).fill('');
  await page.getByLabel('Dirección de facturación').fill('Manual');
  await page.getByRole('button', { name: 'Cambiar', exact: true }).click();
  await page.getByRole('button').filter({ hasText: 'Cliente B' }).click();
  check(await page.getByLabel('Persona de contacto').inputValue(), 'Especial', 'Manual contact preserved');
  check(await page.getByLabel('Email', { exact: true }).inputValue(), '', 'Manual cleared email preserved');
  check(await page.getByLabel('Teléfono').inputValue(), cb.phone, 'Pristine phone changes');
  check(await page.getByLabel('Nombre / razón social').inputValue(), cb.name, 'Name fallback');
  check(await page.getByLabel('Dirección de facturación').inputValue(), 'Manual', 'Manual address preserved');
  await page.getByLabel('Título / trabajo').fill('Catálogos');
  await page.getByLabel('Descripción del trabajo', { exact: true }).fill('Impresión de catálogos');
  await page.getByRole('button', { name: 'Añadir línea', exact: true }).click();
  await page.getByLabel('Concepto', { exact: true }).fill('Impresión');
  await page.getByLabel('Cantidad', { exact: true }).fill('2');
  await page.getByLabel('Precio unitario', { exact: true }).fill('100');
}
try {
  for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
    const h = await setup(width, theme); const { page } = h;
    await fill(page);
    check(await page.getByRole('heading', { name: 'Revisiones', exact: true }).count(), 0, 'No history on new');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow');
    await page.screenshot({ path: path.join(out, `new-${width}-${theme}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
    await page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
    const writes = h.events.filter(e => e.pathname === '/api/quotes/create-draft'); check(writes.length, 1, 'Single complete creation submit');
    check(writes[0].body.header.contact_name, 'Especial', 'Manual header submitted'); check(writes[0].body.items.length, 1, 'Lines submitted with header');
    check(writes[0].body.prepare, false, 'Draft action'); check(h.errors, [], 'No new editor runtime errors'); await page.close();
    const draft = await setup(width, theme, 'editor');
    check(await draft.page.getByRole('heading', { name: 'Revisiones', exact: true }).count(), 0, 'Initial saved draft no history');
    check(await draft.page.getByRole('heading', { name: 'Acciones del presupuesto', exact: true }).count(), 0, 'Initial draft no empty actions');
    check(await draft.page.getByText(/v1|Historial de versiones/).count(), 0, 'No technical first-version label');
    await draft.page.screenshot({ path: path.join(out, `draft-${width}-${theme}.png`), fullPage: true });
    check(await draft.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Saved draft responsive');
    check(draft.errors, [], 'No saved editor errors'); await draft.page.close();
    results.push({ width, theme, status: 'PASS' }); console.log(`PASS ${width}px ${theme}`);
  }
  const retry = await setup(390, 'dark'); await fill(retry.page); retry.fail();
  await retry.page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await retry.page.getByRole('alert').filter({ hasText: 'Reintenta' }).waitFor();
  check(await retry.page.getByLabel('Título / trabajo').isDisabled(), true, 'Ambiguous request stays frozen');
  await retry.page.reload();
  await retry.page.getByRole('button', { name: 'Reintentar guardado', exact: true }).waitFor();
  const retryUrl = retry.page.url();
  await retry.page.close();
  retry.page = await retry.context.newPage(); lastPage = retry.page;
  await retry.page.goto(retryUrl);
  await retry.page.getByRole('button', { name: 'Reintentar guardado', exact: true }).click();
  await retry.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  const writes = retry.events.filter(e => e.pathname === '/api/quotes/create-draft');
  check(writes.length, 2, 'One retry after reload'); check(writes[0].body, writes[1].body, 'Same complete request and UUID after lost response, reload and tab closure');
  await retry.page.close();
  const prepare = await setup(768, 'light'); await fill(prepare.page);
  await prepare.page.getByRole('button', { name: 'Preparar presupuesto', exact: true }).click();
  await prepare.page.getByRole('dialog').getByRole('button', { name: 'Preparar presupuesto', exact: true }).click();
  await prepare.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  check(prepare.events.filter(e => e.pathname === '/api/quotes/create-draft').length, 1, 'Atomic creation and prepare in one submit');
  check(prepare.events.find(e => e.pathname === '/api/quotes/create-draft').body.prepare, true, 'Prepare action passed'); await prepare.page.close();
  for (const state of ['prepared', 'sent']) {
    const h = await setup(390, 'dark', 'editor', state);
    check(await h.page.getByLabel('Título / trabajo').isDisabled(), true, `${state} immutable editor`);
    check(await h.page.getByRole('button', { name: 'Guardar borrador', exact: true }).count(), 0, `${state} no save`); await h.page.close();
  }
  async function secondPage(h, target) {
    const page = await h.context.newPage(); page.setDefaultTimeout(10000); lastPage = page;
    await page.goto(target ?? `${url}/?mode=new&theme=light`);
    await page.getByLabel('Título / trabajo').waitFor();
    return page;
  }
  // Two independent tabs: neither may overwrite or remove the other's receipt.
  const distinct = await setup(390, 'light');
  const tabB = await secondPage(distinct); await fill(distinct.page); await fill(tabB);
  check(new URL(distinct.page.url()).searchParams.get('op') !== new URL(tabB.url()).searchParams.get('op'), true, 'Independent tabs have independent URL identities');
  distinct.loseResponse(); await distinct.page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await distinct.page.getByRole('button', { name: 'Reintentar guardado', exact: true }).waitFor();
  const aKey = await distinct.page.evaluate(() => Object.keys(localStorage)[0]);
  await tabB.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await tabB.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  check(await distinct.page.evaluate(key => localStorage.getItem(key) !== null, aKey), true, 'Tab B keeps pending A');
  await distinct.page.reload(); await distinct.page.getByRole('button', { name: 'Abrir presupuesto existente', exact: true }).click();
  await distinct.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  check(distinct.ledger.size, 2, 'Exactly two independent quotes'); await distinct.context.close();
  // Same op tabs race on a shared lock and converge on the first complete request.
  const same = await setup(768, 'dark'); const sameB = await secondPage(same, same.page.url());
  await fill(same.page); await fill(sameB);
  check(new URL(same.page.url()).searchParams.get('op'), new URL(sameB.url()).searchParams.get('op'), 'Copied URL retains same operation');
  await Promise.all([same.page.getByRole('button', { name: 'Guardar borrador', exact: true }).evaluate(button => button.click()), sameB.getByRole('button', { name: 'Guardar borrador', exact: true }).evaluate(button => button.click())]);
  await same.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  await sameB.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  check(same.ledger.size, 1, 'Same operation creates exactly one quote');
  check(same.events.filter(e => e.pathname === '/api/quotes/create-draft').length, 1, 'Second same-op tab recovers server receipt');
  check(await same.page.evaluate(() => window.lastNavigation), await sameB.evaluate(() => window.lastNavigation), 'Both tabs converge on same quote'); await same.context.close();
  // Committed response lost: URL alone recovers even after localStorage loss.
  const storageLoss = await setup(390, 'dark'); await fill(storageLoss.page); storageLoss.loseResponse();
  await storageLoss.page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await storageLoss.page.getByRole('button', { name: 'Reintentar guardado', exact: true }).waitFor();
  const lossId = new URL(storageLoss.page.url()).searchParams.get('op');
  await storageLoss.page.evaluate(() => localStorage.clear()); await storageLoss.page.reload();
  await storageLoss.page.getByRole('button', { name: 'Abrir presupuesto existente', exact: true }).click();
  await storageLoss.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  check(storageLoss.ledger.size, 1, 'Storage loss never creates a second quote');
  check(await storageLoss.page.evaluate(() => window.lastNavigation), `/quotes/${lossId}`, 'URL restores exact quote');
  // ACK replay and exact recovery after ACK also keep the same identity.
  await storageLoss.page.reload();
  await storageLoss.page.getByRole('button', { name: 'Abrir presupuesto existente', exact: true }).click();
  await storageLoss.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  check(storageLoss.ledger.size, 1, 'Acknowledged URL recovery stays idempotent'); await storageLoss.context.close();
  // Loss of URL + storage must always require an explicit decision. Test both decisions in all layouts.
  for (const width of [390, 768, 1280]) for (const theme of ['light', 'dark']) {
    const lost = await setup(width, theme); await fill(lost.page); lost.loseResponse();
    await lost.page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
    await lost.page.getByRole('button', { name: 'Reintentar guardado', exact: true }).waitFor();
    await lost.page.evaluate(() => localStorage.clear());
    await lost.page.goto(`${url}/?mode=new&theme=${theme}`);
    await lost.page.getByRole('button', { name: 'Abrir presupuesto existente', exact: true }).waitFor();
    check(await lost.page.getByRole('button', { name: 'Guardar borrador', exact: true }).isDisabled(), true, 'Unknown identity blocks silent creation');
    check(lost.ledger.size, 1, 'Recovery gate creates no quote');
    check(await lost.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'Recovery gate responsive');
    await lost.page.screenshot({ path: path.join(out, `recovery-${width}-${theme}.png`), fullPage: true });
    if (theme === 'light') {
      await lost.page.getByRole('button', { name: 'Abrir presupuesto existente', exact: true }).click();
      await lost.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
      check(lost.ledger.size, 1, 'Explicit open keeps existing quote');
    } else {
      await lost.page.getByRole('button', { name: 'Crear otro presupuesto', exact: true }).click();
      check(new URL(lost.page.url()).searchParams.get('new'), '1', 'Explicit new decision survives reload');
      await lost.page.reload(); await fill(lost.page);
      await lost.page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
      await lost.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
      check(lost.ledger.size, 2, 'Only explicit create-another creates second quote');
    }
    check(lost.errors, [], 'Recovery browser has no runtime errors'); await lost.context.close();
  }
  const editedDraft = await setup(768, 'light', 'editor');
  await editedDraft.page.getByLabel('Persona de contacto').fill('Manual persistido');
  await editedDraft.page.getByRole('button', {name:'Guardar borrador',exact:true}).click();
  await editedDraft.page.getByRole('status').filter({hasText:'Borrador guardado'}).waitFor();
  check(editedDraft.stored().current_version.client_manual_fields.includes('contact_name'),true,'Manual provenance written with draft');
  await editedDraft.page.reload();
  await editedDraft.page.getByRole('button',{name:'Editar gestión',exact:true}).click();
  await editedDraft.page.getByRole('button',{name:'Cambiar',exact:true}).click();
  await editedDraft.page.getByRole('button').filter({hasText:'Cliente B'}).click();
  editedDraft.page.on('dialog',dialog=>dialog.accept());
  await editedDraft.page.getByRole('button',{name:'Guardar gestión',exact:true}).click();
  await editedDraft.page.getByRole('status').filter({hasText:'Gestión operativa guardada'}).waitFor();
  check(await editedDraft.page.getByLabel('Persona de contacto').inputValue(),'Manual persistido','Saved draft keeps manual contact after reload and client change');
  check(await editedDraft.page.getByLabel('Teléfono').inputValue(),cb.phone,'Saved draft updates pristine phone');
  check(editedDraft.stored().quote.client.id,cb.id,'Saved draft changed client');
  check(editedDraft.events.filter(e=>e.pathname.endsWith('/client-draft')).length,1,'Client and header updated in one request');
  await editedDraft.page.reload();
  await editedDraft.page.getByLabel('Persona de contacto').waitFor();
  check(await editedDraft.page.getByLabel('Persona de contacto').inputValue(),'Manual persistido','Manual override persists after atomic client change');
  check(await editedDraft.page.getByLabel('Teléfono').inputValue(),cb.phone,'Autofill persists after atomic client change');
  check(editedDraft.errors,[],'Saved-client browser has no errors'); await editedDraft.context.close();
  // If ACK's response is lost, its URL still resolves the executed operation.
  const ackLoss = await setup(768, 'light'); await fill(ackLoss.page); ackLoss.loseAck();
  await ackLoss.page.getByRole('button', { name: 'Guardar borrador', exact: true }).click();
  await ackLoss.page.getByRole('button', { name: 'Reintentar guardado', exact: true }).waitFor();
  await ackLoss.page.reload(); await ackLoss.page.getByRole('button', { name: 'Abrir presupuesto existente', exact: true }).click();
  await ackLoss.page.waitForFunction(() => window.lastNavigation?.startsWith('/quotes/'));
  check(ackLoss.ledger.size, 1, 'Lost ACK response never duplicates'); await ackLoss.context.close();
  const offline = await setup(390, 'light'); offline.unavailable(); await offline.page.reload();
  await offline.page.getByRole('alert').waitFor();
  check(await offline.page.getByRole('button', {name:'Guardar borrador',exact:true}).isDisabled(),true,'Uncertain recovery fails closed');
  check(offline.ledger.size,0,'Recovery error never writes'); await offline.context.close();
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ status: 'PASS', assertions, results, scope: 'Real components and CSS; deterministic HTTP doubles. SQL suites separately test transactional guarantees.' }, null, 2));
  console.log(JSON.stringify({ status: 'PASS', assertions, output: out }));
} catch (error) {
  if (lastPage && !lastPage.isClosed()) { await lastPage.screenshot({ path: path.join(out, 'failure.png'), fullPage: true }); console.error(await lastPage.locator('body').innerText()); }
  throw error;
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
