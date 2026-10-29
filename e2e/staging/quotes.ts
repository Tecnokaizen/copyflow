/** Real Staging quote lifecycle. Reuses the existing e2e-only guard and harness.
 * Adds synthetic records, restores only the e2e footer, never sends email.
 * Requires pdftotext (Poppler) to verify the actual commercial PDF bytes.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {resolveStagingTarget,classifyRequest,r2BucketFromUrl} from './guard';
import {assertForeignControlsRan,isOpaqueDenial,resolveForeignQuoteFixture} from './foreign-fixtures';
import {Harness} from './harness';
import {Redactor} from './redact';
import {requireSyntheticEmail,runId} from './synthetic';

async function main(){
 const target=resolveStagingTarget();
 const foreign=resolveForeignQuoteFixture();
 requireSyntheticEmail(process.env.E2E_USER_EMAIL);
 assert.ok(process.env.E2E_USER_PASSWORD,'E2E_USER_PASSWORD is required');
 const run=runId();
 const dir=path.join(process.env.E2E_ARTIFACTS_DIR ?? 'e2e-artifacts','quotes-'+run);
 const redactor=new Redactor([process.env.E2E_USER_PASSWORD,process.env.VERCEL_AUTOMATION_BYPASS_SECRET]);
 const h=new Harness(target,redactor,dir,process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
 const result:any={run,baseUrl:target.baseUrl,deploymentSha:process.env.E2E_DEPLOYMENT_SHA ?? null,foreignFixture:{tenant:foreign.tenantSlug,reference:foreign.reference,source:foreign.source},checks:{}};
 const title='E2E Presupuesto '+run;
 const client='E2E Cliente presupuestos '+run;
 const publicNote='PUBLIC-CONDICIONES-'+run;
 const privateNote='INTERNO-PRIVADO-'+run+'\nNo publicar <interno> & taller';
 const footer='<p><strong>E2E PIE COMERCIAL</strong></p>\n<p>Dirección de prueba</p>\n<p>contacto@example.com</p>\n<p>Validez y condiciones de prueba</p>';
 let oldFooter:any,footerChanged=false;
 let p:any;
 async function call(url:string,method='GET',data?:any){
  assert.ok(url.startsWith('/api/'));
  const r=await p.request.fetch(target.baseUrl+url,{method,data,timeout:30000,maxRedirects:0});
  const text=await r.text();let b:any;try{b=JSON.parse(text)}catch{b={text:text.slice(0,300)}}
  return {status:r.status(),body:b,headers:r.headers()};
 }
 async function detail(){const r=await call('/api/quotes/'+result.quoteId);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
 async function observe(method:string,pathname:string,click:()=>Promise<void>){
  const wait=p.waitForResponse((r:any)=>r.request().method()===method&&new URL(r.url()).pathname===pathname,{timeout:60000});
  wait.catch(()=>undefined);await click();const r=await wait;
  assert.ok(r.status()<300,`HTTP ${r.status()} ${pathname}`);return r;
 }
 try{
  await h.start(process.env.PLAYWRIGHT_MODULE!);p=h.page;
  await h.step('login and tenant gate',async()=>{
   await p.goto(target.baseUrl+'/auth/login');
   await p.locator('#email').fill(process.env.E2E_USER_EMAIL!);await p.locator('#password').fill(process.env.E2E_USER_PASSWORD!);
   await Promise.all([p.waitForURL((u:URL)=>u.origin===target.baseUrl&&!u.pathname.startsWith('/auth/')),p.getByRole('button',{name:'Login',exact:true}).click()]);
   const c=await call('/api/context');assert.equal(c.status,200);assert.equal(c.body.tenant.slug,'e2e');assert.equal(c.body.features.quotes,true);assert.equal(c.body.membership.role,'owner');
   result.tenantId=c.body.tenant.id;result.checks.tenantAndFlag=true;
  });
  // Mandatory: a run never passes without both cross-tenant denials (see foreign-fixtures.ts).
  await h.step('cross-tenant quote and PDF denied',async()=>{
   const q=await call('/api/quotes/'+foreign.quoteId);
   assert.ok(isOpaqueDenial(q.status,JSON.stringify(q.body),foreign),`foreign quote: HTTP ${q.status}`);result.checks.foreignTenantQuoteDenied=true;
   const pdf=await call(`/api/quotes/${foreign.quoteId}/versions/${foreign.versionId}/pdf`);
   assert.ok(isOpaqueDenial(pdf.status,JSON.stringify(pdf.body),foreign),`foreign PDF: HTTP ${pdf.status}`);result.checks.foreignTenantPdfDenied=true;
  });
  await h.step('four visible footer lines with formatted HTML',async()=>{
   const current=await call('/api/settings/organization');assert.equal(current.status,200);oldFooter=current.body.quote_footer??null;
   const saved=await call('/api/settings/organization','PATCH',{quote_footer:footer});assert.equal(saved.status,200,JSON.stringify(saved.body));footerChanged=true;
   result.checks.footerAcceptsFourVisibleLines=true;
  });
  await h.step('create synthetic client through UI',async()=>{
   await p.goto(target.baseUrl+'/clients');await p.getByRole('button',{name:'Nuevo cliente',exact:true}).click();
   await p.getByLabel('Nombre *').fill(client);await p.getByLabel('Email',{exact:true}).fill('e2e-quote-'+run.toLowerCase()+'@example.com');
   await observe('POST','/api/clients',()=>p.getByRole('button',{name:'Guardar',exact:true}).click());
   await p.getByPlaceholder(/^Buscar por nombre, empresa, contacto/).fill(client);
   await p.getByRole('link',{name:client,exact:true}).waitFor();
  });
  await h.step('multiline quote and independent duplicate through UI',async()=>{
   await p.goto(target.baseUrl+'/quotes/new');
   // Creations left unacknowledged by earlier runs (last 48 h) lock the form behind the recovery panel.
   // Fail with that cause instead of a fill timeout; acknowledging them is an owner decision, never done here.
   const titleField=p.getByLabel('Título / trabajo',{exact:true});
   const recoveryPanel=p.getByRole('region',{name:'Recuperación de presupuesto',exact:true});
   await recoveryPanel.or(titleField.and(p.locator(':enabled'))).first().waitFor({timeout:30000});
   if(await recoveryPanel.isVisible()){
    const pending=await call('/api/quotes/creation-recovery');
    const refs=(pending.body.receipts??[]).map((r:any)=>r.reference).join(', ')||`HTTP ${pending.status}`;
    throw new Error(`/quotes/new is locked by unacknowledged quote creations from earlier runs (${refs}). They clear 48 h after creation, or with "Crear otro presupuesto" once the owner approves.`);
   }
   await titleField.fill(title);
   await p.getByPlaceholder(/^Buscar cliente por nombre/).fill(client);
   await p.getByRole('button',{name:new RegExp(client)}).click();
   await p.locator('[contenteditable="true"][aria-label="Descripción del trabajo"]').fill('Trabajo de prueba multilínea\nImpresión y acabado');
   await p.locator('[contenteditable="true"][aria-label="Términos y condiciones"]').fill(publicNote+'\nCondición segunda');
   if(await p.getByTestId('quote-item').count()===0) await p.getByRole('button',{name:'Añadir línea',exact:true}).click();
   const row=p.getByTestId('quote-item').nth(0);
   await row.getByLabel('Concepto',{exact:true}).fill('Impresión A4');await row.locator('textarea').fill('Primera línea de impresión\nSegunda línea de detalle');
   await row.getByLabel('Cantidad',{exact:true}).fill('2');await row.getByLabel('Precio unitario',{exact:true}).fill('10');await row.getByLabel('IVA %',{exact:true}).fill('21');
   await p.getByRole('button',{name:'Duplicar partida 1',exact:true}).click();
   assert.equal(await p.getByTestId('quote-item').count(),2);
   const copy=p.getByTestId('quote-item').nth(1);
   assert.equal(await copy.getByLabel('Concepto',{exact:true}).inputValue(),'Impresión A4');
   assert.equal(await copy.locator('textarea').inputValue(),'Primera línea de impresión\nSegunda línea de detalle');
   assert.equal(await copy.getByLabel('Cantidad',{exact:true}).inputValue(),'2');
   await copy.getByLabel('Concepto',{exact:true}).fill('Impresión A4 copia independiente');await copy.getByLabel('Cantidad',{exact:true}).fill('3');
   assert.equal(await row.getByLabel('Cantidad',{exact:true}).inputValue(),'2');
   await p.getByRole('button',{name:'Añadir línea',exact:true}).click();
   const third=p.getByTestId('quote-item').nth(2);await third.getByLabel('Concepto',{exact:true}).fill('Acabado');await third.getByLabel('Cantidad',{exact:true}).fill('1');await third.getByLabel('Precio unitario',{exact:true}).fill('5');await third.getByLabel('IVA %',{exact:true}).fill('10');
   await h.screenshot('quote-three-lines-before-save');
   await observe('POST','/api/quotes/create-draft',()=>p.getByRole('button',{name:'Guardar borrador',exact:true}).click());
   await p.waitForURL(/\/quotes\/[a-f0-9-]{36}$/);result.quoteId=new URL(p.url()).pathname.split('/')[2];
   await p.getByRole('button',{name:'Recargar ficha',exact:true}).waitFor();
   const d=await detail();result.reference=d.quote.reference;result.versionId=d.current_version.id;
   assert.equal(d.items.length,3);assert.equal(new Set(d.items.map((x:any)=>x.id)).size,3);assert.equal(Number(d.current_version.total),66);assert.equal(Number(d.current_version.subtotal),55);assert.equal(Number(d.current_version.tax_total),11);
   result.checks.multiline=true;result.checks.independentDuplicate=true;result.totals={subtotal:'55.00',tax:'11.00',total:'66.00'};
   await p.reload();await p.getByTestId('quote-item').nth(2).waitFor();assert.equal(await p.getByTestId('quote-item').count(),3);
   result.checks.persistence=true;await h.screenshot('saved-multiline-quote');
  });
  await h.step('save private internal notes through UI',async()=>{
   await p.locator('textarea[maxlength="8000"]').fill(privateNote);
   await observe('POST',`/api/quotes/${result.quoteId}/internal-notes`,()=>p.getByRole('button',{name:'Guardar notas',exact:true}).click());
   assert.equal((await detail()).quote.internal_notes,privateNote);
  });
  await h.step('prepare immutable quote and generate commercial PDF',async()=>{
   await p.getByRole('button',{name:'Preparar presupuesto',exact:true}).click();
   await observe('POST',`/api/quotes/${result.quoteId}/prepare`,()=>p.getByRole('dialog').getByRole('button',{name:'Preparar presupuesto',exact:true}).click());
   await p.getByRole('button',{name:'Generar PDF',exact:true}).waitFor();
   assert.equal(await p.getByRole('button',{name:/Duplicar partida/}).count(),0);
   result.checks.preparedReadOnly=true;
   await observe('POST',`/api/quotes/${result.quoteId}/versions/${result.versionId}/pdf`,()=>p.getByRole('button',{name:'Generar PDF',exact:true}).click());
   await p.getByRole('link',{name:'Descargar PDF',exact:true}).waitFor();
   const endpoint=`/api/quotes/${result.quoteId}/versions/${result.versionId}/pdf`;
   const redirect=await call(endpoint);assert.equal(redirect.status,307);assert.match(redirect.headers['cache-control'],/private.*no-store/);
   const location=redirect.headers.location;assert.equal(classifyRequest(target,location),'allow');assert.equal(r2BucketFromUrl(location),target.r2Bucket);
   const pdf=await p.request.get(location,{timeout:30000});assert.equal(pdf.status(),200);const bytes=await pdf.body();assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
   await writeFile(path.join(dir,'commercial-quote.pdf'),bytes);result.pdfSha256=createHash('sha256').update(bytes).digest('hex');
   const pdfText=execFileSync(process.env.PDFTOTEXT_BIN || 'pdftotext',['-layout',path.join(dir,'commercial-quote.pdf'),'-'],{encoding:'utf8'});
   await writeFile(path.join(dir,'commercial-quote.txt'),redactor.text(pdfText));
   assert.ok(pdfText.includes(publicNote),'commercial PDF must include public conditions');
   assert.ok(!pdfText.includes('INTERNO-PRIVADO-'),'commercial PDF must omit internal notes');
   for(const label of ['Impresión A4','Acabado','E2E PIE COMERCIAL','Dirección de prueba','contacto@example.com','Validez y condiciones de prueba'])assert.ok(pdfText.includes(label),'PDF missing '+label);
   result.checks.commercialPdfPrivacy=true;result.checks.commercialPdfLinesAndFooter=true;
   const replay=await call(endpoint,'POST');assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);result.checks.pdfGeneratedInStagingR2=true;result.checks.pdfReplay=true;
   // Anonymous session retains only Vercel automation protection cookie.
   const pw=await import(process.env.PLAYWRIGHT_MODULE!);const anon=await pw.request.newContext();
   try{
    await anon.get(target.baseUrl+'/auth/login',{headers:{'x-vercel-protection-bypass':process.env.VERCEL_AUTOMATION_BYPASS_SECRET!,'x-vercel-set-bypass-cookie':'true'},maxRedirects:0});
    const denied=await anon.get(target.baseUrl+endpoint,{maxRedirects:0});assert.equal(denied.status(),401);result.checks.anonymousPdfDenied=true;
   }finally{await anon.dispose();}
   await h.screenshot('prepared-quote-with-pdf');
   await p.goto(`${target.baseUrl}/quotes/${result.quoteId}/print`);await p.getByText(result.reference,{exact:false}).first().waitFor();
   const printText=await p.locator('body').innerText();assert.ok(!printText.includes('INTERNO-PRIVADO-'));
   await h.screenshot('quote-print-private-note-absent');result.checks.quotePrintPrivacy=true;
   await p.goto(`${target.baseUrl}/quotes/${result.quoteId}`);
  },180000);
  await h.step('sent accepted and converted through UI',async()=>{
   for(const [button,endpoint]of [['Marcar como enviado','send'],['Marcar aceptado','accept']]){
    await p.getByRole('button',{name:button,exact:true}).click();
    await observe('POST',`/api/quotes/${result.quoteId}/${endpoint}`,()=>p.getByRole('dialog').getByRole('button',{name:'Confirmar',exact:true}).click());
   }
   await p.getByRole('button',{name:'Convertir en pedido',exact:true}).click();
   const dialog=p.getByRole('dialog');await dialog.getByRole('button',{name:'Confirmar y crear pedido',exact:true}).waitFor();
   await observe('POST',`/api/quotes/${result.quoteId}/convert`,()=>dialog.getByRole('button',{name:'Confirmar y crear pedido',exact:true}).click());
   await p.getByRole('link',{name:/Abrir pedido/}).waitFor();
   const d=await detail();result.orderId=d.quote.converted_order_id;assert.ok(result.orderId);
   const order=await call('/api/orders/'+result.orderId);assert.equal(order.status,200);const o=order.body.order;
   const collection=await call('/api/orders/'+result.orderId+'/payments');assert.equal(collection.status,200);assert.equal(Number(collection.body.total_amount),66);
   assert.ok(o.notes.includes(publicNote));assert.ok(o.notes.includes('INTERNO-PRIVADO-'+run));assert.ok(o.notes.includes('&lt;interno&gt; &amp; taller'));
   for(const k of ['title','description'])assert.ok(!String(o[k]).includes('INTERNO-PRIVADO-'));
   const replay=await call(`/api/quotes/${result.quoteId}/convert`,'POST',{expected_row_version:d.quote.row_version,store_id:null,service_id:null,assigned_team_member_id:null,priority:'normal',due_at:null});assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.order.id,result.orderId);
   result.orderReference=o.reference;result.checks.conversion=true;result.checks.notesInheritedAndEscaped=true;result.checks.noPrivateNotesInCustomerFields=true;result.checks.conversionReplay=true;
   await p.goto(`${target.baseUrl}/orders/${result.orderId}`);await p.getByText('INTERNO-PRIVADO-'+run,{exact:false}).first().waitFor();await h.screenshot('converted-order-with-internal-notes');
   await p.reload();await p.getByText('INTERNO-PRIVADO-'+run,{exact:false}).first().waitFor();result.checks.orderNotesPersist=true;
   // #160 (SUR4 E2, N6/N18/N23): the work sheet never prints the order notes,
   // private or not; the screen says so, and that notice is never printed.
   await p.goto(`${target.baseUrl}/orders/${result.orderId}/print`);
   const sheet=p.locator('.print-sheet').first();await sheet.waitFor();
   const sheetText=await sheet.innerText();
   assert.ok(sheetText.includes(o.reference),'the sheet is the converted order');
   for(const leak of ['INTERNO-PRIVADO-',publicNote,'<interno>','&lt;interno&gt;','Notas internas'])assert.ok(!sheetText.includes(leak),`work sheet must not print ${leak}`);
   const notice=p.getByRole('status').filter({hasText:'Este pedido tiene notas internas, que no se imprimen.'});
   await notice.waitFor();
   assert.equal(await sheet.locator('.print-notice').count(),0,'the notice is outside the printed sheet');
   await h.screenshot('order-work-sheet-without-notes');
   await p.emulateMedia({media:'print'});
   assert.equal(await notice.isVisible(),false,'the notice is screen-only');
   const printed=await p.locator('body').innerText();
   for(const leak of ['INTERNO-PRIVADO-',publicNote])assert.ok(!printed.includes(leak),`print media must not show ${leak}`);
   await p.emulateMedia({media:'screen'});
   result.checks.workSheetOmitsOrderNotes=true;
  },180000);
  h.assertNoProductionEgress();
  assert.equal(h.blocked.filter(b=>b.url!=='https://vercel.live/_next-live/feedback/feedback.js').length,0);
  result.blockedVercelToolbarRequests=h.blocked.length;result.checks.noProductionEgress=true;
  assertForeignControlsRan(result.checks);result.status='passed';
 }catch(e){result.status='failed';result.error=redactor.text(e instanceof Error?e.message:String(e));console.error(result.error);}
 finally{
  if(footerChanged){try{const r=await call('/api/settings/organization','PATCH',{quote_footer:oldFooter});assert.equal(r.status,200);result.checks.footerRestored=true;}catch(e){result.status='failed';result.footerRestoreError=redactor.text(String(e));}}
  await h.finish(result);console.log(JSON.stringify(result,null,2));console.log('Artifacts: '+dir);
 }
 process.exitCode=result.status==='passed'?0:1;
}
void main();
