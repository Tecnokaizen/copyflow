/** Real OrdersPage and navigation, deterministic HTTP doubles. No credentials or production writes. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = process.cwd();
const out = await mkdtemp(path.join(tmpdir(), 'tamara-orders-ui-'));
await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import OrdersPage from './app/orders/page'; createRoot(document.getElementById('root')).render(<OrdersPage/>);`, resolveDir: root, loader: 'tsx' },
  jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser',
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'next-browser-boundary', setup(api) {
    api.onResolve({ filter: /^next\/(navigation|link)$/ }, ({path}) => ({ path, namespace: 'test-next' }));
    api.onLoad({ filter: /.*/, namespace: 'test-next' }, ({path: module}) => ({ contents: module.endsWith('navigation')
      ? `import {useSyncExternalStore} from 'react';
        const subscribe=cb=>{window.addEventListener('popstate',cb);return()=>window.removeEventListener('popstate',cb)};
        export const useSearchParams=()=>new URLSearchParams(useSyncExternalStore(subscribe,()=>location.search));
        export const usePathname=()=>'/orders';
        export const useRouter=()=>({push:url=>{window.lastNavigation=url},replace:url=>{history.replaceState(null,'',url);window.dispatchEvent(new PopStateEvent('popstate'))}});`
      : `import React from 'react';export default function Link({href,children,prefetch,...props}) {return React.createElement('a',{...props,href},children)}`,
      resolveDir: root }));
  }}],
});
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js','-i','app/globals.css','-o',path.join(out,'style.css')], {cwd:root,stdio:'pipe'});
const server=createServer(async(req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  if(['/app.js','/style.css'].includes(name)) {res.setHeader('Content-Type',name.endsWith('js')?'text/javascript':'text/css');res.end(await readFile(path.join(out,name.slice(1))));}
  else {res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script>');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});
const member='ea460000-0000-4000-8000-000000000031';
const status='ea460000-0000-4000-8000-000000000041';
const store='ea460000-0000-4000-8000-000000000051';
const weekdays=['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11'];
const order=(id,due)=>({id,reference:`DEMO-${id}`,title:`Trabajo ${id}`,due_at:due,priority:'urgent',archived_at:null,client:{name:'Cliente de prueba'},assigned_team_member:{id:member,name:'Personal'},status:{name:'Recibido',code:'received',is_ready:false,is_closed:false,is_cancelled:false},entry_channel:{name:'Mostrador'},store:{name:'Centro'},service:{id:'service',name:'Impresión'}});
const results=[];
try {
  for(const width of [390,1280]) {
    const page=await browser.newPage({viewport:{width,height:1000}});
    page.setDefaultTimeout(10000);
    const errors=[];const requests=[];let sunday=true;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',route=>{
      const u=new URL(route.request().url());
      const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      if(u.pathname==='/api/context')return json({membership:{role:'staff'},user:{full_name:'Personal'},tenant:{name:'Demo',slug:'demo'},features:{quotes:true}});
      if(u.pathname==='/api/team')return json({members:[{id:member,name:'Personal'}]});
      if(u.pathname==='/api/stores')return json({stores:[{id:store,name:'Centro'}]});
      if(u.pathname==='/api/order-statuses')return json({statuses:[{id:status,name:'Recibido',is_closed:false,is_cancelled:false,sort_order:1}]});
      if(u.pathname==='/api/orders') {
        requests.push(u.searchParams.toString());
        const orders=u.searchParams.has('week_start')||u.searchParams.has('from')
          ? [order('sábado','2026-10-10T10:00:00Z'),...(sunday?[order('domingo','2026-10-11T08:00:00Z')]:[])]
          : [order('lista','2026-10-09T10:00:00Z')];
        return json({tenant:'demo',orders,total:orders.length,all_total:orders.length,count:orders.length,page:1,page_size:50,timezone:'Europe/Madrid',local_date:'2026-10-09',now:'2026-10-09T08:00:00Z',week_start:'2026-10-05',week_days:weekdays});
      }
      return json({});
    });
    await page.goto(`${url}/orders?view=list&filter=all&assigned_team_member_id=${member}&status_id=${status}&store_id=${store}&sort=due_at&dir=asc`);
    // No layout= parameter: Cuadrícula is the default, on desktop and mobile.
    await page.getByLabel('Pedidos en cuadrícula',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Cuadrícula',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByRole('link',{name:'Trabajo lista',exact:true}).waitFor();
    if (width < 768) await page.getByRole('button',{name:'Menú',exact:true}).click();
    await page.getByRole('link',{name:'Inicio',exact:true}).waitFor();
    if (width < 768) {
      await page.getByRole('link',{name:'Calendario',exact:true}).waitFor();
      assert.equal(await page.getByRole('link',{name:'Configuración',exact:true}).count(),0);
      await page.getByRole('button',{name:'Menú',exact:true}).click();
    }
    const before=requests.at(-1);
    await page.getByLabel('Buscar',{exact:true}).fill('Trabajo');
    await page.waitForFunction(()=>document.querySelector('input[type=search]')?.value==='Trabajo');
    await page.waitForTimeout(450);
    const beforeGrid=requests.at(-1);
    assert.ok(beforeGrid.includes('q=Trabajo'));
    await page.getByRole('button',{name:'Cuadrícula',exact:true}).click();
    await page.getByLabel('Pedidos en cuadrícula',{exact:true}).waitFor();
    assert.equal(await page.getByLabel('Buscar',{exact:true}).inputValue(),'Trabajo');
    assert.equal(requests.at(-1),beforeGrid,'presentation keeps API query');
    const params=new URL(page.url()).searchParams;
    for(const [key,value] of [['filter','all'],['assigned_team_member_id',member],['status_id',status],['store_id',store],['sort','due_at'],['dir','asc']])assert.equal(params.get(key),value);
    assert.equal(await page.getByRole('button',{name:'Cuadrícula',exact:true}).getAttribute('aria-pressed'),'true');
    await page.getByLabel('Ordenar tarjetas',{exact:true}).selectOption('due_at:desc');
    await page.waitForFunction(()=>location.search.includes('dir=desc'));
    await page.getByRole('group',{name:'Presentación de pedidos',exact:true}).getByRole('button',{name:'Lista',exact:true}).click();
    await page.getByRole('table').waitFor();
    assert.equal(await page.getByLabel('Buscar',{exact:true}).inputValue(),'Trabajo');
    await page.getByRole('button',{name:'Calendario',exact:true}).click();
    await page.getByRole('heading',{name:'Domingo · 1 entregas',exact:true}).waitFor();
    assert.equal(await page.locator('section').filter({hasText:/Sin entregas/}).count(),5);
    assert.equal(await page.locator('section h2').filter({hasText:/^(lun|mar|mié|jue|vie|sáb)/}).count(),6);
    assert.equal(await page.getByRole('link',{name:/Trabajo domingo/}).count(),1);
    assert.equal(await page.getByRole('link',{name:/Trabajo sábado/}).count(),1);
    assert.ok(requests.at(-1).includes(`assigned_team_member_id=${member}`));
    sunday=false;
    await page.getByRole('button',{name:'Semana siguiente',exact:true}).click();
    await page.getByLabel('Entregas del domingo',{exact:true}).waitFor({state:'hidden'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal overflow');
    const shot=path.join(out,`calendar-${width}.png`);await page.screenshot({path:shot,fullPage:true});
    assert.deepEqual(errors,[]);
    results.push({width,passed:true,screenshot:shot,initialQuery:before});await page.close();
  }
  console.log(JSON.stringify({results},null,2));
} finally {await browser.close();server.close();}
