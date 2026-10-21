/**
 * Order text sizes and colors in a real browser: the shared Tiptap editor as the
 * order forms mount it, the server sanitizer between save and reload, the order
 * view, the print block, dark mode and a 390 px phone. No network, no credentials.
 *
 *   PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs node scripts/order-rich-text-ui-smoke.mjs
 *
 * ORDER_RICH_TEXT_SHOTS=<dir> keeps the screenshots (light/dark, desktop/phone, menus).
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = process.cwd();
const out = await mkdtemp(path.join(tmpdir(), 'order-rich-text-ui-'));
const shots = process.env.ORDER_RICH_TEXT_SHOTS || out;
await mkdir(shots, { recursive: true });

await build({
  stdin: {
    contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { RichTextEditor } from './components/rich-text/rich-text-editor';
      import { RichTextContent } from './components/rich-text/rich-text-content';
      import { PrintRichText } from './components/print/print-frame';
      import { normalizeRichText, persistRichText } from './lib/rich-text/html';
      import { ORDER_RICH_TEXT } from './lib/orders/rich-text';
      // "Saving" runs the same sanitizer as the API; "reloading" remounts with the stored value.
      const stored = sessionStorage.getItem('stored') ?? '';
      window.normalizeOrder = (html) => normalizeRichText(html, ORDER_RICH_TEXT);
      function App() {
        const [value, setValue] = useState(stored);
        const [saved, setSaved] = useState(stored || null);
        const [basic, setBasic] = useState('');
        window.current = { value, basic };
        return (
          <main className="mx-auto grid max-w-3xl gap-4 p-4 text-foreground">
            <section className="grid gap-2 text-sm font-medium">Instrucciones
              <RichTextEditor ariaLabel="Instrucciones" textStyles value={value} onChange={setValue} />
            </section>
            <button type="button" className="gc-action" onClick={() => {
              const next = persistRichText(value, ORDER_RICH_TEXT);
              sessionStorage.setItem('stored', next ?? '');
              setSaved(next);
            }}>Guardar</button>
            <section data-testid="view" className="gc-card bg-card p-4">
              <RichTextContent value={saved} textStyles className="gc-fact-value text-base font-medium leading-relaxed" />
            </section>
            <section className="grid gap-2 text-sm font-medium">Pie de presupuesto
              <RichTextEditor ariaLabel="Pie" value={basic} onChange={setBasic} />
            </section>
            <section className="grid gap-2 text-sm font-medium">Bloqueado
              <RichTextEditor ariaLabel="Bloqueado" textStyles disabled value="<p>Solo lectura</p>" onChange={() => undefined} />
            </section>
            <div className="print-document" data-testid="print"><article className="print-sheet">
              <PrintRichText title="Instrucciones" value={saved} textStyles />
            </article></div>
          </main>
        );
      }
      createRoot(document.getElementById('root')).render(<App />);`,
    resolveDir: root,
    loader: 'tsx',
  },
  jsx: 'automatic', tsconfig: path.join(root, 'tsconfig.json'), bundle: true, outfile: path.join(out, 'app.js'), platform: 'browser',
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
  logLevel: 'error',
});
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'app/globals.css', '-o', path.join(out, 'style.css')], { cwd: root, stdio: 'pipe' });
const css = (await readFile(path.join(out, 'style.css'), 'utf8')) + (await readFile(path.join(root, 'components/print/print.css'), 'utf8'));

const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  if (name === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(path.join(out, 'app.js'))); }
  else if (name === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); }
  else { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/style.css"><body><div id="root"></div><script src="/app.js"></script></body></html>'); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;

// Select `word` inside the editor labelled `label` through the DOM, as a mouse drag would.
async function select(page, label, word) {
  await page.evaluate(([label, word]) => {
    const editor = document.querySelector(`[aria-label="${label}"]`);
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.data.indexOf(word);
      if (at >= 0) {
        editor.focus();
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + word.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return;
      }
    }
    throw new Error(`text not found: ${word}`);
  }, [label, word]);
  await page.waitForTimeout(50);
}

async function choose(page, menu, option) {
  await page.getByRole('button', { name: new RegExp(`^${menu}:`) }).first().click();
  await page.getByRole('menuitemradio', { name: option, exact: true }).click();
  await page.waitForTimeout(50);
}

// Style of the element that directly wraps `word` in `scope`.
async function styleOf(page, scope, word) {
  return page.evaluate(([scope, word]) => {
    const container = document.querySelector(scope);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.data.includes(word)) {
        const element = node.parentElement;
        const style = getComputedStyle(element);
        let background = 'rgba(0, 0, 0, 0)';
        for (let el = element; el && background === 'rgba(0, 0, 0, 0)'; el = el.parentElement) background = getComputedStyle(el).backgroundColor;
        const base = getComputedStyle(container.querySelector('p') ?? container).fontSize;
        return { color: style.color, fontSize: parseFloat(style.fontSize), baseSize: parseFloat(base), background };
      }
    }
    return null;
  }, [scope, word]);
}

function contrast(a, b) {
  const lum = (rgb) => {
    const [r, g, bl] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const tokenColor = (page, name, scope = 'body') => page.evaluate(([name, scope]) => {
  const probe = document.createElement('span');
  probe.style.color = `hsl(var(--gc-text-${name}))`;
  document.querySelector(scope).appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}, [name, scope]);

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1100 } });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(url);
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    const editor = page.getByLabel('Instrucciones', { exact: true }).and(page.locator('[contenteditable]'));
    await editor.click();
    await page.keyboard.type('Urgente revisar sangrado y papel');

    // Mouse: size and color on one word.
    await select(page, 'Instrucciones', 'Urgente');
    await choose(page, 'Tamaño del texto', 'Muy grande');
    await select(page, 'Instrucciones', 'Urgente');
    await choose(page, 'Color del texto', 'Rojo');
    await select(page, 'Instrucciones', 'Urgente');
    await page.getByRole('button', { name: 'Tamaño del texto: Muy grande' }).waitFor();
    await page.getByRole('button', { name: 'Color del texto: Rojo' }).waitFor();
    if (width === 1280) {
      await page.getByRole('button', { name: /^Color del texto:/ }).first().click();
      await page.getByRole('menuitemradio', { name: 'Rojo' }).waitFor();
      assert.equal(await page.getByRole('menuitemradio', { name: 'Rojo' }).getAttribute('aria-checked'), 'true');
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shots, 'menu-color-light.png') });
      await page.keyboard.press('Escape');
    }

    // Keyboard only: focus the trigger, open with Enter, move with arrows, pick with Enter.
    // The pointer rests away from the menu (Radix menus follow the pointer).
    await page.mouse.move(width - 5, 1095);
    await select(page, 'Instrucciones', 'sangrado');
    await page.getByRole('button', { name: /^Color del texto:/ }).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    await page.waitForTimeout(300); // let the menu finish opening, as a person would
    for (let i = 0; i < 6 && !(await page.evaluate(() => document.activeElement?.textContent?.includes('Verde'))); i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(80);
    }
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('role')), 'menuitemradio');
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Instrucciones', 'focus returns to the text');
    // Escape closes without changes and returns focus to the menu button.
    await page.getByRole('button', { name: /^Tamaño del texto:/ }).first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('menu').waitFor();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'detached' });
    assert.match(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''), /^Tamaño del texto:/);
    await select(page, 'Instrucciones', 'papel');
    await choose(page, 'Tamaño del texto', 'Pequeño');
    // With no selection the choice applies to what is typed next.
    await editor.click();
    await page.keyboard.press('End');
    await choose(page, 'Color del texto', 'Azul');
    await page.keyboard.type(' fin');
    assert.match(await page.evaluate(() => window.current.value), /<span data-text-color="blue"> fin<\/span>/);
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');

    const typed = await page.evaluate(() => window.current.value);
    const doc = await page.evaluate((html) => {
      const box = document.createElement('div'); box.innerHTML = html;
      const wrap = (word) => [...box.querySelectorAll('span')].filter((span) => span.textContent === word).flatMap((span) => [...span.attributes].map((a) => `${a.name}=${a.value}`)).sort();
      return { urgente: wrap('Urgente'), sangrado: wrap('sangrado'), papel: wrap('papel'), text: box.textContent };
    }, typed);
    assert.deepEqual(doc.urgente, ['data-text-color=red', 'data-text-size=xlarge']);
    assert.deepEqual(doc.sangrado, ['data-text-color=green']);
    assert.deepEqual(doc.papel, ['data-text-size=small']);
    assert.equal(doc.text, 'Urgente revisar sangrado y papel');
    assert.equal(/style=|class=/.test(typed), false, typed);

    // Save (server sanitizer) and render the order view.
    await page.getByRole('button', { name: 'Guardar' }).click();
    const saved = await page.evaluate(() => sessionStorage.getItem('stored'));
    assert.equal(saved, await page.evaluate((html) => window.normalizeOrder(html), typed));
    const red = await styleOf(page, '[data-testid="view"]', 'Urgente');
    assert.equal(red.color, await tokenColor(page, 'red'));
    assert.ok(Math.abs(red.fontSize / red.baseSize - 1.5) < 0.01, `xlarge ${red.fontSize}/${red.baseSize}`);
    assert.ok(contrast(red.color, red.background) >= 4.5, `light contrast ${contrast(red.color, red.background)}`);
    const small = await styleOf(page, '[data-testid="view"]', 'papel');
    assert.ok(Math.abs(small.fontSize / small.baseSize - 0.875) < 0.01);
    await page.screenshot({ path: path.join(shots, `order-light-${width}.png`), fullPage: true });

    // Reload: the stored HTML comes back identical in the editor and in the view.
    await page.reload();
    await editor.waitFor();
    assert.equal(await page.evaluate(() => window.normalizeOrder(document.querySelector('[aria-label="Instrucciones"]').innerHTML)), saved);
    assert.equal((await styleOf(page, '[data-testid="view"]', 'sangrado')).color, await tokenColor(page, 'green'));

    // Edit after reload: default color keeps the size; normal size removes the last token.
    await select(page, 'Instrucciones', 'Urgente');
    await choose(page, 'Color del texto', 'Predeterminado');
    let value = await page.evaluate(() => window.current.value);
    assert.match(value, /<span data-text-size="xlarge">Urgente<\/span>/);
    await select(page, 'Instrucciones', 'Urgente');
    await choose(page, 'Tamaño del texto', 'Normal');
    value = await page.evaluate(() => window.current.value);
    assert.equal(value.includes('Urgente</span>'), false, value);
    // "Quitar formato" resets size and color together.
    await select(page, 'Instrucciones', 'sangrado');
    await page.getByRole('button', { name: 'Quitar formato' }).first().click();
    value = await page.evaluate(() => window.current.value);
    assert.equal(value.includes('sangrado</span>'), false, value);
    assert.match(value, /<span data-text-size="small">papel<\/span>/);
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.reload();
    await editor.waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('stored')), await page.evaluate(() => window.normalizeOrder(document.querySelector('[aria-label="Instrucciones"]').innerHTML)));

    // Paste: tokens survive between order fields, foreign CSS does not; the basic editor strips both.
    const pasted = '<p><span data-text-color="blue" style="font-size:40px;color:#000">Pegado</span> <span style="color:red;font-size:30px">Word</span></p>';
    for (const label of ['Instrucciones', 'Pie']) {
      await page.getByLabel(label, { exact: true }).and(page.locator('[contenteditable]')).click();
      await page.keyboard.press('End');
      await page.evaluate(([label, html]) => {
        const data = new DataTransfer();
        data.setData('text/html', html);
        data.setData('text/plain', 'Pegado Word');
        document.querySelector(`[aria-label="${label}"]`).dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, [label, pasted]);
      await page.waitForTimeout(50);
    }
    const afterPaste = await page.evaluate(() => window.current);
    assert.match(afterPaste.value, /<span data-text-color="blue">Pegado<\/span> Word/);
    assert.equal(/font-size|color:|style=/.test(afterPaste.value), false, afterPaste.value);
    assert.equal(afterPaste.basic.includes('data-text-'), false, afterPaste.basic);
    assert.match(afterPaste.basic, /Pegado Word/);
    assert.equal(await page.getByRole('button', { name: /^Tamaño del texto:/ }).count(), 2, 'menus only in the order editors');

    // Locked editor: menus disabled.
    for (const trigger of await page.getByRole('button', { name: /^(Tamaño|Color) del texto:/ }).all()) {
      const locked = await trigger.evaluate((el) => !!el.closest('[data-disabled="true"]'));
      if (locked) assert.equal(await trigger.isDisabled(), true);
    }

    // Dark mode: lighter tones on the dark surfaces; print stays on the light palette.
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await select(page, 'Instrucciones', 'Pegado');
    const darkView = await styleOf(page, '[data-testid="view"]', 'Pegado');
    assert.equal(darkView.color, await tokenColor(page, 'blue'));
    assert.ok(contrast(darkView.color, darkView.background) >= 4.5, `dark contrast ${contrast(darkView.color, darkView.background)}`);
    const darkEditor = await styleOf(page, '[aria-label="Instrucciones"]', 'Pegado');
    assert.ok(contrast(darkEditor.color, darkEditor.background) >= 4.5, `dark editor contrast ${contrast(darkEditor.color, darkEditor.background)}`);
    const printed = await styleOf(page, '[data-testid="print"]', 'Pegado');
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    assert.equal(printed.color, await tokenColor(page, 'blue'), 'print keeps the light color in dark mode');
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    assert.ok(contrast(printed.color, printed.background) >= 4.5);
    await page.screenshot({ path: path.join(shots, `order-dark-${width}.png`), fullPage: true });
    if (width === 390) {
      await page.getByRole('button', { name: /^Color del texto:/ }).first().click();
      const box = await page.getByRole('menu').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= 390, `menu inside the phone viewport ${JSON.stringify(box)}`);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(shots, 'menu-color-dark-390.png') });
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => document.documentElement.classList.remove('dark'));

    // No horizontal page scroll; the toolbar scrolls inside its frame.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'page overflows horizontally');
    assert.deepEqual(errors, []);
    results.push({ width, passed: true });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(JSON.stringify({ results, screenshots: shots }, null, 2));
