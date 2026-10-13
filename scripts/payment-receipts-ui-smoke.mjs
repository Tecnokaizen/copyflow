/** Real OrderCollection and CSS in Chromium; deterministic HTTP/R2 doubles.
 * Does not access remote Supabase, R2 or production. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const temp = await mkdtemp(path.join(tmpdir(), 'payments-browser-'));
const out = process.env.SMOKE_OUTPUT_DIR || temp;
await mkdir(out, { recursive: true });
await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
import {OrderCollection} from './components/orders/detail/order-collection';
const params=new URLSearchParams(location.search);document.documentElement.classList.toggle('dark',params.get('theme')==='dark');
createRoot(document.getElementById('root')).render(<OrderCollection orderId="order-a" canWrite={params.get('role')!=='viewer'} archived={params.get('archived')==='true'} onChanged={()=>{}}/>);`, resolveDir: root, loader: 'tsx' }, jsx: 'automatic', bundle: true,
  tsconfig: path.join(root, 'tsconfig.json'), outfile: path.join(temp, 'app.js'), platform: 'browser',
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
});
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'app/globals.css', '-o', path.join(temp, 'style.css')], { stdio: 'pipe' });
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (['/app.js', '/style.css'].includes(url.pathname)) {
    res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(await readFile(path.join(temp, url.pathname.slice(1))));
  } else { res.setHeader('Content-Type','text/html'); res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><main style="max-width:600px;margin:auto;padding:16px"><div id="root"></div></main><script src="/app.js"></script>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.CHROMIUM_EXECUTABLE_PATH } : {}) });
const base = `http://127.0.0.1:${server.address().port}`;
const fileId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const results = [];
let checks = 0;
let actor = { tenant: 'tenant-a', user: 'user-a' };
function check(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
async function setup(width=1280, theme='light', query='') {
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 } });
  page.setDefaultTimeout(8000);
  const events = []; const errors = []; const storedKeys = new Map();
  let failPut = false; let failComplete = false; let losePayment = false; let conflictTotal = false;
  let version = 1; let payments = [{ id:'historic',amount:'1.00',paid_at:'2026-10-07T10:00:00Z',payment_method:null,receipt:null }];
  page.on('pageerror', error => errors.push(error.message));
  function snapshot() { const paid = payments.filter(p=>!p.voided_at).reduce((n,p)=>n+Number(p.amount),0); return { total_amount:'200.00',paid_amount:paid.toFixed(2),pending_amount:(200-paid).toFixed(2),collection_state:'partial',row_version:String(version),payments }; }
  await page.route('**/api/**', async route => {
    const req=route.request();const url=new URL(req.url());const method=req.method();const body=req.postData()?req.postDataJSON():null;
    events.push({ path:url.pathname,method,body }); let result={};let status=200;
    if (url.pathname === '/api/context') result = { tenant: { id: actor.tenant }, user: { id: actor.user } };
    else if (url.pathname.endsWith('/payments') && method==='GET') result=snapshot();
    else if (url.pathname.endsWith('/payments') && method==='POST') {
      if (!storedKeys.has(body.idempotency_key)) {
        const payment={id:`payment-${payments.length}`,amount:body.amount,paid_at:body.paid_at,payment_method:body.payment_method,receipt:body.receipt_file_id?{id:body.receipt_file_id,original_name:'bizum.pdf'}:null};
        payments.push(payment);storedKeys.set(body.idempotency_key,body);
      } else check(body,storedKeys.get(body.idempotency_key),'Exact retry after uncertain result');
      if(losePayment){losePayment=false;status=502;result={error:'Respuesta perdida. Vuelve a confirmar.'};} else result=snapshot();
    } else if(url.pathname.endsWith('/files') && method==='POST') result={file_id:fileId,upload_url:`${base}/r2-put`,required_headers:{'Content-Type':'application/pdf'},expires_at:'2026-10-13T12:00:00Z'};
    else if(url.pathname.endsWith('/complete')) { if(failComplete){failComplete=false;status=502;result={error:'Confirmación de archivo perdida'};} }
    else if(url.pathname.endsWith('/download')) result={download_url:`${base}/private-download`,filename:'bizum.pdf'};
    else if(url.pathname.endsWith('/void')) { payments=payments.map(p=>p.id===url.pathname.split('/').at(-2)?{...p,voided_at:'2026-10-13T12:00:00Z'}:p);result=snapshot(); }
    else if(url.pathname.endsWith('/total')) { if(conflictTotal){conflictTotal=false;version++;status=409;result={error:'conflict'};} else {check(body.expected_version,String(version),'PR93 current row_version');result=snapshot();} }
    else throw new Error(`Unexpected request ${url.pathname}`);
    await route.fulfill({ status,contentType:'application/json',body:JSON.stringify(result) });
  });
  await page.route('**/r2-put', async route => { events.push({path:'/r2-put',method:'PUT'}); await route.fulfill({status:failPut?502:200,body:''});failPut=false; });
  await page.route('**/private-download', route => route.fulfill({status:200,contentType:'application/pdf',headers:{'Content-Disposition':'attachment; filename=bizum.pdf'},body:'%PDF-1.4\n%%EOF'}));
  await page.goto(`${base}/?theme=${theme}${query}`);
  await page.getByText('Sin especificar (histórico)',{exact:false}).waitFor();
  return {page,events,errors,setFailPut:()=>{failPut=true;},setFailComplete:()=>{failComplete=true;},setLosePayment:()=>{losePayment=true;},setTotalConflict:()=>{conflictTotal=true;},stored:()=>payments};
}
async function open(h, receipt=true) {
  await h.page.getByRole('button',{name:'Registrar entrega a cuenta',exact:true}).click();
  const dialog=h.page.getByRole('dialog');
  check(await dialog.getByRole('button',{name:'Confirmar entrega',exact:true}).isDisabled(),true,'Method and amount required');
  check(await dialog.getByLabel('Método de pago').locator('option').count(),6,'Five methods plus placeholder');
  await dialog.getByLabel('Importe',{exact:true}).fill('10,50');
  await dialog.getByLabel('Método de pago').selectOption('bizum');
  if(receipt) {
    check(await dialog.getByRole('button',{name:'Adjuntar justificante'}).isVisible(),true,'Custom receipt button');
    const longName=`comprobante-${'bizum-'.repeat(24)}largo.pdf`;
    await dialog.getByLabel('Justificante (opcional)').setInputFiles({name:longName,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
    const name=dialog.getByTitle(longName);
    check(await name.evaluate(node=>node.className.includes('truncate')&&node.scrollWidth>node.clientWidth),true,'Receipt name truncates');
    await dialog.getByRole('button',{name:'Quitar justificante'}).click();
    check(await dialog.getByText('Ningún archivo').count(),1,'Receipt can be removed');
    await dialog.getByLabel('Justificante (opcional)').setInputFiles({name:'bizum.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
  }
  return dialog;
}
try {
  for(const width of [390,1280]) for(const theme of ['light','dark']) {
    const h=await setup(width,theme);const d=await open(h);
    await h.page.screenshot({path:path.join(out,`popup-${width}-${theme}.png`),fullPage:true});
    check(await h.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
    await d.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
    await h.page.getByRole('button',{name:'Justificante: bizum.pdf'}).waitFor();
    check(h.events.filter(e=>e.method==='POST').map(e=>e.path),['/api/orders/order-a/files',`/api/orders/order-a/files/${fileId}/complete`,'/api/orders/order-a/payments'],'Upload COMPLETE before money');
    check(h.stored().length,2,'Exactly one new payment');
    check(h.stored()[1].payment_method,'bizum','Method visible and saved');
    const download=h.page.waitForEvent('download');await h.page.getByRole('button',{name:'Justificante: bizum.pdf'}).click();await download;
    check(h.events.some(e=>e.path.endsWith('/download')),true,'Secure download requested on click');
    await h.page.getByRole('button',{name:'Anular',exact:true}).last().click();await h.page.getByLabel('Motivo').fill('Error de caja');await h.page.getByRole('button',{name:'Anular entrega',exact:true}).click();
    await h.page.getByText('Anulada',{exact:false}).waitFor();
    check(await h.page.getByRole('button',{name:'Justificante: bizum.pdf'}).count(),1,'Receipt remains after void');
    check(h.errors,[],'No browser errors');results.push({width,theme,case:'success/download/void'});await h.page.close();
  }
  const failed=await setup();const fd=await open(failed);failed.setFailPut();await fd.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await fd.getByRole('alert').waitFor();
  check(failed.events.filter(e=>e.path.endsWith('/payments')&&e.method==='POST').length,0,'PUT failure records no money');
  failed.setFailComplete();await fd.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await fd.getByRole('alert').waitFor();
  check(failed.events.filter(e=>e.path.endsWith('/payments')&&e.method==='POST').length,0,'COMPLETE failure records no money');
  const initCount=failed.events.filter(e=>e.path.endsWith('/files')&&e.method==='POST').length;
  await fd.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await failed.page.getByRole('button',{name:'Justificante: bizum.pdf'}).waitFor();
  check(failed.events.filter(e=>e.path.endsWith('/files')&&e.method==='POST').length,initCount,'COMPLETE retry reuses uploaded file');check(failed.stored().length,2,'Retry creates one payment');await failed.page.close();
  const uncertain=await setup();const ud=await open(uncertain);uncertain.setLosePayment();await ud.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await ud.getByRole('alert').waitFor();
  check(await ud.getByLabel('Método de pago').isDisabled(),true,'Uncertain request freezes payload');check(uncertain.stored().length,2,'Server committed despite lost response');
  const first=uncertain.events.find(e=>e.path.endsWith('/payments')&&e.method==='POST').body;
  await ud.getByRole('button',{name:'Cancelar',exact:true}).click();await uncertain.page.reload();await uncertain.page.getByRole('button',{name:'Registrar entrega a cuenta',exact:true}).click();
  const restored=uncertain.page.getByRole('dialog');check(await restored.getByLabel('Método de pago').isDisabled(),true,'Pending attempt restored after reload');
  await restored.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await restored.waitFor({state:'hidden'});
  check(uncertain.events.filter(e=>e.path.endsWith('/payments')&&e.method==='POST').at(-1).body,first,'Same key/data/file on explicit replay');check(uncertain.stored().length,2,'No duplicate after reload/retry');await uncertain.page.close();
  const noFile=await setup();const nd=await open(noFile,false);await nd.getByRole('button',{name:'Confirmar entrega',exact:true}).click();await nd.waitFor({state:'hidden'});check(noFile.stored()[1].receipt,null,'Optional receipt');check(noFile.events.some(e=>e.method==='PUT'),false,'No upload without receipt');await noFile.page.close();
  const total=await setup();await total.page.getByRole('button',{name:'Modificar total'}).click();const td=total.page.getByRole('dialog');await td.getByLabel('Importe').fill('250');total.setTotalConflict();await td.getByRole('button',{name:'Guardar total'}).click();await td.getByRole('alert').waitFor();check(await td.getByLabel('Importe').inputValue(),'250','PR93 preserves total draft');check(total.events.filter(e=>e.method==='PATCH').length,1,'No automatic monetary retry');await td.getByRole('button',{name:'Guardar total'}).click();await td.waitFor({state:'hidden'});await total.page.close();
  for(const query of ['&role=viewer','&archived=true']) {const h=await setup(390,'light',query);check(await h.page.getByRole('button',{name:'Registrar entrega a cuenta'}).count(),0,'No write actions for viewer/archive');await h.page.close();}
  actor = { tenant: 'tenant-a', user: 'user-a' };
  const shared = await setup();
  const sharedDialog = await open(shared, false);
  shared.setLosePayment();
  await sharedDialog.getByRole('button', { name: 'Confirmar entrega', exact: true }).click();
  await sharedDialog.getByRole('alert').waitFor();
  const pendingKey = 'gestcopy.payment-pending.v2:tenant-a:user-a:order-a';
  check(await shared.page.evaluate((key) => sessionStorage.getItem(key) !== null, pendingKey), true, 'Pending confirmation is stored for this user and tenant');
  actor = { tenant: 'tenant-a', user: 'user-b' };
  await shared.page.reload();
  await shared.page.getByRole('button', { name: 'Registrar entrega a cuenta', exact: true }).click();
  const otherUser = shared.page.getByRole('dialog');
  check(await otherUser.getByLabel('Método de pago').isDisabled(), false, 'Another user on this computer does not resume the pending confirmation');
  check(await otherUser.getByLabel('Importe', { exact: true }).inputValue(), '', 'Another user starts a separate confirmation');
  await otherUser.getByLabel('Importe', { exact: true }).fill('4');
  await otherUser.getByLabel('Método de pago').selectOption('card');
  await otherUser.getByRole('button', { name: 'Confirmar entrega', exact: true }).click();
  await otherUser.waitFor({ state: 'hidden' });
  const otherKey = 'gestcopy.payment-pending.v2:tenant-a:user-b:order-a';
  check(await shared.page.evaluate((key) => sessionStorage.getItem(key), pendingKey) !== null, true, 'Original pending confirmation remains after the other user pays');
  check(await shared.page.evaluate((key) => sessionStorage.getItem(key), otherKey), null, 'The other user does not keep a pending confirmation');
  actor = { tenant: 'tenant-a', user: 'user-a' };
  await shared.page.reload();
  await shared.page.getByRole('button', { name: 'Registrar entrega a cuenta', exact: true }).click();
  check(await shared.page.getByRole('dialog').getByLabel('Método de pago').isDisabled(), true, 'Original user still has the pending confirmation');
  await shared.page.close();
  await writeFile(path.join(out,'results.json'),JSON.stringify({checks,results,extra:['PUT failure','COMPLETE retry','response loss/reload/replay','optional receipt','PR93 conflict','viewer/archive']},null,2));
  console.log(`PASS ${checks} UI assertions. Evidence: ${out}`);
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
