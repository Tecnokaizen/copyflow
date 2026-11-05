// Order Detail Views V1 — E2E against a LOCAL app + local Supabase with
// synthetic tenants (never Staging or Production).
//
// Needs a running app (`next dev`) whose tenants resolve as
// http://<slug>.localhost:<port>, and:
//   ODV_BASE_PORT=3100 ODV_PASSWORD=... ODV_DEMO_ORDER=<uuid with sequence+post-its>
//   ODV_DEMO_ARCHIVED=<uuid> ODV_PLAIN_ORDER=<uuid> [ODV_CAPTURES=<dir>] [ODV_SHOTS=<dir>]
//   [ODV_EXPECT_TRACKING=1 once #153 is integrated]
//   PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs
// Users: owner|admin|staff@demo.test (demo has order_sticky_notes and
// order_work_sequence) and owner@plain.test (no features).
//
// It changes only tenant_settings.preferences.order_detail_view_v1 of the
// local demo tenant, and puts it back to «classic» at the end.

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");

const PORT = process.env.ODV_BASE_PORT || "3100";
const PASSWORD = process.env.ODV_PASSWORD;
const DEMO_ORDER = process.env.ODV_DEMO_ORDER;
const DEMO_ARCHIVED = process.env.ODV_DEMO_ARCHIVED;
const PLAIN_ORDER = process.env.ODV_PLAIN_ORDER;
const CAPTURES = process.env.ODV_CAPTURES || null;
const SHOTS = process.env.ODV_SHOTS || null;
// With #153 (Seguimiento del pedido) integrated: ODV_EXPECT_TRACKING=1.
const EXPECT_TRACKING = process.env.ODV_EXPECT_TRACKING === "1";
assert.ok(PASSWORD && DEMO_ORDER && DEMO_ARCHIVED && PLAIN_ORDER, "missing ODV_* env");

const base = (slug) => `http://${slug}.localhost:${PORT}`;
const VIEWS = ["classic", "operational", "tabs", "production", "hybrid"];
const WIDTHS = [390, 768, 1280];
const results = [];

function step(name, fn) {
  return fn().then(
    () => results.push({ name, ok: true }),
    (error) => {
      results.push({ name, ok: false, error: error?.message ?? String(error) });
    }
  );
}

async function login(browser, slug, email) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base(slug)}/auth/login`);
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.press('input[type="password"]', "Enter");
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/login"), { timeout: 30000 });
  return { context, page };
}

async function openOrder(page, slug, orderId, view) {
  const query = view ? `?vista=${view}` : "";
  await page.goto(`${base(slug)}/orders/${orderId}${query}`);
  await page.waitForSelector("[data-order-detail-view]", { timeout: 30000 });
  // Let the self-loading modules (amounts, files, sequence, post-its) settle.
  await page.waitForLoadState("networkidle").catch(() => {});
  return page.getAttribute("[data-order-detail-view]", "data-order-detail-view");
}

// Seguimiento del pedido (#153): one timeline per view, visible, loaded.
async function assertTracking(page, view) {
  const timeline = page.locator('ol[aria-label="Recorrido del pedido"]');
  if (!EXPECT_TRACKING) {
    assert.equal(await timeline.count(), 0, `${view}: tracking without #153`);
    return;
  }
  assert.equal(await timeline.count(), 1, `${view}: tracking count`);
  await page.waitForSelector('ol[aria-label="Recorrido del pedido"][data-tracking-status="ready"]', { timeout: 15000 });
  assert.ok(await timeline.isVisible(), `${view}: tracking hidden`);
}

async function noHorizontalScroll(page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  assert.ok(overflow <= 1, `horizontal overflow of ${overflow}px`);
}

// Headings rendered by the modules themselves (hidden tabs/folds included).
async function moduleTitles(page) {
  return page.$$eval("h2, h3, summary", (nodes) => nodes.map((n) => n.textContent?.trim() ?? ""));
}

// The Next.js dev indicator is not part of the product.
async function hideDevOverlay(page) {
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
}

