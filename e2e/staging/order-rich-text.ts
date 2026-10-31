/** Staging: order instructions and internal notes keep text sizes, colors and
 * paragraph alignment (SUR4 request), through the real UI, API and database of Staging.
 * Synthetic `e2e` tenant only, through the existing guard and harness.
 *
 * 1. Every existing `e2e` order renders exactly as the previous code did.
 * 2. Full and quick creation with styles chosen in the toolbar.
 * 3. Detail view, edit after reload, "Añadir nota", print (notes never
 *    printed, SUR4 E2), dark mode, 390 px.
 * 4. Forged HTML is sanitized by the server; a foreign tenant's order is denied;
 *    quotes keep the basic vocabulary.
 *
 * Adds orders, notes and one acknowledged quote draft to `e2e`; changes nothing else.
 *
 *   set -a; source .env.e2e.local; set +a
 *   PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs npx tsx e2e/staging/order-rich-text.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded at runtime, outside package.json. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { normalizeRichText } from "../../lib/rich-text/html";
import { ORDER_RICH_TEXT } from "../../lib/orders/rich-text";
import { resolveStagingTarget } from "./guard";
import { Harness } from "./harness";
import { Redactor } from "./redact";
import { requireSyntheticEmail, runId } from "./synthetic";

/** DEMO-0001, the only order of the Staging `demo` tenant (synthetic), verified by SQL on 21/10/2026. */
const FOREIGN_ORDER = { tenantSlug: "demo", id: "e05d5aaa-8bc5-4cb4-a3f8-90db422c4850", reference: "DEMO-0001" };
const FORGED =
  '<p data-text-align="center" style="text-align:right;position:fixed"><span data-text-size="xlarge" data-text-color="red" style="position:fixed;inset:0" onmouseover="alert(1)">NO CORTAR</span>' +
  '<span data-text-color="url(javascript:alert(1))">x</span><img src=x onerror=alert(1)><script>alert(1)</script></p>' +
  '<p data-text-align="right;background:url(https://x.test/a.png)">y</p><p align="justify" data-text-align="left">z</p>';
const CLEAN = '<p data-text-align="center"><span data-text-size="xlarge" data-text-color="red">NO CORTAR</span>x</p><p>y</p><p>z</p>';

const editor = (label: string) => `[contenteditable][aria-label="${label}"]`;

