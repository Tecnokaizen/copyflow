/** Real quote/order components; isolated HTTP doubles, never a live database.
 * PLAYWRIGHT_MODULE=/absolute/path/playwright/index.mjs node scripts/inline-client-ui-smoke.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = process.cwd(), out = await mkdtemp(path.join(tmpdir(), "inline-client-ui-"));
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {QuoteCreationEditor} from './components/quotes/quote-creation-editor';
    import {QuoteForm} from './components/quotes/quote-form';
    import {CreateOrderForm} from './components/orders/create-order-form';
    const mode = new URLSearchParams(location.search).get('mode');
    createRoot(document.getElementById('root')).render(mode === 'quote' ? <QuoteCreationEditor/> :
      mode === 'legacy' ? <QuoteForm initial={{title:'',description:'',notes:'',validUntil:'',client:null,serviceId:'',assigneeId:''}} submitting={false} error={null} submitLabel="Guardar presupuesto" onSubmit={v=>window.legacySubmit=v}/> :
      <CreateOrderForm mode={mode} onCancel={()=>{}}/>);`, resolveDir: root, loader: "tsx" },
  jsx: "automatic", tsconfig: path.join(root, "tsconfig.json"), bundle: true,
  outfile: path.join(out, "app.js"), platform: "browser",
  define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "next-browser-boundary", setup(api) {
    api.onResolve({ filter: /^next\/(navigation|link)$/ }, ({ path }) => ({ path, namespace: "test-next" }));
    api.onLoad({ filter: /.*/, namespace: "test-next" }, ({ path: module }) => ({ contents: module.endsWith("navigation")
      ? `export const useSearchParams=()=>new URLSearchParams(location.search);
         export const usePathname=()=>'/quotes/new';
         export const useRouter=()=>({push:url=>{window.lastNavigation=url}});`
      : `import React from 'react'; export default function Link({href,children,prefetch,...props}){return React.createElement('a',{...props,href},children)}`,
      resolveDir: root }));
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
    res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/app.css"><main id="root"></main><script src="/app.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const results = []; let lastPage, lastEvents, lastWarnings;