async function shot(page, name, fullPage = true) {
  if (!SHOTS) return;
  await hideDevOverlay(page);
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage });
}

async function apiPatch(page, slug, body) {
  return page.evaluate(
    async ({ url, body }) => {
      const r = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    { url: `${base(slug)}/api/settings/order-detail-view`, body }
  );
}

async function apiGet(page, slug) {
  return page.evaluate(async (url) => {
    const r = await fetch(url, { cache: "no-store" });
    return { status: r.status, json: await r.json().catch(() => null) };
  }, `${base(slug)}/api/settings/order-detail-view`);
}

const browser = await chromium.launch();
try {
  // ---------------------------------------------------------------- owner demo
  const owner = await login(browser, "demo", "owner@demo.test");
  const page = owner.page;

  for (const view of VIEWS) {
    await step(`demo owner · ${view} renders every module`, async () => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const applied = await openOrder(page, "demo", DEMO_ORDER, view === "classic" ? null : view);
      assert.equal(applied, view);
      const titles = (await moduleTitles(page)).join(" | ");
      for (const title of ["Trabajo", "Resumen", "Cobro y entrega", "Archivos", "Actividad", "Post-its"]) {
        assert.ok(titles.includes(title), `${view}: missing «${title}» in ${titles}`);
      }
      assert.ok(await page.getByText("Secuencia de trabajo").count(), `${view}: no sequence`);
      // Functional parity: the same header actions in every view, once each
      // on screen (printing may also sit in the phone-only fold).
      for (const label of ["Imprimir pedido", "Resguardo PDF"]) {
        assert.ok(await page.getByText(label, { exact: true }).count(), `${view}: no «${label}»`);
      }
      for (const label of ["Editar pedido", "Cambiar estado", "Cambiar responsable", "+ Añadir nota"]) {
        const visible = page.getByRole("button", { name: label, exact: true }).filter({ visible: true });
        assert.equal(await visible.count(), 1, `${view}: «${label}» visible once`);
      }
      // The same sequence actions, mounted in every view (in B, inside the
      // «Trabajo» tab).
      for (const label of ["Editar secuencia", "Marcar hecho"]) {
        assert.ok(await page.locator("button", { hasText: label }).count(), `${view}: no «${label}»`);
      }
      // The header amounts come from «Cobro y entrega», mounted in every view.
      // C shows no amounts in its header: they stay in «Cobro y entrega».
      if (view === "production") {
        assert.equal(await page.locator('[aria-label="Importes y entrega"]').count(), 0, "C: no header amounts");
        await page.waitForSelector("text=Pendiente de cobro", { state: "attached", timeout: 15000 });
      } else {
        await page.waitForSelector('[aria-label="Importes y entrega"] >> text=Pendiente de cobro', { timeout: 15000 });
      }
      await assertTracking(page, view);
      // Desktop: the amounts sit to the right of the title.
      const amountsLeft = await page.evaluate(() => {
        const a = document.querySelector('[aria-label="Importes y entrega"]');
        const h = document.querySelector("[data-order-detail-view] h1");
        return a && h ? a.getBoundingClientRect().left < h.getBoundingClientRect().left : false;
      });
      assert.equal(amountsLeft, false, `${view}: amounts left of the title`);
    });

    for (const width of WIDTHS) {
      await step(`demo owner · ${view} · ${width}px without horizontal scroll`, async () => {
        await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
        await page.waitForTimeout(300);
        await noHorizontalScroll(page);
        await shot(page, `${view}-${width}`);
      });
    }
  }

  // Phones: the worker changes status or assignee without scrolling (A, C, D),
  // and C starts with the work sequence, D with the amounts and the board.
  const firstScreen = {};
  for (const view of ["operational", "production", "hybrid"]) {
    await step(`mobile · ${view} · status and assignee on the first screen`, async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await openOrder(page, "demo", DEMO_ORDER, view);
      for (const label of ["Cambiar estado", "Cambiar responsable"]) {
        const button = page.getByRole("button", { name: label, exact: true });
        const box = await button.boundingBox();
        assert.ok(box && box.y + box.height <= 844, `${view}: «${label}» below the first screen (${box?.y})`);
      }
      firstScreen[view] = await page.evaluate(() => {
        const y = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
        const sequence = [...document.querySelectorAll("section h2")].find((h) =>
          h.textContent.startsWith("Secuencia de trabajo")
        );
        return {
          sequence: y(sequence),
          board: y(document.querySelector('[aria-label="Producción del pedido"]')),
          amounts: y(document.querySelector('[aria-label="Importes y entrega"]')),
        };
      });
    });
  }
  await step("mobile · C and D differ from the top", async () => {
    const c = firstScreen.production;
    const d = firstScreen.hybrid;
    assert.ok(c && d, "first-screen data");
    assert.equal(c.amounts, null, "C: no header amounts");
    assert.ok(c.sequence !== null && c.sequence < 844 && c.sequence < c.board, `C: sequence first (${JSON.stringify(c)})`);
    assert.ok(d.amounts !== null && d.amounts < d.board && d.board < 844, `D: amounts, then board (${JSON.stringify(d)})`);
  });

  await step("mobile · C shows «Le toca ahora» on the first screen; done steps fold", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOrder(page, "demo", DEMO_ORDER, "production");
    // The desktop row of cards is in the DOM but hidden on phones.
    const current = page.getByText("Le toca ahora", { exact: true }).filter({ visible: true }).first();
    await current.waitFor({ state: "visible", timeout: 15000 });
    const box = await current.boundingBox();
    assert.ok(box && box.y + box.height <= 844, `«Le toca ahora» at ${box?.y}`);
    const folded = page.locator("[data-done-steps] summary");
    assert.match((await folded.textContent()) ?? "", /pasos? hechos?/);
    await folded.click();
    assert.ok(await page.locator("[data-done-steps] li").first().isVisible(), "done steps reachable");
  });

  await step("tabs · every tab shows its section; header stays", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOrder(page, "demo", DEMO_ORDER, "tabs");
    for (const [tab, title] of [
      ["Trabajo", "Trabajo"],
      ["Archivos", "Archivos"],
      ["Cobros", "Cobro y entrega"],
      ["Actividad", /^Actividad( · \d+)?$/],
      ["Resumen", "Resumen"],
    ]) {
      await page.getByRole("tab", { name: tab }).click();
      const panel = page.locator('[role="tabpanel"]:not([hidden])');
      assert.equal(await panel.count(), 1);
      // Really hidden, not just the attribute (CSS can override it).
      const visiblePanels = await page.$$eval('[role="tabpanel"]', (nodes) =>
        nodes.filter((n) => getComputedStyle(n).display !== "none").length
      );
      assert.equal(visiblePanels, 1, `tab ${tab}: ${visiblePanels} panels visible`);
      const text = typeof title === "string" ? panel.getByText(title, { exact: true }) : panel.getByText(title);
      assert.ok(await text.first().isVisible(), `tab ${tab}`);
      assert.ok(await page.getByText("Editar pedido", { exact: true }).isVisible());
    }
  });

  await step("tabs · «Añadir nota» opens Trabajo and the post-it composer", async () => {
    await openOrder(page, "demo", DEMO_ORDER, "tabs");
    await page.getByRole("button", { name: "Añadir nota" }).first().click();
    const panel = page.locator('[role="tabpanel"]:not([hidden])');
    await panel.getByText("Post-its", { exact: true }).first().waitFor({ timeout: 5000 });
    assert.equal(await page.getByRole("tab", { name: "Trabajo" }).getAttribute("aria-selected"), "true");
  });

  await step("operational · «Añadir nota» opens the closed notes fold", async () => {
    await openOrder(page, "demo", DEMO_ORDER, "operational");
    await page.locator('details[data-fold="Post-its y notas"] > summary').click(); // close it
    assert.equal(await page.locator('details[data-fold="Post-its y notas"]').getAttribute("open"), null);
    await page.getByRole("button", { name: "Añadir nota" }).first().click();
    await page.waitForFunction(() => document.querySelector('details[data-fold="Post-its y notas"]')?.open === true);
  });

  await step("production · «Editar pedido» opens Administración with the draft fields", async () => {
    await openOrder(page, "demo", DEMO_ORDER, "production");
    const fold = page.locator('details[data-fold="Administración"]');
    assert.equal(await fold.getAttribute("open"), null);
    await page.getByText("Editar pedido", { exact: true }).click();
    await page.waitForFunction(() => document.querySelector('details[data-fold="Administración"]')?.open === true);
    await page.getByText("Descartar borrador", { exact: true }).click();
  });

  await step("archived order · every view is read-only", async () => {
    for (const view of VIEWS) {
      await openOrder(page, "demo", DEMO_ARCHIVED, view === "classic" ? null : view);
      assert.ok(await page.getByText("Pedido archivado · solo consulta").count(), view);
      assert.equal(await page.getByText("Editar pedido", { exact: true }).count(), 0, view);
    }
  });

  await step("dark theme · hybrid renders", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await openOrder(page, "demo", DEMO_ORDER, "hybrid");
    await shot(page, "hybrid-1280-dark");
    await page.emulateMedia({ colorScheme: "light" });
  });

  await step("invalid preview value falls back to the tenant view", async () => {
    assert.equal(await openOrder(page, "demo", DEMO_ORDER, "kanban"), "classic");
    assert.equal(await openOrder(page, "demo", DEMO_ORDER, "%3Cscript%3E"), "classic");
  });

  // ------------------------------------------------------- settings page (owner)
  await step("settings · hub shows Personalización › Vista de pedidos", async () => {
    await page.goto(`${base("demo")}/settings`);
    await page.getByText("Personalización", { exact: true }).waitFor();
    await page.getByRole("link", { name: "Elegir vista" }).click();
    await page.waitForURL(/\/settings\/order-detail-view/);
    await page.locator("[data-view-card]").first().waitFor();
    assert.equal(await page.locator("[data-view-card]").count(), 5);
    await shot(page, "settings-1280");
  });

  await step("settings · apply D with confirmation, then go back", async () => {
    await page.locator('[data-view-card="hybrid"]').getByRole("button", { name: "Aplicar esta vista" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Aplicar vista" }).click();
    await page.getByText(/Vista aplicada: «D · Híbrida»/).waitFor();
    assert.equal(await openOrder(page, "demo", DEMO_ORDER, null), "hybrid");
    await page.goto(`${base("demo")}/settings/order-detail-view`);
    await page.getByRole("button", { name: /Volver a «Ficha actual»/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Aplicar vista" }).click();
    await page.getByText(/Vista aplicada: «Ficha actual»/).waitFor();
    assert.equal(await openOrder(page, "demo", DEMO_ORDER, null), "classic");
  });

  await step("API · stale revision is refused with 409 and nothing changes", async () => {
    const before = await apiGet(page, "demo");
    assert.equal(before.status, 200);
    const first = await apiPatch(page, "demo", { view: "tabs", revision: before.json.revision });
    assert.equal(first.status, 200, JSON.stringify(first.json));
    const stale = await apiPatch(page, "demo", { view: "production", revision: before.json.revision });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.current.view, "tabs");
    const bad = await apiPatch(page, "demo", { view: "kanban", revision: first.json.revision });
    assert.equal(bad.status, 400);
    const reset = await apiPatch(page, "demo", { view: "classic", revision: first.json.revision });
    assert.equal(reset.status, 200);
  });

  // ------------------------------------------------------------------- admin
  const admin = await login(browser, "demo", "admin@demo.test");
  await step("admin · can read and change the view", async () => {
    const state = await apiGet(admin.page, "demo");
    assert.equal(state.status, 200);
    const r = await apiPatch(admin.page, "demo", { view: "operational", revision: state.json.revision });
    assert.equal(r.status, 200);
    assert.equal(await openOrder(admin.page, "demo", DEMO_ORDER, null), "operational");
  });

  // ------------------------------------------------------------------- staff
  const staff = await login(browser, "demo", "staff@demo.test");
  await step("staff · gets the tenant view, cannot preview or change it", async () => {
    assert.equal(await openOrder(staff.page, "demo", DEMO_ORDER, null), "operational");
    assert.equal(await openOrder(staff.page, "demo", DEMO_ORDER, "tabs"), "operational");
    assert.equal((await apiGet(staff.page, "demo")).status, 403);
    assert.equal((await apiPatch(staff.page, "demo", { view: "tabs", revision: "x" })).status, 403);
    const response = await staff.page.goto(`${base("demo")}/settings/order-detail-view`);
    assert.equal(response?.status(), 404);
  });

  await step("cleanup · demo back to classic", async () => {
    const state = await apiGet(page, "demo");
    const r = await apiPatch(page, "demo", { view: "classic", revision: state.json.revision });
    assert.equal(r.status, 200);
  });

  // ----------------------------------------------------- plain (features off)
  const plain = await login(browser, "plain", "owner@plain.test");
  for (const view of VIEWS) {
    await step(`plain owner · ${view} without sequence or post-its`, async () => {
      await plain.page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(await openOrder(plain.page, "plain", PLAIN_ORDER, view === "classic" ? null : view), view);
      assert.equal(await plain.page.getByText("Secuencia de trabajo").count(), 0, view);
      assert.equal(await plain.page.getByText("Post-its", { exact: true }).count(), 0, view);
      const titles = (await moduleTitles(plain.page)).join(" | ");
      for (const title of ["Trabajo", "Resumen", "Cobro y entrega", "Archivos", "Actividad", "Notas internas"]) {
        assert.ok(titles.includes(title), `${view}: missing «${title}»`);
      }
      await assertTracking(plain.page, view);
      await shot(plain.page, `plain-${view}-1280`);
    });
  }

  await step("isolation · demo order is not visible from plain", async () => {
    await plain.page.goto(`${base("plain")}/orders/${DEMO_ORDER}`);
    await plain.page.getByText(/Pedido no encontrado|No se pudo cargar el pedido/).waitFor({ timeout: 15000 });
  });

  // ------------------------------------------------- captures for Settings
  if (CAPTURES) {
    await mkdir(CAPTURES, { recursive: true });
    await step("captures · desktop and mobile for every view", async () => {
      // Applied for real (local tenant only) so no preview banner shows.
      for (const view of VIEWS) {
        const state = await apiGet(page, "demo");
        const r = await apiPatch(page, "demo", { view, revision: state.json.revision });
        assert.equal(r.status, 200);
        await page.setViewportSize({ width: 1280, height: 800 });
        assert.equal(await openOrder(page, "demo", DEMO_ORDER, null), view);
        await hideDevOverlay(page);
        await page.screenshot({ path: path.join(CAPTURES, `${view}-desktop.png`) });
        // Mobile: from the end of the order header, where the views differ.
        await page.setViewportSize({ width: 390, height: 823 });
        await openOrder(page, "demo", DEMO_ORDER, null);
        await hideDevOverlay(page);
        const top = await page.evaluate(() => {
          const header = document.querySelector("[data-order-detail-view] header");
          return header ? header.getBoundingClientRect().bottom + window.scrollY - 24 : 0;
        });
        await page.screenshot({
          path: path.join(CAPTURES, `${view}-mobile.png`),
          fullPage: true,
          clip: { x: 0, y: Math.max(0, top), width: 390, height: 823 },
        });
      }
      const state = await apiGet(page, "demo");
      await apiPatch(page, "demo", { view: "classic", revision: state.json.revision });
    });
  }
} finally {
  await browser.close();
}

for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name}${r.ok ? "" : ` — ${r.error}`}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
