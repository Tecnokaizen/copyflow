/** Staging: joint integration of the pending batch on the real deployment.
 * Real login, real API routes/RPCs of tenant `e2e`; shared guard + harness
 * (egress interlock, redacted artifacts, no Playwright traces). No API doubles:
 * the only route handler delays a real request and then lets it through.
 *
 * Scenarios:
 *   B1/B2 (#139) lists with search: a slow unfiltered response (delayed in the
 *         browser) must never overwrite the newer search (clients, services).
 *   S1–S3 (status dialog fix) «Cambiar estado» and the edit form offer only
 *         active statuses; an order already in a deactivated status shows it
 *         as «(desactivado)», selected and not selectable; the API refuses it.
 *   T1    (#146 + #153) styled instructions survive a UI status change, the
 *         timeline updates live, and the print keeps the styles.
 *   X1    tenant isolation: foreign order, foreign status, catalogue.
 *
 * Writes (tenant `e2e`, tagged `E2E-INT-<run>`): 1 client, 3 orders. Reuses one
 * synthetic status «E2E diálogo estado desactivado» (created on the first run,
 * active only for the few seconds needed to move one order into it).
 *
 *   TZ=UTC PLAYWRIGHT_MODULE=/abs/playwright/index.mjs npx tsx e2e/staging/integration-batch.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded at runtime, outside package.json. */
import assert from "node:assert/strict";
import path from "node:path";
import { resolveStagingTarget } from "./guard";
import { Harness } from "./harness";
import { Redactor } from "./redact";
import { requireSyntheticEmail, runId } from "./synthetic";

/** DEMO-0001 of the Staging `demo` tenant (synthetic) and its status, verified by SQL on 27/10/2026. */
const FOREIGN_ORDER = {
  id: "e05d5aaa-8bc5-4cb4-a3f8-90db422c4850",
  reference: "DEMO-0001",
  statusId: "92d2f2b1-599f-4217-8e06-30538dd14e32",
};
const DIALOG_STATUS_NAME = "E2E diálogo estado desactivado";
/** Visible texts, hard-coded on purpose (not imported from the code under test). */
const INACTIVE_SUFFIX = " (desactivado)";
const DELAY_MS = 3_000;

type Status = { id: string; code: string; name: string; active: boolean; sort_order?: number };
type Option = { value: string; text: string; disabled: boolean; selected: boolean };
type Outcome = { id: string; title: string; status: "PASS" | "FAIL" | "SKIP"; detail?: string; ms?: number };
/** Thrown inside a scenario that cannot discriminate with the tenant's data. */
class Skip extends Error {}