try {
  for (const width of [390, 1280]) for (const mode of ["quote", "quick", "full", "legacy"]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } }); lastPage = page;
    page.setDefaultTimeout(5000);
    const errors = [], warnings = [], events = [], clients = []; lastEvents = events; lastWarnings = warnings;
    page.on("pageerror", err => errors.push(err.message));
    page.on("console", msg => { if (msg.type() === "error") warnings.push(msg.text()); });
    let reject = false;
    await page.route("**/api/**", async route => {
      const req = route.request(), pathname = new URL(req.url()).pathname, method = req.method();
      const body = req.postDataJSON(); events.push({ pathname, method, body });
      const json = (result, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(result) });
      if (pathname === "/api/context") return json({tenant:{id:"tenant-a",slug:"demo",name:"Demo"},user:{id:"actor"},membership:{role:"owner"},features:{quotes:true}});
      if (pathname === "/api/quotes/creation-recovery") return json(method === "POST" ? {quote_id:body.operation_id} : {receipts:[]});
      if (pathname === "/api/quotes/create-draft" && method === "POST") return json({quote_id:body.creation_id,version:{state:"draft"}});
      if (pathname === "/api/orders" && method === "POST") return json({order:{id:"order-created",reference:"DEMO-001"}});
      if (pathname === "/api/orders/order-created/payments" && method === "GET") return json({total_amount:null,paid_amount:"0.00",pending_amount:null,collection_state:"undefined",row_version:"1",payments:[]});
      if (pathname === "/api/services") return json({services:[]});
      if (pathname === "/api/team") return json({members:[]});
      if (pathname === "/api/clients/options") return json({customer_types:[]});
      if (pathname === "/api/orders/options") return json({tenant:"demo",services:[],stores:[],entry_channels:[],order_contexts:[],team_members:[],actor_role:"owner",file_statuses:[],max_file_bytes:1048576});
      if (pathname === "/api/clients") {
        if (method === "POST") {
          if (reject) return json({error:"Could not create client"}, 500);
          const client = {...body,id:`client-${clients.length+1}`}; clients.push(client);
          return json({ok:true,tenant:"demo",client});
        }
        const search = new URL(req.url()).searchParams.get("search") ?? "";
        return json({clients:clients.filter(c=>c.name.includes(search))});
      }
      throw new Error(`Unexpected request: ${method} ${pathname}`);
    });
    await page.goto(`${url}/?mode=${mode}`);
    const create = page.getByRole("button", {name:/Crear nuevo cliente/}); await create.waitFor();
    if (mode === "quote") await page.getByRole("button",{name:"Añadir línea",exact:true}).click();
    const search = page.getByPlaceholder("Buscar cliente", {exact:false});
    await search.fill("Cliente inline"); await search.press("Escape"); await create.click();
    const modal = page.locator("form").filter({has:page.getByRole("heading", {name:/^(Nuevo cliente|Crear cliente)$/})}).last();
    await modal.getByLabel("Nombre *", {exact:true}).waitFor();
    const initialUrl = page.url();
    // Inspect native form ownership before submitting, including an incomplete quote.
    const ownership = await modal.getByRole("button", {name:"Crear cliente",exact:true}).evaluate(button=>({
      nested:!!button.closest('form')?.parentElement?.closest('form'),
      owner:button.form?.querySelector('h2')?.textContent,
      invalid:Array.from(button.form?.elements ?? []).filter(e=>e.validity && !e.validity.valid).map(e=>e.outerHTML),
    }));
    console.log(JSON.stringify({width,mode,ownership}));
    await modal.getByLabel("Persona de contacto", {exact:true}).fill("Ana inline");
    await modal.getByLabel("Email", {exact:true}).fill("ana@example.com");
    await modal.getByLabel("Teléfono", {exact:true}).fill("600123456");
    await modal.getByRole("button", {name:"Crear cliente",exact:true}).click();
    await page.getByText("Cliente inline", {exact:true}).waitFor();
    assert.equal(clients.length,1,"Exactly one client create");
    assert.equal(page.url(),initialUrl,"Client submit must not perform native form navigation");
    assert.equal(clients[0].email,"ana@example.com");
    assert.equal(events.filter(e=>e.pathname==="/api/clients" && e.method==="POST").length,1);
    assert.equal(events.some(e=>e.pathname==="/api/orders" || e.pathname==="/api/quotes/create-draft"),false,"Client submit never submits its parent");
    assert.equal(await modal.count(),0,"Modal closes after success");
    if (mode === "quote") {
      assert.equal(await page.getByLabel("Persona de contacto",{exact:true}).inputValue(),"Ana inline");
      assert.equal(await page.getByLabel("Email",{exact:true}).inputValue(),"ana@example.com");
    }
    // Reopen the selector: the created client remains searchable, with no reload.
    await page.locator("button").filter({hasText:/^Cambiar$/}).click();
    await search.fill("Cliente inline");
    await page.getByRole("button").filter({hasText:"Cliente inline"}).waitFor();
    await search.press("Escape");
    await page.getByText("Cliente inline",{exact:true}).waitFor();
    // Server failure keeps the modal and entered data; retry selects the new client.
    await page.locator("button").filter({hasText:/^Cambiar$/}).click();
    await page.getByRole("heading").first().click(); await create.click();
    await modal.getByLabel("Nombre *",{exact:true}).fill("Cliente reintento");
    reject = true;
    await modal.getByRole("button",{name:"Crear cliente",exact:true}).click();
    await modal.getByText("No se pudo crear el cliente",{exact:true}).waitFor();
    assert.equal(await modal.getByLabel("Nombre *",{exact:true}).inputValue(),"Cliente reintento");
    assert.equal(clients.length,1);
    reject = false;
    await modal.getByRole("button",{name:"Crear cliente",exact:true}).click();
    await page.getByText("Cliente reintento",{exact:true}).waitFor();
    assert.equal(clients.length,2);
    assert.equal(events.some(e=>e.pathname==="/api/orders" || e.pathname==="/api/quotes/create-draft"),false,"Retry never submits its parent");
    // Saving the parent proves its selected ID is the newly returned client ID.
    if (mode === "quote" || mode === "legacy") {
      await page.getByLabel(mode === "quote" ? "Título / trabajo" : "Título",{exact:true}).fill("Trabajo inline");
      await page.getByLabel(mode === "quote" ? "Descripción del trabajo" : "Descripción",{exact:true}).fill("Impresión de prueba");
      if (mode === "quote") {
        await page.getByLabel("Concepto",{exact:true}).fill("Impresión");
        await page.getByRole("button",{name:"Guardar borrador",exact:true}).click();
        await page.waitForFunction(()=>window.lastNavigation?.startsWith('/quotes/'));
        assert.equal(events.find(e=>e.pathname==="/api/quotes/create-draft").body.client_id,clients[1].id);
      } else {
        await page.getByRole("button",{name:"Guardar presupuesto",exact:true}).click();
        assert.equal(await page.evaluate(()=>window.legacySubmit.client.id),clients[1].id);
      }
    } else {
      await page.getByLabel(mode === "quick" ? "Descripción" : "Instrucciones",{exact:true}).fill("Impresión de prueba");
      await page.getByRole("button",{name:"Crear pedido",exact:true}).click();
      await page.getByRole("heading",{name:"Pedido creado",exact:true}).waitFor();
      assert.equal(events.find(e=>e.pathname==="/api/orders").body.client_id,clients[1].id);
    }
    assert.deepEqual(errors,[]);
    assert.equal(ownership.nested,false,"Client form must be outside all parent forms");
    assert.equal(warnings.some(w=>w.includes('cannot be a descendant') || w.includes('cannot contain')),false,"No invalid nested form warning");
    await page.screenshot({path:path.join(out,`${mode}-${width}.png`),fullPage:true});
    results.push({width,mode,status:"PASS"}); await page.close();
  }
  await writeFile(path.join(out,"results.json"),JSON.stringify({status:"PASS",results,scope:"Real browser components with isolated HTTP doubles; no live persistence writes."},null,2));
  console.log(JSON.stringify({status:"PASS",output:out,results}));
} catch(error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({path:path.join(out,"failure.png"),fullPage:true});
    console.error(await lastPage.locator("body").innerText());
    console.error(JSON.stringify({url:lastPage.url(),events:lastEvents,warnings:lastWarnings}));
  }
  throw error;
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
