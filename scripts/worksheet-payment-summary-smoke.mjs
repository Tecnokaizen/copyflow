/** Offline Chromium/A4 regression: real work sheet model, component and app CSS.
 * No credentials, API server, remote Supabase or SUR4 data are used.
 * PLAYWRIGHT_MODULE points to a separately installed Playwright; outputs go outside Git.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(process.env.SMOKE_OUTPUT_DIR || '/tmp/worksheet-payment-summary-evidence');
await mkdir(out, { recursive: true });
execFileSync(process.execPath, ['node_modules/tailwindcss/lib/cli.js', '-i', 'app/globals.css', '-o', path.join(out, 'app.css')]);
const globalCss = await readFile(path.join(out, 'app.css'), 'utf8');
// Optional local font from next build (Geist latin in the app), embedded offline.
const fontCss = process.env.PRINT_FONT_FILE
  ? `@font-face { font-family: WorkSheetSmoke; src: url(data:font/woff2;base64,${(await readFile(process.env.PRINT_FONT_FILE)).toString('base64')}) format('woff2'); font-weight: 100 900; } .print-document { font-family: WorkSheetSmoke, Arial, sans-serif; }`
  : '';
const fixtures = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
  import { sampleWorkSheetModel, sur4WorkSheetSamples, renderWorkSheetHtml } from './lib/print/work-sheet-samples.ts';
  const base = sur4WorkSheetSamples()[0];
  const cases = [];
  for (const profile of ['standard', 'ficha']) {
    for (const [name, amounts] of [
      ['parcial', { total: '1250.25', paid: '250.10', pending: '1000.15' }],
      ['sin-anticipo', { total: '120.00', paid: '0.00', pending: '120.00' }],
      ['pagado', { total: '120.00', paid: '120.00', pending: '0.00' }],
    ]) {
      const variant = { ...base, input: { ...base.input, amounts } };
      const model = sampleWorkSheetModel(variant, { customLabels: false, stickyNotes: true, workSequence: true, workSheetFicha: profile === 'ficha' });
      cases.push({ name: profile + '-' + name, profile, amounts: model.amounts, html: renderWorkSheetHtml(model, { legacyNotes: true }) });
    }
  }
  const full = sampleWorkSheetModel(sur4WorkSheetSamples().at(-1));
  cases.push({ name: 'ficha-a4-completo', profile: 'ficha', amounts: full.amounts, html: renderWorkSheetHtml(full) });
  console.log(JSON.stringify(cases));
`], { maxBuffer: 8 * 1024 * 1024 }).toString());
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
const results = [];
try {
  for (const fixture of fixtures) for (const theme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, colorScheme: theme });
    // Any external request is a test failure: this suite is entirely offline.
    await page.route('**/*', route => { throw new Error(`Unexpected network request: ${route.request().url()}`); });
    const html = fixture.html.replace('<html lang="es">', `<html lang="es" class="${theme === 'dark' ? 'dark' : ''}">`)
      .replace('<style>', `<style>${globalCss}</style><style>`)
      .replace('</head>', `<style>${fontCss}</style></head>`);
    await writeFile(path.join(out, `${fixture.name}-${theme}.html`), html);
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    const checkLayout = async (sideBySide) => {
      const layout = await page.evaluate(() => {
        const title = document.querySelector('.ws-title-summary h1').getBoundingClientRect();
        const summary = document.querySelector('.ws-summary').getBoundingClientRect();
        const sheet = document.querySelector('.print-sheet');
        const facts = [...document.querySelectorAll('.ws-summary .print-fact')];
        return {
          title: { x: title.x, y: title.y, right: title.right, bottom: title.bottom },
          summary: { x: summary.x, y: summary.y },
          overflow: document.documentElement.scrollWidth > innerWidth,
          background: getComputedStyle(sheet).backgroundColor,
          foreground: getComputedStyle(sheet).color,
          rows: facts.map(row => ({
            border: getComputedStyle(row).borderBottomWidth,
            clipped: row.scrollWidth > row.clientWidth + 1,
            labelColor: getComputedStyle(row.querySelector('dt')).color,
            amountColor: getComputedStyle(row.querySelector('dd')).color,
          })),
        };
      });
      assert.equal(layout.overflow, false, `${fixture.name} ${theme}: no overflow`);
      assert.equal(layout.background, 'rgb(255, 255, 255)');
      assert.equal(layout.foreground, 'rgb(17, 17, 17)');
      assert.equal(layout.rows.length, 3);
      assert.ok(layout.rows.every(row => row.border === '1px' && !row.clipped && row.labelColor === 'rgb(51, 51, 51)' && row.amountColor === 'rgb(17, 17, 17)'));
      if (sideBySide) {
        assert.ok(layout.title.right <= layout.summary.x);
        assert.ok(Math.abs(layout.title.y - layout.summary.y) < 1);
      } else assert.ok(layout.summary.y >= layout.title.bottom);
    };
    assert.equal(await page.getByRole('region', { name: 'Resumen económico' }).count(), 1);
    for (const fact of fixture.amounts) {
      assert.equal(await page.locator('.ws-summary dt').getByText(fact.label, { exact: true }).count(), 1);
    }
    await checkLayout(true);
    await page.screenshot({ path: path.join(out, `${fixture.name}-${theme}.png`), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await checkLayout(false);
    // Print at a narrow viewport too: screen-only stacking must not affect A4.
    await page.emulateMedia({ media: 'print' });
    await checkLayout(true);
    assert.equal(await page.locator('.print-toolbar').isVisible(), false);
    assert.equal(await page.locator('.print-notice').isVisible(), false);
    const pdfPath = path.join(out, `${fixture.name}-${theme}.pdf`);
    const bytes = await page.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    const pdf = await PDFDocument.load(bytes);
    const dimensions = pdf.getPage(0).getSize();
    assert.ok(Math.abs(dimensions.width - 595.28) < 1 && Math.abs(dimensions.height - 841.89) < 1, 'A4 dimensions');
    assert.equal(pdf.getPageCount(), 1, `${fixture.name} ${theme}: fits one A4`);
    const text = execFileSync('pdftotext', ['-layout', pdfPath, '-']).toString();
    const normalize = text => text.replace(/\s+/g, ' ').trim();
    for (const fact of fixture.amounts) {
      assert.equal(text.split(fact.label).length - 1, 1, `${fact.label} printed once`);
      assert.ok(normalize(text).includes(`${fact.label} ${fact.value}`), `${fact.label} and EUR value on same line`);
    }
    assert.ok(text.includes('15/10/2026') && text.includes('30/10/2026'), 'Reception and delivery dates retained');
    if (fixture.name === 'ficha-a4-completo') {
      for (let line = 1; line <= 15; line++) assert.ok(text.includes(`Línea ${line}:`));
      for (const content of ['Impresión', 'Encuadernación', 'Revisión', 'LE TOCA',
        'Revisar el lomo antes de encolar.', 'El cliente recoge por la tarde.', 'Usar la tela del lote nuevo.',
        'Dorado en la portada y en el lomo.', 'Embalar de cinco en cinco.']) assert.ok(text.includes(content));
    }
    assert.equal(text.includes('Este pedido tiene notas internas'), false);
    assert.equal(/Imprimir|Cerrar/.test(text), false, 'Toolbar absent from PDF');
    results.push({ sample: fixture.name, theme, pages: pdf.getPageCount(), a4: dimensions, passed: true });
    await page.close();
  }
  await writeFile(path.join(out, 'results.json'), JSON.stringify({ offline: true, productionData: false, font: process.env.PRINT_FONT_FILE ? path.basename(process.env.PRINT_FONT_FILE) : "system fallback", checks: results }, null, 2));
  console.log(`PASS: ${results.length} desktop/mobile/print cases; ${results.length} single-page A4 PDFs. Evidence: ${out}`);
} finally {
  await browser.close();
}