async function main() {
  const target = resolveStagingTarget();
  requireSyntheticEmail(process.env.E2E_USER_EMAIL);
  assert.ok(process.env.E2E_USER_PASSWORD, "E2E_USER_PASSWORD is required");
  const run = runId();
  const dir = path.join(process.env.E2E_ARTIFACTS_DIR ?? "e2e-artifacts", "order-rich-text-" + run);
  const redactor = new Redactor([process.env.E2E_USER_PASSWORD, process.env.VERCEL_AUTOMATION_BYPASS_SECRET]);
  const h = new Harness(target, redactor, dir, process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  const result: any = { run, baseUrl: target.baseUrl, deploymentSha: process.env.E2E_DEPLOYMENT_SHA ?? null, checks: {}, orders: {} };
  let p: any;

  async function call(url: string, method = "GET", data?: unknown) {
    assert.ok(url.startsWith("/api/"));
    const r = await p.request.fetch(target.baseUrl + url, { method, data, timeout: 60000, maxRedirects: 0 });
    const text = await r.text(); let body: any; try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 300) }; }
    return { status: r.status(), body };
  }

  /** Select `word` in an editor through the DOM, as a mouse drag would. */
  async function select(label: string, word: string) {
    await p.evaluate(([selector, word]: string[]) => {
      const root = document.querySelector(selector) as HTMLElement;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
        const at = node.data.indexOf(word);
        if (at < 0) continue;
        root.focus();
        const range = document.createRange();
        range.setStart(node, at); range.setEnd(node, at + word.length);
        getSelection()!.removeAllRanges(); getSelection()!.addRange(range);
        return;
      }
      throw new Error(`text not found in ${selector}: ${word}`);
    }, [editor(label), word]);
    await p.waitForTimeout(80);
  }

  /** Pick an option from the size or color menu of one editor's toolbar. */
  async function choose(label: string, menu: "Tamaño del texto" | "Color del texto" | "Alineación", option: string) {
    const frame = p.locator("[data-disabled]").filter({ has: p.locator(editor(label)) });
    await frame.getByRole("button", { name: new RegExp(`^${menu}:`) }).click();
    await p.getByRole("menuitemradio", { name: option, exact: true }).click();
    await p.getByRole("menu").waitFor({ state: "detached" });
  }

  async function typeInto(label: string, text: string) {
    await p.locator(editor(label)).click();
    await p.keyboard.type(text);
  }

  /** Attributes of the spans that wrap exactly `word`, sorted. */
  async function stylesOf(html: string, word: string) {
    return p.evaluate(([html, word]: string[]) => {
      const box = document.createElement("div"); box.innerHTML = html;
      return [...box.querySelectorAll("span")].filter((span) => span.textContent === word)
        .flatMap((span) => [...span.attributes].map((a) => `${a.name}=${a.value}`)).sort();
    }, [html, word]);
  }

  /** Computed text-align of the paragraph that holds `word` inside `scope`. */
  async function alignOf(scope: string, word: string) {
    return p.evaluate(([scope, word]: string[]) => {
      const paragraph = [...document.querySelector(scope)!.querySelectorAll("p")].find((el) => el.textContent?.includes(word));
      return paragraph ? getComputedStyle(paragraph).textAlign : null;
    }, [scope, word]);
  }

  /** `data-text-align` of the stored paragraph that holds `word` (null: left). */
  async function storedAlign(html: string, word: string) {
    return p.evaluate(([html, word]: string[]) => {
      const box = document.createElement("div"); box.innerHTML = html;
      return [...box.querySelectorAll("p")].find((el) => el.textContent?.includes(word))?.getAttribute("data-text-align") ?? null;
    }, [html, word]);
  }

  /** Rendered Instrucciones / Notas internas HTML on the order detail (null: empty state). */
  async function renderedContent() {
    return p.evaluate(() => {
      const label = [...document.querySelectorAll(".gc-fact-label")].find((e) => e.textContent?.trim() === "Instrucciones:");
      const desc = label?.nextElementSibling as HTMLElement | undefined;
      const card = [...document.querySelectorAll("section.gc-card")].find((s) => s.querySelector("h2")?.textContent === "Notas internas");
      const notes = card?.lastElementChild?.firstElementChild as HTMLElement | undefined;
      return {
        description: desc && desc.tagName === "DIV" ? desc.innerHTML : null,
        notes: notes && notes.tagName === "DIV" ? notes.innerHTML : null,
      };
    });
  }

  /** The browser's serialization of an HTML string, to compare with rendered innerHTML. */
  const canonical = (html: string) => p.evaluate((html: string) => { const box = document.createElement("div"); box.innerHTML = html; return box.innerHTML; }, html);

  async function computed(scope: string, word: string) {
    return p.evaluate(([scope, word]: string[]) => {
      const container = document.querySelector(scope)!;
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node as Text).data.includes(word)) continue;
        const element = node.parentElement!;
        let background = "rgba(0, 0, 0, 0)";
        for (let el: HTMLElement | null = element; el && background === "rgba(0, 0, 0, 0)"; el = el.parentElement) background = getComputedStyle(el).backgroundColor;
        const paragraph = element.closest("p, li") as HTMLElement;
        return { color: getComputedStyle(element).color, size: parseFloat(getComputedStyle(element).fontSize), base: parseFloat(getComputedStyle(paragraph).fontSize), background };
      }
      return null;
    }, [scope, word]);
  }

  const tokenColor = (name: string, scope = "body") => p.evaluate(([name, scope]: string[]) => {
    const probe = document.createElement("span"); probe.style.color = `hsl(var(--gc-text-${name}))`;
    document.querySelector(scope)!.appendChild(probe); const color = getComputedStyle(probe).color; probe.remove(); return color;
  }, [name, scope]);

  function contrast(a: string, b: string) {
    const lum = (rgb: string) => {
      const [r, g, bl] = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return Math.round(((x + 0.05) / (y + 0.05)) * 100) / 100;
  }

  async function openDetail(id: string) {
    await p.goto(`${target.baseUrl}/orders/${id}`);
    await p.locator(".gc-fact-label", { hasText: "Instrucciones:" }).first().waitFor({ timeout: 30000 });
  }

  async function setTheme(theme: "light" | "dark") {
    await p.evaluate((theme: string) => localStorage.setItem("gestcopy-theme", theme), theme);
  }

  try {
    await h.start(process.env.PLAYWRIGHT_MODULE!); p = h.page;
    await h.step("login and tenant gate", async () => {
      await p.goto(target.baseUrl + "/auth/login");
      await p.locator("#email").fill(process.env.E2E_USER_EMAIL!); await p.locator("#password").fill(process.env.E2E_USER_PASSWORD!);
      await Promise.all([p.waitForURL((u: URL) => u.origin === target.baseUrl && !u.pathname.startsWith("/auth/")), p.getByRole("button", { name: "Login", exact: true }).click()]);
      const c = await call("/api/context"); assert.equal(c.status, 200); assert.equal(c.body.tenant.slug, "e2e");
      await setTheme("light");
      result.checks.tenantE2E = true;
    });

    await h.step("existing orders render exactly as before", async () => {
      const list = await call("/api/orders?filter=all&page_size=100"); assert.equal(list.status, 200);
      let checked = 0, withContent = 0, fromEarlierRuns = 0;
      for (const row of list.body.orders as any[]) {
        const detail = await call(`/api/orders/${row.id}`); assert.equal(detail.status, 200);
        const order = detail.body.order;
        if (!order.description && !order.notes) continue;
        withContent++;
        const styled = `${order.description ?? ""}${order.notes ?? ""}`.includes("data-text-");
        if (styled) {
          // Only orders this script created on an earlier run may carry tokens.
          const ownOrder = order.title?.startsWith("E2E Formato ") || order.title?.startsWith("Urgente: plastificar ");
          assert.ok(ownOrder, `${order.reference}: tokens in an order this E2E did not create`);
          fromEarlierRuns++;
        } else {
          for (const field of ["description", "notes"] as const) {
            const raw = order[field] ?? "";
            assert.equal(normalizeRichText(raw, ORDER_RICH_TEXT), normalizeRichText(raw), `${order.reference} ${field}: same canonical HTML`);
          }
        }
        await openDetail(row.id);
        const shown = await renderedContent();
        for (const field of ["description", "notes"] as const) {
          // Historical orders: what the previous code rendered. Earlier E2E orders: their styles.
          const expected = styled ? normalizeRichText(order[field], ORDER_RICH_TEXT) : normalizeRichText(order[field]);
          assert.equal(shown[field], expected ? await canonical(expected) : null, `${order.reference} ${field}: rendered as expected`);
        }
        checked++;
      }
      assert.ok(checked - fromEarlierRuns > 0, "at least one historical order with content");
      result.checks.historical = { orders: list.body.orders.length, withContent, renderedIdentically: checked - fromEarlierRuns, earlierE2EOrders: fromEarlierRuns };
    }, 600000);

    const fullId = await h.step("full order: styled instructions and notes", async () => {
      await p.goto(`${target.baseUrl}/orders?create=1`);
      await p.getByText("Nuevo pedido").first().waitFor({ timeout: 30000 });
      await p.getByLabel("Título del pedido").fill(`E2E Formato ${run}`);
      await typeInto("Instrucciones", "NO CORTAR sangrado 3 mm. Papel 350 g.");
      await p.keyboard.press("Enter");
      await p.keyboard.type("Entregar en caja cerrada");
      await select("Instrucciones", "Entregar en caja cerrada");
      await choose("Instrucciones", "Alineación", "Derecha");
      await select("Instrucciones", "NO CORTAR");
      await choose("Instrucciones", "Alineación", "Centrada");
      await select("Instrucciones", "NO CORTAR");
      await choose("Instrucciones", "Tamaño del texto", "Muy grande");
      await select("Instrucciones", "NO CORTAR");
      await choose("Instrucciones", "Color del texto", "Rojo");
      await select("Instrucciones", "Papel 350 g.");
      await choose("Instrucciones", "Color del texto", "Verde");
      if (!(await p.locator(editor("Notas internas")).isVisible())) await p.getByText("Más opciones", { exact: true }).last().click();
      await typeInto("Notas internas", "Cliente paga al recoger");
      await select("Notas internas", "paga al recoger");
      await choose("Notas internas", "Color del texto", "Azul");
      await select("Notas internas", "paga al recoger");
      await choose("Notas internas", "Tamaño del texto", "Grande");
      await h.screenshot("crear-pedido-completo");
      const [response] = await Promise.all([
        p.waitForResponse((r: any) => new URL(r.url()).pathname === "/api/orders" && r.request().method() === "POST", { timeout: 60000 }),
        p.getByRole("button", { name: "Crear pedido" }).click(),
      ]);
      assert.equal(response.status(), 201);
      const created = await response.json();
      const id = created.order?.id ?? created.id; assert.ok(id, "created order id");
      const stored = (await call(`/api/orders/${id}`)).body.order;
      assert.deepEqual(await stylesOf(stored.description, "NO CORTAR"), ["data-text-color=red", "data-text-size=xlarge"]);
      assert.deepEqual(await stylesOf(stored.description, "Papel 350 g."), ["data-text-color=green"]);
      assert.deepEqual(await stylesOf(stored.notes, "paga al recoger"), ["data-text-color=blue", "data-text-size=large"]);
      assert.equal(await storedAlign(stored.description, "NO CORTAR"), "center");
      assert.equal(await storedAlign(stored.description, "Entregar en caja cerrada"), "right");
      assert.equal(/style=|class=/.test(stored.description + stored.notes), false);
      result.orders.full = stored.reference;
      return id as string;
    }, 180000);

    const lightRed = await h.step("detail view shows the styles (light)", async () => {
      await openDetail(fullId);
      const red = await computed("main", "NO CORTAR");
      assert.ok(red, "styled text on the detail");
      const expected = await tokenColor("red");
      assert.equal(red.color, expected);
      assert.ok(Math.abs(red.size / red.base - 1.5) < 0.02, `xlarge: ${red.size}/${red.base}`);
      result.checks.lightContrastRed = contrast(red.color, red.background);
      assert.ok(result.checks.lightContrastRed >= 4.5);
      const blue = await computed("main", "paga al recoger");
      assert.equal(blue.color, await tokenColor("blue"));
      assert.equal(await alignOf("main", "NO CORTAR"), "center");
      assert.equal(await alignOf("main", "Entregar en caja cerrada"), "right");
      await h.screenshot("detalle-claro");
      return expected as string;
    });

    const light = await h.step("edit after reload, save, reload", async () => {
      await p.getByRole("button", { name: "Editar pedido" }).click();
      await p.locator(editor("Instrucciones")).waitFor();
      await select("Instrucciones", "sangrado 3 mm");
      await choose("Instrucciones", "Color del texto", "Naranja");
      await select("Instrucciones", "NO CORTAR");
      await choose("Instrucciones", "Color del texto", "Predeterminado");
      await select("Instrucciones", "NO CORTAR");
      await choose("Instrucciones", "Alineación", "Justificada");
      const [response] = await Promise.all([
        p.waitForResponse((r: any) => r.url().endsWith(`/api/orders/${fullId}/content`) && r.request().method() === "PATCH", { timeout: 60000 }),
        p.getByRole("button", { name: "Guardar cambios" }).click(),
      ]);
      assert.equal(response.status(), 200);
      await p.reload();
      await p.locator(".gc-fact-label", { hasText: "Instrucciones:" }).first().waitFor();
      const stored = (await call(`/api/orders/${fullId}`)).body.order;
      assert.deepEqual(await stylesOf(stored.description, "NO CORTAR"), ["data-text-size=xlarge"]);
      assert.deepEqual(await stylesOf(stored.description, "sangrado 3 mm"), ["data-text-color=orange"]);
      assert.deepEqual(await stylesOf(stored.description, "Papel 350 g."), ["data-text-color=green"]);
      assert.equal(await storedAlign(stored.description, "NO CORTAR"), "justify");
      assert.equal(await storedAlign(stored.description, "Entregar en caja cerrada"), "right");
      assert.equal((await renderedContent()).description, await canonical(normalizeRichText(stored.description, ORDER_RICH_TEXT)));
      assert.equal(await alignOf("main", "NO CORTAR"), "justify");
      // Light-palette colors the instructions now carry (red was removed from NO CORTAR).
      const orange = await tokenColor("orange");
      const green = await tokenColor("green");
      assert.equal((await computed("main", "sangrado 3 mm"))?.color, orange, "orange on the detail");
      assert.equal((await computed("main", "Papel 350 g."))?.color, green, "green on the detail");
      result.checks.editRoundTrip = true;
      return { orange: orange as string, green: green as string };
    });

    await h.step("«Añadir nota» keeps earlier styles", async () => {
      await p.getByRole("button", { name: "+ Añadir nota" }).click();
      await typeInto("Nota", "Falta el reverso");
      await select("Nota", "Falta el reverso");
      await choose("Nota", "Color del texto", "Rojo");
      await select("Nota", "Falta el reverso");
      await choose("Nota", "Alineación", "Centrada");
      const [response] = await Promise.all([
        p.waitForResponse((r: any) => r.url().endsWith(`/api/orders/${fullId}/content`) && r.request().method() === "PATCH", { timeout: 60000 }),
        p.getByRole("button", { name: "Guardar nota" }).click(),
      ]);
      assert.equal(response.status(), 200);
      const stored = (await call(`/api/orders/${fullId}`)).body.order;
      assert.deepEqual(await stylesOf(stored.notes, "paga al recoger"), ["data-text-color=blue", "data-text-size=large"]);
      assert.deepEqual(await stylesOf(stored.notes, "Falta el reverso"), ["data-text-color=red"]);
      assert.equal(await storedAlign(stored.notes, "Falta el reverso"), "center");
      assert.equal(await storedAlign(stored.notes, "paga al recoger"), null, "earlier note stays left");
      result.checks.appendNote = true;
    });

    // SUR4 E2: the sheet never prints the order notes (N6/N18); styles are
    // checked on the instructions, and the screen shows the notes notice.
    await h.step("print keeps the styles on the light palette", async () => {
      await p.goto(`${target.baseUrl}/orders/${fullId}/print`);
      await p.locator(".print-rich").first().waitFor({ timeout: 30000 });
      // Colors: the edited orange and the untouched green keep the light palette;
      // NO CORTAR was reset to the default color and keeps its size.
      const orange = await computed(".print-sheet", "sangrado 3 mm");
      assert.equal(orange.color, light.orange);
      assert.ok(contrast(orange.color, orange.background) >= 4.5);
      const green = await computed(".print-sheet", "Papel 350 g.");
      assert.equal(green.color, light.green);
      assert.ok(contrast(green.color, green.background) >= 4.5);
      const printed = await computed(".print-sheet", "NO CORTAR");
      const plain = await computed(".print-sheet", "Entregar en caja cerrada");
      assert.notEqual(printed.color, lightRed, "red was removed in the edit");
      assert.equal(printed.color, plain.color, "NO CORTAR prints in the default color");
      assert.ok(Math.abs(printed.size / printed.base - 1.5) < 0.02);
      assert.equal(await alignOf(".print-sheet", "NO CORTAR"), "justify");
      assert.equal(await alignOf(".print-sheet", "Entregar en caja cerrada"), "right");
      const sheetText = await p.locator(".print-sheet").first().innerText();
      assert.equal(sheetText.includes("Falta el reverso"), false, "notes are not printed");
      assert.equal(sheetText.includes("paga al recoger"), false, "notes are not printed");
      await p.getByText("Este pedido tiene notas internas, que no se imprimen.").waitFor();
      await h.screenshot("impresion-claro");
      await setTheme("dark"); await p.reload(); await p.locator(".print-rich").first().waitFor();
      assert.equal(await p.evaluate(() => document.documentElement.classList.contains("dark")), true);
      assert.equal((await computed(".print-sheet", "sangrado 3 mm")).color, light.orange, "print ignores dark mode");
      assert.equal((await computed(".print-sheet", "Papel 350 g.")).color, light.green, "print ignores dark mode");
      assert.equal((await computed(".print-sheet", "NO CORTAR")).color, plain.color, "print ignores dark mode");
      await h.screenshot("impresion-modo-oscuro");
      result.checks.print = true;
    });

    await h.step("dark mode detail and editor", async () => {
      await openDetail(fullId);
      const red = await computed("main", "Falta el reverso");
      assert.equal(red.color, await tokenColor("red"));
      assert.notEqual(red.color, lightRed, "lighter red in dark mode");
      result.checks.darkContrastRed = contrast(red.color, red.background);
      assert.ok(result.checks.darkContrastRed >= 4.5);
      await h.screenshot("detalle-oscuro");
      await p.getByRole("button", { name: "Editar pedido" }).click();
      await p.locator(editor("Instrucciones")).waitFor();
      const inEditor = await computed(editor("Instrucciones"), "sangrado 3 mm");
      result.checks.darkEditorContrastOrange = contrast(inEditor.color, inEditor.background);
      assert.ok(result.checks.darkEditorContrastOrange >= 4.5);
      await p.locator("[data-disabled]").filter({ has: p.locator(editor("Instrucciones")) }).getByRole("button", { name: /^Color del texto:/ }).click();
      await p.getByRole("menu").waitFor(); await p.waitForTimeout(300);
      await h.screenshot("editor-oscuro-menu-color");
      await p.keyboard.press("Escape");
      await setTheme("light");
    });

    await h.step("phone width (390 px)", async () => {
      await p.setViewportSize({ width: 390, height: 844 });
      await openDetail(fullId);
      await p.getByRole("button", { name: "Editar pedido" }).click();
      await p.locator(editor("Instrucciones")).waitFor();
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal page scroll");
      await p.locator("[data-disabled]").filter({ has: p.locator(editor("Instrucciones")) }).getByRole("button", { name: /^Tamaño del texto:/ }).click();
      const menu = await p.getByRole("menu").boundingBox(); await p.waitForTimeout(300);
      assert.ok(menu && menu.x >= 0 && menu.x + menu.width <= 390, "menu inside the viewport");
      await h.screenshot("editor-390-menu-tamano");
      await p.keyboard.press("Escape");
      await p.getByRole("menu").waitFor({ state: "detached" });
      await p.locator("[data-disabled]").filter({ has: p.locator(editor("Instrucciones")) }).getByRole("button", { name: /^Alineación:/ }).click();
      const alignMenu = await p.getByRole("menu").boundingBox(); await p.waitForTimeout(300);
      assert.ok(alignMenu && alignMenu.x >= 0 && alignMenu.x + alignMenu.width <= 390, "alignment menu inside the viewport");
      assert.equal(await alignOf(editor("Instrucciones"), "Entregar en caja cerrada"), "right");
      await h.screenshot("editor-390-menu-alineacion");
      await p.keyboard.press("Escape");
      await p.setViewportSize({ width: 1440, height: 1000 });
      result.checks.phone = true;
    });

    await h.step("quick order keeps the styles", async () => {
      await p.goto(`${target.baseUrl}/orders/quick`);
      await p.getByText("Pedido rápido").first().waitFor({ timeout: 30000 });
      if (!(await p.locator(editor("Descripción")).isVisible())) await p.getByText("Más opciones", { exact: true }).last().click();
      await typeInto("Descripción", `Urgente: plastificar ${run}`);
      await select("Descripción", "Urgente");
      await choose("Descripción", "Color del texto", "Rojo");
      await select("Descripción", "Urgente");
      await choose("Descripción", "Alineación", "Centrada");
      await h.screenshot("pedido-rapido");
      const [response] = await Promise.all([
        p.waitForResponse((r: any) => new URL(r.url()).pathname === "/api/orders" && r.request().method() === "POST", { timeout: 60000 }),
        p.getByRole("button", { name: "Crear pedido" }).click(),
      ]);
      assert.equal(response.status(), 201);
      const created = await response.json();
      const id = created.order?.id ?? created.id;
      const stored = (await call(`/api/orders/${id}`)).body.order;
      assert.deepEqual(await stylesOf(stored.description, "Urgente"), ["data-text-color=red"]);
      assert.equal(await storedAlign(stored.description, "Urgente"), "center");
      result.orders.quick = stored.reference;
    });

    await h.step("server sanitizes forged HTML; foreign tenant denied", async () => {
      const before = (await call(`/api/orders/${fullId}`)).body.order;
      const patched = await call(`/api/orders/${fullId}/content`, "PATCH", { field: "notes", value: FORGED, expected_version: String(before.version) });
      assert.equal(patched.status, 200, JSON.stringify(patched.body));
      assert.equal(patched.body.value, CLEAN);
      assert.equal((await call(`/api/orders/${fullId}`)).body.order.notes, CLEAN);
      const foreignRead = await call(`/api/orders/${FOREIGN_ORDER.id}`);
      assert.ok(foreignRead.status >= 400 && foreignRead.status < 500, `foreign read ${foreignRead.status}`);
      const foreignWrite = await call(`/api/orders/${FOREIGN_ORDER.id}/content`, "PATCH", { field: "description", value: CLEAN, expected_version: "1" });
      assert.ok(foreignWrite.status >= 400 && foreignWrite.status < 500, `foreign write ${foreignWrite.status}`);
      result.checks.forged = true;
      result.checks.foreignTenant = { reference: FOREIGN_ORDER.reference, read: foreignRead.status, write: foreignWrite.status };
    });

    await h.step("quotes keep the basic vocabulary", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const creationId = randomUUID();
      const created = await call("/api/quotes/create-draft", "POST", { creation_id: creationId, prepare: false, client_id: null, service_id: null, assigned_team_member_id: null,
        header: { title: `E2E Formato presupuesto ${run}`, description: '<p data-text-align="center"><span data-text-color="red" data-text-size="xlarge">Importante</span> texto</p>', terms: null,
          contact_name: null, contact_email: null, contact_phone: null, billing_name: null, tax_id: null, billing_address: null,
          issue_date: today, valid_until: null, currency: "EUR", prices_include_tax: true },
        items: [{ concept: "Partida", description: null, quantity: "1", unit: "ud", unit_price: "10", discount_percent: "0", tax_rate: "21" }] });
      assert.equal(created.status, 200, JSON.stringify(created.body));
      assert.equal(created.body.quote_id, creationId);
      // Acknowledge it as the editor does after saving: an unacknowledged creation locks /quotes/new for later runs.
      const ack = await call("/api/quotes/creation-recovery", "POST", { operation_id: creationId });
      assert.equal(ack.status, 200, JSON.stringify(ack.body)); assert.equal(ack.body.quote_id, creationId);
      result.checks.quoteCreationAcknowledged = true;
      const quote = await call(`/api/quotes/${creationId}`); assert.equal(quote.status, 200);
      const text = JSON.stringify(quote.body);
      assert.equal(text.includes("data-text-"), false, "no tokens or alignment in quotes");
      assert.match(text, /Importante texto/);
      result.checks.quotesBasic = quote.body.quote?.reference ?? true;
    });

    h.assertNoProductionEgress();
    result.checks.noProductionEgress = true; result.status = "passed";
  } catch (e) { result.status = "failed"; result.error = redactor.text(e instanceof Error ? e.message : String(e)); console.error(result.error); }
  finally {
    result.consoleErrors = h.consoleErrors.length;
    await h.finish(result); console.log(JSON.stringify(result, null, 2)); console.log("Artifacts: " + dir);
  }
  process.exitCode = result.status === "passed" ? 0 : 1;
}
void main();