async function main() {
  const target = resolveStagingTarget();
  const email = requireSyntheticEmail(process.env.E2E_USER_EMAIL);
  const password = process.env.E2E_USER_PASSWORD;
  assert.ok(password, "E2E_USER_PASSWORD is required");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined;
  const run = runId();
  const tag = `E2E-INT-${run}`;
  const dir = process.env.E2E_ARTIFACTS_DIR
    ? path.join(process.env.E2E_ARTIFACTS_DIR, `integration-batch-${run}`)
    : path.join("e2e-artifacts", `integration-batch-${run}`);
  const redactor = new Redactor([password, bypass]);
  const h = new Harness(target, redactor, dir, bypass);
  const result: any = {
    run, tag, baseUrl: target.baseUrl, deploymentSha: process.env.E2E_DEPLOYMENT_SHA ?? null,
    scenarios: [] as Outcome[], orders: {} as Record<string, any>, client: null as any,
    dialogStatus: null as any, lists: {} as Record<string, any>, dialogs: {} as Record<string, any>,
    screenshots: [] as string[],
  };
  let p: any;
  const catalog = new Map<string, Status>();
  const byCode = (code: string) => {
    const status = [...catalog.values()].find((s) => s.code === code);
    assert.ok(status, `status ${code} missing in the e2e catalog`);
    return status;
  };

  async function call(url: string, method = "GET", data?: unknown) {
    assert.ok(url.startsWith("/api/"));
    const r = await p.request.fetch(target.baseUrl + url, { method, data, timeout: 60_000, maxRedirects: 0 });
    const text = await r.text();
    let body: any; try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 300) }; }
    h.log(`${method} ${url.split("?")[0]} → ${r.status()}`);
    return { status: r.status(), body, text };
  }
  const detail = async (id: string) => {
    const r = await call(`/api/orders/${id}`); assert.equal(r.status, 200, r.text); return r.body.order;
  };
  async function loadCatalog() {
    const r = await call("/api/order-statuses");
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.tenant, "e2e");
    catalog.clear();
    for (const s of r.body.statuses as Status[]) catalog.set(s.id, s);
    return r;
  }
  const activeNames = () => [...catalog.values()].filter((s) => s.active).map((s) => s.name);
  const inactiveNames = () => [...catalog.values()].filter((s) => !s.active).map((s) => s.name);

  async function createOrder(label: string, extra: Record<string, unknown> = {}) {
    const r = await call("/api/orders", "POST", {
      title: `E2E Integración ${label} ${run}`,
      description: `<p>${tag} · ${label}</p>`,
      ...extra,
    });
    assert.equal(r.status, 201, r.text);
    const order = r.body.order;
    result.orders[label] = { id: order.id, reference: order.reference, title: order.title };
    h.log(`order ${label}: ${order.reference} (${order.id})`);
    return order;
  }
  async function apiStatus(id: string, statusId: string) {
    const before = await detail(id);
    return call(`/api/orders/${id}`, "PATCH", { status_id: statusId, expected_version: String(before.version) });
  }

  const dialog = (title: string) => p.getByRole("dialog").filter({ has: p.getByRole("heading", { name: title }) });
  const readOptions = (select: any): Promise<Option[]> => select.evaluate((el: HTMLSelectElement) =>
    [...el.options].map((o) => ({ value: o.value, text: o.textContent?.trim() ?? "", disabled: o.disabled, selected: o.selected })));
  /** The «Estado» select of the edit form (Producción card). */
  const editStatusSelect = () =>
    p.locator('xpath=//div[contains(@class,"gc-fact-label") and normalize-space(.)="Estado:"]/following-sibling::div[1]//select');

  async function openOrder(id: string) {
    await p.goto(`${target.baseUrl}/orders/${id}`);
    await p.getByRole("heading", { level: 2, name: "Seguimiento del pedido" }).waitFor();
    await p.locator('ol[aria-label="Recorrido del pedido"][data-tracking-status="ready"]').waitFor({ timeout: 30_000 });
  }
  async function dialogOptions(): Promise<Option[]> {
    await p.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    return readOptions(dialog("Cambiar estado").getByLabel("Estado"));
  }
  async function editOptions(): Promise<Option[]> {
    await p.getByRole("button", { name: "Editar pedido" }).click();
    await p.getByRole("button", { name: "Guardar cambios" }).waitFor();
    const options = await readOptions(editStatusSelect());
    await p.getByRole("button", { name: "Descartar borrador" }).click();
    await p.getByRole("button", { name: "Cambiar estado", exact: true }).waitFor();
    return options;
  }
  /** Steps of the live timeline: name, state and the «Estado desactivado» note. */
  async function timeline() {
    const list = p.locator('ol[aria-label="Recorrido del pedido"][data-tracking-status="ready"]');
    await list.waitFor({ timeout: 30_000 });
    return list.evaluate((ol: HTMLOListElement) => [...ol.children].map((li) => ({
      name: li.querySelector("[data-step-name]")?.textContent?.trim() ?? "",
      state: li.getAttribute("data-step-state") ?? "",
      inactive: [...li.querySelectorAll("p")].some((el) => el.textContent?.trim() === "Estado desactivado"),
    })));
  }
  async function waitCurrent(name: string) {
    const end = Date.now() + 30_000;
    let last: any[] = [];
    while (Date.now() < end) {
      last = await timeline();
      if (last.find((s) => s.state === "current")?.name === name) return last;
      await p.waitForTimeout(500);
    }
    throw new Error(`timeline did not show ${name} as current: ${JSON.stringify(last)}`);
  }
  async function uiChangeStatus(orderId: string, name: string) {
    await p.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    const box = dialog("Cambiar estado");
    await box.getByLabel("Estado").selectOption({ label: name });
    const patched = p.waitForResponse((r: any) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/orders/${orderId}`);
    patched.catch(() => undefined);
    await box.getByRole("button", { name: "Guardar estado" }).click();
    const response = await patched;
    assert.equal(response.status(), 200, `UI status change → HTTP ${response.status()}`);
    await p.getByText("Estado actualizado").first().waitFor();
  }

  async function shoot(name: string) {
    const file = path.join(dir, `${name}.png`);
    // App navigation (tenant brand, user menu) is masked; page content is synthetic.
    await p.screenshot({ path: file, fullPage: true, mask: [p.locator("header").filter({ has: p.locator("nav") })] });
    result.screenshots.push(path.basename(file));
  }
  async function scenario(id: string, title: string, fn: () => Promise<void>) {
    const started = Date.now();
    try {
      await h.step(`${id} ${title}`, fn, 180_000);
      result.scenarios.push({ id, title, status: "PASS", ms: Date.now() - started });
    } catch (error) {
      if (error instanceof Skip) {
        result.scenarios.push({ id, title, status: "SKIP", detail: error.message });
        return;
      }
      process.exitCode = 1;
      result.scenarios.push({ id, title, status: "FAIL", ms: Date.now() - started, detail: redactor.text(error instanceof Error ? error.message : String(error)).slice(0, 1500) });
    }
  }

  /**
   * #139: the page's first, unfiltered list request is held for DELAY_MS in the
   * browser and then sent for real; meanwhile the search is typed. Whatever
   * happens to the slow request (aborted by the page or answered late), the
   * list must keep showing the search result.
   */
  async function raceList(key: string, opts: {
    path: string; api: string; heading: string; placeholder: RegExp; term: string; totalOf: (header: string) => number;
  }) {
    const record: any = { delayed: 0, unfiltered: [] as any[], filtered: [] as any[] };
    const handler = async (route: any) => {
      const url = new URL(route.request().url());
      if (!url.searchParams.get("search")) {
        record.delayed++;
        await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
      }
      // The page may have aborted it meanwhile: nothing left to route then.
      await route.fallback().catch(() => undefined);
    };
    const matcher = (url: URL) => url.pathname === opts.api;
    const onResponse = async (response: any) => {
      const url = new URL(response.url());
      if (url.pathname !== opts.api) return;
      const search = url.searchParams.get("search");
      let total: number | null = null;
      try { total = Number((await response.json()).total); } catch { /* aborted body */ }
      (search ? record.filtered : record.unfiltered).push({ search, status: response.status(), total, at: Date.now() });
    };
    const onFailed = (request: any) => {
      const url = new URL(request.url());
      if (url.pathname !== opts.api || url.searchParams.get("search")) return;
      record.unfiltered.push({ search: null, status: null, failure: request.failure()?.errorText ?? "failed", at: Date.now() });
    };
    await p.route(matcher, handler);
    p.on("response", onResponse);
    p.on("requestfailed", onFailed);
    try {
      await p.goto(`${target.baseUrl}${opts.path}`);
      await p.getByRole("heading", { level: 1, name: opts.heading }).waitFor();
      const filtered = p.waitForResponse((r: any) => {
        const url = new URL(r.url());
        return url.pathname === opts.api && url.searchParams.get("search") === opts.term && r.status() === 200;
      }, { timeout: 30_000 });
      await p.getByPlaceholder(opts.placeholder).fill(opts.term);
      const filteredTotal = Number((await (await filtered).json()).total);
      // Give the held request time to be sent and answered (or aborted).
      await p.waitForTimeout(DELAY_MS + 3_000);
      assert.ok(record.delayed >= 1, `${key}: the unfiltered request was not observed`);
      const header = await p.locator("body").innerText();
      const shown = opts.totalOf(header);
      record.filteredTotal = filteredTotal;
      record.shownTotal = shown;
      record.searchValue = await p.getByPlaceholder(opts.placeholder).inputValue();
      const unfilteredTotals = record.unfiltered.map((u: any) => u.total).filter((t: any) => typeof t === "number");
      record.unfilteredOutcome = record.unfiltered.map((u: any) => (u.failure ? `aborted (${u.failure})` : `answered ${u.status}`));
      assert.equal(record.searchValue, opts.term);
      assert.equal(shown, filteredTotal, `${key}: the list shows ${shown}, the search returned ${filteredTotal}`);
      for (const t of unfilteredTotals) assert.notEqual(t, filteredTotal, `${key}: not discriminating (same totals)`);
      result.lists[key] = record;
      return record;
    } finally {
      p.off("response", onResponse);
      p.off("requestfailed", onFailed);
      await p.unroute(matcher, handler);
    }
  }

  try {
    await h.start(process.env.PLAYWRIGHT_MODULE || "playwright", { context: { viewport: { width: 1280, height: 800 }, colorScheme: "light" } });
    p = h.page;

    await h.step("login + tenant e2e (owner) + catalog", async () => {
      await p.goto(`${target.baseUrl}/auth/login`);
      await p.locator("#email").fill(email);
      await p.locator("#password").fill(password);
      await Promise.all([
        p.waitForURL((u: URL) => u.origin === target.baseUrl && !u.pathname.startsWith("/auth/")),
        p.getByRole("button", { name: "Login", exact: true }).click(),
      ]);
      const context = await call("/api/context");
      assert.equal(context.status, 200);
      assert.equal(context.body.tenant.slug, "e2e");
      assert.equal(context.body.membership.role, "owner");
      await loadCatalog();
      for (const code of ["received", "in_progress", "ready", "closed", "cancelled"]) assert.ok(byCode(code).active);
      result.catalogBefore = [...catalog.values()].map(({ id, code, name, active }) => ({ id, code, name, active }));
    });

    await scenario("B1", "#139 clientes: la respuesta lenta sin filtro no pisa la búsqueda", async () => {
      const name = `E2E Integración cliente ${run}`;
      const created = await call("/api/clients", "POST", { name, email: `e2e-int-${run.toLowerCase()}@example.com` });
      assert.equal(created.status, 200, created.text);
      result.client = { id: created.body.client.id, name };
      await raceList("clients", {
        path: "/clients", api: "/api/clients/list", heading: "Clientes",
        placeholder: /^Buscar por nombre, empresa, contacto/, term: name,
        totalOf: (text) => Number(/(\d+) clientes/.exec(text)?.[1] ?? NaN),
      });
      const links = await p.locator('main table a[href^="/clients/"]').allTextContents();
      assert.deepEqual(links.map((t: string) => t.trim()), [name], "only the searched client is listed");
      await shoot("b1-clientes-busqueda");
    });

    await scenario("B2", "#139 servicios: la respuesta lenta sin filtro no pisa la búsqueda", async () => {
      const all = await call("/api/services?page=1&page_size=100");
      assert.equal(all.status, 200, all.text);
      const services = (all.body.services ?? []) as Array<{ name: string }>;
      let term: string | null = null;
      for (const s of services) {
        const word = s.name.trim();
        if (!word) continue;
        const probe = await call(`/api/services?page=1&page_size=25&search=${encodeURIComponent(word)}`);
        if (probe.status === 200 && Number(probe.body.total) >= 1 && Number(probe.body.total) < Number(all.body.total)) { term = word; break; }
      }
      if (!term) throw new Skip(`no discriminating search term (${services.length} services)`);
      await raceList("services", {
        path: "/services", api: "/api/services", heading: "Servicios",
        placeholder: /^Buscar por nombre, descripción o categoría/, term,
        totalOf: (text) => Number(/(\d+) servicios/.exec(text)?.[1] ?? NaN),
      });
      await shoot("b2-servicios-busqueda");
    });

    const [received, inProgress] = ["received", "in_progress"].map(byCode);

    await scenario("S1", "estado activo: diálogo y edición ofrecen solo estados activos", async () => {
      assert.ok(inactiveNames().length >= 1, "the e2e catalogue has at least one deactivated status");
      const order = await createOrder("activo");
      await openOrder(order.id);
      const options = await dialogOptions();
      result.dialogs.activeOrderDialog = options;
      assert.deepEqual(options.map((o) => o.text), activeNames(), "dialog = active statuses in catalogue order");
      assert.ok(options.every((o) => !o.disabled), "every offered status is selectable");
      assert.equal(options.find((o) => o.selected)?.value, received.id);
      for (const name of inactiveNames()) assert.ok(!options.some((o) => o.text.startsWith(name)), `dialog offers ${name}`);
      await shoot("s1-dialogo-estado-activo");
      await dialog("Cambiar estado").getByRole("button", { name: "Cancelar" }).click();
      const edit = await editOptions();
      result.dialogs.activeOrderEdit = edit;
      assert.deepEqual(edit.map((o) => o.text), activeNames(), "edit select = active statuses");
      assert.ok(edit.every((o) => !o.disabled));
    });

    await scenario("S2", "estado actual desactivado: se ve «(desactivado)», no elegible, y se sale por la UI", async () => {
      let dlg = [...catalog.values()].find((s) => s.name === DIALOG_STATUS_NAME);
      const body = (active: boolean) => ({ name: DIALOG_STATUS_NAME, kind: "in_progress", active, sort_order: inProgress.sort_order ?? 2 });
      if (!dlg) {
        const created = await call("/api/order-statuses", "POST", body(true));
        assert.equal(created.status, 201, created.text);
        dlg = created.body.status as Status;
        result.dialogStatus = { id: dlg.id, created: true };
      } else {
        const on = await call(`/api/order-statuses/${dlg.id}`, "PATCH", body(true));
        assert.equal(on.status, 200, on.text);
        result.dialogStatus = { id: dlg.id, created: false };
      }
      const order = await createOrder("desactivado");
      try {
        const moved = await apiStatus(order.id, dlg.id);
        assert.equal(moved.status, 200, moved.text);
      } finally {
        const off = await call(`/api/order-statuses/${dlg.id}`, "PATCH", body(false));
        assert.equal(off.status, 200, off.text);
        assert.equal(off.body.status.active, false);
        result.dialogStatus.deactivatedAgain = true;
      }
      await loadCatalog();
      assert.equal(catalog.get(dlg.id)?.active, false);

      await openOrder(order.id);
      const expected = [...catalog.values()]
        .filter((s) => s.active || s.id === dlg!.id)
        .map((s) => (s.id === dlg!.id ? `${s.name}${INACTIVE_SUFFIX}` : s.name));
      const options = await dialogOptions();
      result.dialogs.inactiveOrderDialog = options;
      assert.deepEqual(options.map((o) => o.text), expected);
      const current = options.find((o) => o.value === dlg!.id);
      assert.ok(current?.selected && current.disabled, "current deactivated status: selected and not selectable");
      assert.equal(options.filter((o) => o.disabled).length, 1);
      for (const name of inactiveNames().filter((n) => n !== DIALOG_STATUS_NAME)) {
        assert.ok(!options.some((o) => o.text.startsWith(name)), `dialog offers ${name}`);
      }
      await shoot("s2-dialogo-estado-desactivado");
      await dialog("Cambiar estado").getByRole("button", { name: "Cancelar" }).click();

      const edit = await editOptions();
      result.dialogs.inactiveOrderEdit = edit;
      assert.deepEqual(edit.map((o) => o.text), expected);
      assert.ok(edit.find((o) => o.value === dlg!.id)?.selected);

      await uiChangeStatus(order.id, inProgress.name);
      const steps = await waitCurrent(inProgress.name);
      const visited = steps.find((s: any) => s.name === DIALOG_STATUS_NAME);
      assert.ok(visited?.inactive, "timeline keeps the deactivated status with its note");
      assert.equal((await detail(order.id)).status_id, inProgress.id);
      const after = await dialogOptions();
      assert.ok(!after.some((o) => o.value === dlg!.id), "once left, the deactivated status is no longer offered");
      await dialog("Cambiar estado").getByRole("button", { name: "Cancelar" }).click();
      result.timelineAfterLeaving = steps;
    });

    await scenario("S3", "la API sigue rechazando estados desactivados y de otro tenant", async () => {
      const id = result.orders.activo?.id;
      assert.ok(id, "order from S1");
      const before = await detail(id);
      const inactive = [...catalog.values()].find((s) => !s.active);
      assert.ok(inactive);
      const refused = await apiStatus(id, inactive.id);
      assert.equal(refused.status, 400, refused.text);
      const foreign = await apiStatus(id, FOREIGN_ORDER.statusId);
      assert.ok(foreign.status >= 400 && foreign.status < 500, `foreign status → ${foreign.status}`);
      assert.ok(!foreign.text.includes(FOREIGN_ORDER.reference));
      const after = await detail(id);
      assert.equal(after.status_id, before.status_id, "status unchanged");
      assert.equal(String(after.version), String(before.version), "no write");
      result.refusals = { inactive: refused.status, foreign: foreign.status };
    });

    await scenario("T1", "#146 + #153: estilos en instrucciones, cambio de estado por la UI, seguimiento e impresión", async () => {
      const description = `<p data-text-align="center"><span data-text-size="large" data-text-color="red">NO CORTAR ${run}</span></p><p>${tag} · formato</p>`;
      // «E2E Formato » prefix: order-rich-text.ts only accepts styled orders it recognises.
      const order = await createOrder("formato", { title: `E2E Formato integración ${run}`, description });
      const stored = await detail(order.id);
      assert.match(stored.description, /<p data-text-align="center"><span data-text-size="large" data-text-color="red">NO CORTAR /);
      await openOrder(order.id);
      const styled = p.locator('main [data-text-color="red"][data-text-size="large"]', { hasText: `NO CORTAR ${run}` });
      await styled.first().waitFor();
      assert.equal(await p.locator('main p[data-text-align="center"]', { hasText: `NO CORTAR ${run}` }).count(), 1);
      await uiChangeStatus(order.id, inProgress.name);
      const steps = await waitCurrent(inProgress.name);
      assert.deepEqual(steps.slice(0, 2).map((s: any) => [s.name, s.state]), [[received.name, "visited"], [inProgress.name, "current"]]);
      assert.equal(await styled.count(), 1, "styles still rendered after the live refresh");
      assert.equal((await detail(order.id)).description, stored.description, "description unchanged by the status change");
      await shoot("t1-formato-seguimiento");
      await p.goto(`${target.baseUrl}/orders/${order.id}/print`);
      await p.locator('[data-text-color="red"][data-text-size="large"]', { hasText: `NO CORTAR ${run}` }).first().waitFor();
      result.orders.formato.print = "styled";
    });

    await scenario("X1", "aislamiento: pedido, estado y catálogo de otro tenant", async () => {
      const read = await call(`/api/orders/${FOREIGN_ORDER.id}`);
      assert.equal(read.status, 404);
      assert.ok(!read.text.includes(FOREIGN_ORDER.reference));
      const statuses = await loadCatalog();
      assert.ok(!statuses.text.includes(FOREIGN_ORDER.statusId), "catalogue is the session tenant's only");
      const log = await call(`/api/orders/${FOREIGN_ORDER.id}/activity`);
      assert.equal(log.status, 404);
      assert.ok(!log.text.includes(FOREIGN_ORDER.reference));
      await p.goto(`${target.baseUrl}/orders/${FOREIGN_ORDER.id}`);
      await p.getByText("No se pudo cargar el pedido").waitFor();
      assert.equal(await p.getByRole("button", { name: "Cambiar estado", exact: true }).count(), 0);
      result.isolation = { order: read.status, activity: log.status, catalogueTenant: statuses.body.tenant };
    });

    result.catalogAfter = [...catalog.values()].map(({ id, code, name, active }) => ({ id, code, name, active }));
    assert.equal(catalog.get(result.dialogStatus?.id)?.active ?? false, false, "dialog status left deactivated");
    h.assertNoProductionEgress();
  } catch (error) {
    process.exitCode = 1;
    result.fatal = redactor.text(error instanceof Error ? error.message : String(error));
  } finally {
    result.blockedRequests = h.blocked;
    result.apiErrors = h.network.filter((entry) => entry.status === null || entry.status >= 400);
    result.consoleErrors = h.consoleErrors.length;
    for (const s of result.scenarios as Outcome[]) h.log(`${s.status} ${s.id} ${s.title}${s.detail ? ` — ${s.detail}` : ""}`);
    try { await h.finish(result); } catch (error) {
      process.exitCode = 1;
      console.error(redactor.text(`artifact check failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    console.log(redactor.text(`artifacts: ${dir}`));
  }
}

void main();
