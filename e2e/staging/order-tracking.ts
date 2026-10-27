/** Staging: visual order tracking V1.1 (#151, PR #153) on the real deployment.
 * Real login, real API routes/RPCs and real activity events of tenant `e2e`;
 * no API doubles. Shared guard + harness (egress interlock, redacted artifacts,
 * no Playwright traces).
 *
 * Scenarios (docs/ORDER-VISUAL-TRACKING-V1.md):
 *   new · skipped step («Sin registro») · delivered · cancelled · archived ·
 *   going back + reopening after Entregado · reopening after Cancelado ·
 *   deactivated historical status (one synthetic status, deactivated by the API) ·
 *   dates = activity created_at · viewports 1280/375 × light/dark · foreign tenant.
 *
 * Adds orders tagged `E2E-TRACK-<run>` (description) and, unless
 * E2E_TRACK_SKIP_STATUS=1, one inactive status «E2E track histórico <run>».
 * E2E_TRACK_READONLY=1: login and read an existing order only (no writes).
 *
 *   TZ=UTC PLAYWRIGHT_MODULE=/abs/playwright/index.mjs npx tsx e2e/staging/order-tracking.ts
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
/** Visible texts, hard-coded here on purpose (not imported from the code under test). */
const LABELS = {
  visited: "Pasó por este estado",
  current: "Estado actual",
  pending: "Pendiente",
  unconfirmed: "Sin registro",
} as const;
const ICON = { current: "circle-dot", visitedDone: "check", visitedBeyond: "history", unconfirmed: "circle-dashed", pending: "circle" };
const BROWSER_TZ = "Europe/Madrid";

type State = keyof typeof LABELS;
type Expected = { id: string; name: string; state: State; beyond: boolean; inactive?: boolean };
type UiStep = {
  name: string; state: string; beyond: boolean; label: string; ariaCurrent: boolean;
  datetime: string | null; dateText: string | null; inactiveNote: boolean; icons: string[];
};
type Status = { id: string; code: string; name: string; active: boolean; is_cancelled?: boolean; is_closed?: boolean; sort_order?: number };
type Activity = { id: string; action: string; entity_type: string; entity_id: string; created_at: string; new_values: any; previous_values: any };
type Outcome = { id: string; title: string; status: "PASS" | "FAIL" | "SKIP"; detail?: string; ms?: number };

const fmt = new Intl.DateTimeFormat("es-ES", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: BROWSER_TZ,
});

async function main() {
  const target = resolveStagingTarget();
  const email = requireSyntheticEmail(process.env.E2E_USER_EMAIL);
  const password = process.env.E2E_USER_PASSWORD;
  assert.ok(password, "E2E_USER_PASSWORD is required");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined;
  const readOnly = process.env.E2E_TRACK_READONLY === "1";
  const run = runId();
  const tag = `E2E-TRACK-${run}`;
  const dir = process.env.E2E_ARTIFACTS_DIR
    ? path.join(process.env.E2E_ARTIFACTS_DIR, `order-tracking-${run}`)
    : path.join("e2e-artifacts", `order-tracking-${run}`);
  const redactor = new Redactor([password, bypass]);
  const h = new Harness(target, redactor, dir, bypass);
  const result: any = {
    run, tag, baseUrl: target.baseUrl, deploymentSha: process.env.E2E_DEPLOYMENT_SHA ?? null,
    browserTimezone: BROWSER_TZ, readOnly, scenarios: [] as Outcome[], orders: {} as Record<string, any>,
    createdStatus: null as any, catalog: [] as Status[], dates: [] as any[], screenshots: [] as string[],
    observations: [] as string[],
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
    h.log(`${method} ${url} → ${r.status()}`);
    return { status: r.status(), body, text };
  }
  const detail = async (id: string) => {
    const r = await call(`/api/orders/${id}`); assert.equal(r.status, 200, r.text); return r.body.order;
  };
  const activity = async (id: string): Promise<Activity[]> => {
    const r = await call(`/api/orders/${id}/activity`); assert.equal(r.status, 200, r.text);
    return r.body.activity as Activity[];
  };

  async function createOrder(label: string) {
    const r = await call("/api/orders", "POST", {
      title: `E2E Track ${label} ${run}`,
      description: `<p>${tag} · ${label}</p>`,
    });
    assert.equal(r.status, 201, r.text);
    const order = r.body.order;
    assert.equal(order.status?.code, "received", "new orders start in the initial status");
    result.orders[label] = { id: order.id, reference: order.reference, title: order.title, transitions: [] as string[] };
    h.log(`order ${label}: ${order.reference} (${order.id})`);
    return order.id as string;
  }

  async function changeStatus(label: string, statusId: string) {
    const order = result.orders[label];
    const before = await detail(order.id);
    const r = await call(`/api/orders/${order.id}`, "PATCH", { status_id: statusId, expected_version: String(before.version) });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.status?.id ?? r.body.order?.status_id, statusId);
    order.transitions.push(catalog.get(statusId)?.name ?? statusId);
  }

  /** Steps of the real timeline, once its data finished loading. */
  async function readTimeline(): Promise<UiStep[]> {
    const list = p.locator('ol[aria-label="Recorrido del pedido"][data-tracking-status="ready"]');
    await list.waitFor({ timeout: 30_000 });
    return list.evaluate((ol: HTMLOListElement) => [...ol.children].map((li) => {
      const time = li.querySelector("time");
      const meta = li.querySelector("[data-step-label]")?.parentElement;
      const extra = [...(meta?.children ?? [])].find((el) => el !== li.querySelector("[data-step-label]") && el.tagName !== "TIME");
      const svg = li.querySelector("svg");
      return {
        name: li.querySelector("[data-step-name]")?.textContent?.trim() ?? "",
        state: li.getAttribute("data-step-state") ?? "",
        beyond: li.getAttribute("data-beyond-current") === "true",
        label: li.querySelector("[data-step-label]")?.textContent?.trim() ?? "",
        ariaCurrent: li.getAttribute("aria-current") === "step",
        datetime: time?.getAttribute("datetime") ?? null,
        dateText: time?.textContent?.trim() ?? extra?.textContent?.trim() ?? null,
        inactiveNote: [...li.querySelectorAll("p")].some((el) => el.textContent?.trim() === "Estado desactivado"),
        icons: [...(svg?.classList ?? [])].filter((c) => c.startsWith("lucide-")).map((c) => c.slice(7)),
      };
    }));
  }

  async function openOrder(id: string) {
    await p.goto(`${target.baseUrl}/orders/${id}`);
    await p.getByRole("heading", { level: 2, name: "Seguimiento del pedido" }).waitFor();
  }

  /** Latest explicit entry into each status (order.created / order.status_changed). */
  function entries(events: Activity[], orderId: string) {
    const latest = new Map<string, Activity>();
    for (const event of events) {
      if (event.entity_type !== "order" || event.entity_id !== orderId) continue;
      if (event.action !== "order.created" && event.action !== "order.status_changed") continue;
      const id = event.new_values?.status_id;
      if (!id) continue;
      const known = latest.get(id);
      if (!known || Date.parse(event.created_at) > Date.parse(known.created_at)) latest.set(id, event);
    }
    return latest;
  }

  /** Compares the rendered timeline with the expected steps and the real events. */
  async function expectTimeline(label: string, expected: Expected[], ui?: UiStep[]) {
    const order = result.orders[label];
    const steps = ui ?? await readTimeline();
    const events = await activity(order.id);
    const api = await detail(order.id);
    const latest = entries(events, order.id);
    const statusEvents = events.filter((e) => e.action === "order.status_changed" && e.entity_id === order.id);
    assert.equal(statusEvents.length, order.transitions.length, `${label}: one status event per real transition`);
    assert.deepEqual(
      steps.map((s) => ({ name: s.name, state: s.state, beyond: s.beyond, inactive: s.inactiveNote })),
      expected.map((e) => ({ name: e.name, state: e.state, beyond: e.beyond, inactive: e.inactive === true })),
      `${label}: steps`,
    );
    assert.equal(steps.filter((s) => s.ariaCurrent).length, 1, `${label}: exactly one aria-current step`);
    const currentIndex = expected.findIndex((e) => e.state === "current");
    assert.equal(expected[currentIndex].id, api.status_id, `${label}: current step = orders.status_id`);
    assert.ok(steps[currentIndex].ariaCurrent);
    for (const [index, step] of steps.entries()) {
      const want = expected[index];
      const where = `${label}/${step.name}`;
      assert.equal(step.label, LABELS[want.state], `${where}: label`);
      const icon = want.state === "current" ? ICON.current
        : want.state === "visited" ? (want.beyond ? ICON.visitedBeyond : ICON.visitedDone)
          : want.state === "unconfirmed" ? ICON.unconfirmed : ICON.pending;
      assert.ok(step.icons.includes(icon), `${where}: icon ${icon}, got ${step.icons.join(",")}`);
      if (want.beyond) assert.ok(!step.icons.includes("check"), `${where}: no ✓ beyond the current step`);
      const entry = latest.get(want.id);
      if (want.state === "pending" || want.state === "unconfirmed") {
        assert.equal(entry, undefined, `${where}: no evidence expected`);
        assert.equal(step.datetime, null, `${where}: no date without evidence`);
        assert.equal(step.dateText, null, `${where}: no date text without evidence`);
        continue;
      }
      if (!entry) {
        assert.equal(step.datetime, null, `${where}: no invented date`);
        assert.equal(step.dateText, want.state === "current" ? "Sin fecha registrada" : null, `${where}: undated text`);
        continue;
      }
      assert.equal(step.datetime, entry.created_at, `${where}: <time datetime> = activity created_at`);
      const prefix = want.state === "current" ? "Desde el" : "Registrado el";
      assert.equal(step.dateText, `${prefix} ${fmt.format(new Date(entry.created_at))}`, `${where}: date text`);
      result.dates.push({ order: label, orderId: order.id, step: step.name, state: want.state, eventId: entry.id, action: entry.action, created_at: entry.created_at, shown: step.dateText });
    }
    return steps;
  }

  const step = (s: Status, state: State, beyond: boolean, inactive = false): Expected =>
    ({ id: s.id, name: s.name, state, beyond, inactive });

  /** Polls the live timeline (no reload) until the current step has the wanted name and a date. */
  async function waitCurrent(name: string) {
    const end = Date.now() + 30_000;
    let last: UiStep[] = [];
    while (Date.now() < end) {
      last = await readTimeline();
      const current = last.find((s) => s.state === "current");
      if (current?.name === name && current.datetime) return last;
      await p.waitForTimeout(500);
    }
    throw new Error(`timeline did not show ${name} as current: ${JSON.stringify(last.map((s) => [s.name, s.state]))}`);
  }

  const dialog = (title: string) => p.getByRole("dialog").filter({ has: p.getByRole("heading", { name: title }) });

  async function uiChangeStatus(label: string, status: Status, confirmTitle?: string) {
    const order = result.orders[label];
    await p.getByRole("button", { name: "Cambiar estado", exact: true }).click();
    const statusDialog = dialog("Cambiar estado");
    await statusDialog.getByLabel("Estado").selectOption({ label: status.name });
    const patched = p.waitForResponse((r: any) => r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/orders/${order.id}`);
    patched.catch(() => undefined);
    await statusDialog.getByRole("button", { name: "Guardar estado" }).click();
    if (confirmTitle) await dialog(confirmTitle).getByRole("button", { name: "Confirmar entrega" }).click();
    const response = await patched;
    assert.equal(response.status(), 200, `UI status change → HTTP ${response.status()}`);
    order.transitions.push(status.name);
    await p.getByText("Estado actualizado").first().waitFor();
    return waitCurrent(status.name);
  }

  async function scenario(id: string, title: string, fn: () => Promise<void>) {
    const started = Date.now();
    try {
      await h.step(`${id} ${title}`, fn, 240_000);
      result.scenarios.push({ id, title, status: "PASS", ms: Date.now() - started });
    } catch (error) {
      process.exitCode = 1;
      result.scenarios.push({ id, title, status: "FAIL", ms: Date.now() - started, detail: redactor.text(error instanceof Error ? error.message : String(error)).slice(0, 1500) });
    }
  }
  const skip = (id: string, title: string, detail: string) => result.scenarios.push({ id, title, status: "SKIP", detail });

  const trackingCard = () => p.locator("section").filter({ has: p.getByRole("heading", { level: 2, name: "Seguimiento del pedido" }) });

  async function shoot(name: string) {
    const file = path.join(dir, `${name}.png`);
    await trackingCard().screenshot({ path: file });
    result.screenshots.push(path.basename(file));
  }
  async function shootPage(name: string) {
    const file = path.join(dir, `${name}.png`);
    // App navigation (tenant brand, user menu) is masked; order content is synthetic.
    await p.screenshot({ path: file, fullPage: true, mask: [p.locator("header").filter({ has: p.locator("nav") })] });
    result.screenshots.push(path.basename(file));
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
      const statuses = await call("/api/order-statuses");
      assert.equal(statuses.status, 200);
      assert.equal(statuses.body.tenant, "e2e");
      for (const s of statuses.body.statuses as Status[]) catalog.set(s.id, s);
      result.catalog = [...catalog.values()].map(({ id, code, name, active, sort_order }) => ({ id, code, name, active, sort_order }));
      for (const code of ["received", "in_progress", "ready", "closed", "cancelled"]) assert.ok(byCode(code).active);
    });

    if (readOnly) {
      await scenario("RO", "lectura de un pedido existente (sin escrituras)", async () => {
        const id = process.env.E2E_TRACK_READ_ORDER_ID;
        assert.ok(id, "E2E_TRACK_READ_ORDER_ID is required in read-only mode");
        await openOrder(id);
        result.readOnlySteps = await readTimeline();
      });
    } else {
      const [received, inProgress, ready, closed, cancelled] =
        ["received", "in_progress", "ready", "closed", "cancelled"].map(byCode);

      await scenario("1", "pedido nuevo: inicial actual, resto pendiente, fecha del evento real", async () => {
        await createOrder("nuevo");
        await openOrder(result.orders.nuevo.id);
        const steps = await expectTimeline("nuevo", [
          step(received, "current", false), step(inProgress, "pending", true),
          step(ready, "pending", true), step(closed, "pending", true),
        ]);
        const created = (await activity(result.orders.nuevo.id)).find((e) => e.action === "order.created");
        assert.equal(steps[0].datetime, created?.created_at, "creation date = order.created event");
        // The card's only interactive element is the help link: no write control in the timeline.
        const card = trackingCard();
        assert.equal(await card.locator("a, button, input, select, textarea").count(), 1);
        assert.equal(await card.getByRole("link", { name: "Ayuda sobre el seguimiento del pedido" }).getAttribute("href"),
          "/ayuda/pedidos/estados-y-prioridades#consultar-el-seguimiento");
        await shoot("01-nuevo-1280-light");
      });

      await scenario("2b", "paso saltado con datos reales: «Sin registro» sin fecha", async () => {
        await createOrder("saltado");
        await changeStatus("saltado", ready.id);
        await openOrder(result.orders.saltado.id);
        await expectTimeline("saltado", [
          step(received, "visited", false), step(inProgress, "unconfirmed", false),
          step(ready, "current", false), step(closed, "pending", true),
        ]);
        await shoot("02b-saltado-1280-light");
      });

      await scenario("3", "Listo → Entregado por la UI real (refresco sin recarga) y tras recargar", async () => {
        await createOrder("entregado");
        await openOrder(result.orders.entregado.id);
        let live = await uiChangeStatus("entregado", inProgress);
        await expectTimeline("entregado", [
          step(received, "visited", false), step(inProgress, "current", false),
          step(ready, "pending", true), step(closed, "pending", true),
        ], live);
        live = await uiChangeStatus("entregado", ready);
        await expectTimeline("entregado", [
          step(received, "visited", false), step(inProgress, "visited", false),
          step(ready, "current", false), step(closed, "pending", true),
        ], live);
        live = await uiChangeStatus("entregado", closed, "Marcar pedido como entregado");
        const final = [
          step(received, "visited", false), step(inProgress, "visited", false),
          step(ready, "visited", false), step(closed, "current", false),
        ];
        await expectTimeline("entregado", final, live);
        const order = await detail(result.orders.entregado.id);
        assert.ok(order.ready_at && order.delivered_at, "ready_at and delivered_at set by the real lifecycle");
        await p.reload();
        await expectTimeline("entregado", final);
      });

      await scenario("4", "pedido cancelado", async () => {
        await createOrder("cancelado");
        await changeStatus("cancelado", inProgress.id);
        await changeStatus("cancelado", cancelled.id);
        await openOrder(result.orders.cancelado.id);
        await expectTimeline("cancelado", [
          step(received, "visited", false), step(inProgress, "visited", false),
          step(ready, "unconfirmed", false), step(closed, "unconfirmed", false),
          step(cancelled, "current", false),
        ]);
        await shoot("04-cancelado-1280-light");
      });

      await scenario("5", "pedido archivado (ruta real) sigue consultable con el mismo seguimiento", async () => {
        await createOrder("archivado");
        for (const s of [inProgress, ready, closed]) await changeStatus("archivado", s.id);
        const expected = [
          step(received, "visited", false), step(inProgress, "visited", false),
          step(ready, "visited", false), step(closed, "current", false),
        ];
        await openOrder(result.orders.archivado.id);
        const before = await expectTimeline("archivado", expected);
        const archived = await call(`/api/orders/${result.orders.archivado.id}/archive`, "PATCH");
        assert.equal(archived.status, 200, archived.text);
        const order = await detail(result.orders.archivado.id);
        assert.ok(order.archived_at, "archived_at set");
        await p.reload();
        await p.getByText("Pedido archivado · solo consulta").waitFor();
        assert.equal(await p.getByRole("button", { name: "Cambiar estado", exact: true }).count(), 0, "no status control when archived");
        const after = await expectTimeline("archivado", expected);
        assert.deepEqual(after, before, "archiving adds no step and changes no date");
        result.orders.archivado.archived_at = order.archived_at;
        await shoot("05-archivado-1280-light");
      });

      await scenario("6a", "retroceso Listo → En proceso y reapertura tras Entregado", async () => {
        await createOrder("reabierto");
        for (const s of [inProgress, ready, inProgress]) await changeStatus("reabierto", s.id);
        await openOrder(result.orders.reabierto.id);
        await expectTimeline("reabierto", [
          step(received, "visited", false), step(inProgress, "current", false),
          step(ready, "visited", true), step(closed, "pending", true),
        ]);
        await shoot("06a-retroceso-1280-light");
        for (const s of [ready, closed, inProgress]) await changeStatus("reabierto", s.id);
        await p.reload();
        await expectTimeline("reabierto", [
          step(received, "visited", false), step(inProgress, "current", false),
          step(ready, "visited", true), step(closed, "visited", true),
        ]);
        await shoot("06a-reabierto-1280-light");
      });

      await scenario("6b", "reapertura tras Cancelado", async () => {
        await createOrder("reabierto-cancelado");
        for (const s of [cancelled, inProgress]) await changeStatus("reabierto-cancelado", s.id);
        await openOrder(result.orders["reabierto-cancelado"].id);
        await expectTimeline("reabierto-cancelado", [
          step(received, "visited", false), step(inProgress, "current", false),
          step(ready, "pending", true), step(closed, "pending", true), step(cancelled, "visited", true),
        ]);
        await shoot("06b-reabierto-cancelado-1280-light");
      });

      if (process.env.E2E_TRACK_SKIP_STATUS === "1") {
        skip("7", "estado histórico desactivado", "E2E_TRACK_SKIP_STATUS=1");
      } else {
        await scenario("7", "estado histórico desactivado por la API real", async () => {
          const name = `E2E track histórico ${run}`;
          const body = { name, kind: "in_progress", active: true, sort_order: ready.sort_order ?? 3 };
          const created = await call("/api/order-statuses", "POST", body);
          assert.equal(created.status, 201, created.text);
          const hist: Status = created.body.status;
          result.createdStatus = { id: hist.id, code: hist.code, name: hist.name, sort_order: body.sort_order, active: true };
          catalog.set(hist.id, hist);
          try {
            await createOrder("historico");
            await changeStatus("historico", hist.id);
          } finally {
            const off = await call(`/api/order-statuses/${hist.id}`, "PATCH", { ...body, active: false });
            assert.equal(off.status, 200, off.text);
            assert.equal(off.body.status.active, false);
            result.createdStatus.active = false;
            result.createdStatus.deactivated = true;
          }
          const inactive = { ...hist, active: false };
          await openOrder(result.orders.historico.id);
          await expectTimeline("historico", [
            step(received, "visited", false), step(inProgress, "unconfirmed", false),
            step(inactive, "current", false, true), step(ready, "pending", true), step(closed, "pending", true),
          ]);
          await shoot("07-historico-actual-1280-light");
          const refused = await call(`/api/orders/${result.orders.nuevo.id}`, "PATCH",
            { status_id: hist.id, expected_version: String((await detail(result.orders.nuevo.id)).version) });
          assert.notEqual(refused.status, 200, "an inactive status cannot be chosen again");
          result.inactiveStatusRefused = refused.status;
          await changeStatus("historico", ready.id);
          await p.reload();
          await expectTimeline("historico", [
            step(received, "visited", false), step(inProgress, "unconfirmed", false),
            step(inactive, "visited", false, true), step(ready, "current", false), step(closed, "pending", true),
          ]);
          await shoot("07-historico-visitado-1280-light");
          // An order that never visited it does not show it.
          await openOrder(result.orders.nuevo.id);
          await expectTimeline("nuevo", [
            step(received, "current", false), step(inProgress, "pending", true),
            step(ready, "pending", true), step(closed, "pending", true),
          ]);
          await p.getByRole("button", { name: "Cambiar estado", exact: true }).click();
          const options: string[] = await dialog("Cambiar estado").getByLabel("Estado").locator("option").allTextContents();
          result.observations.push(`Diálogo «Cambiar estado» tras desactivar: ${options.includes(name) ? "incluye" : "no incluye"} el estado inactivo`);
          await dialog("Cambiar estado").getByRole("button", { name: "Cancelar" }).click();
        });
      }

      await scenario("8", "fechas = activity_log.created_at (vía API de actividad)", async () => {
        assert.ok(result.dates.length >= 20, `dated steps checked: ${result.dates.length}`);
        for (const d of result.dates) assert.ok(d.eventId && d.created_at && d.shown);
      });

      await scenario("9", "escritorio 1280×800 y móvil 375×812, claro y oscuro", async () => {
        const combos = [
          { vp: "1280", size: { width: 1280, height: 800 }, scheme: "light" },
          { vp: "1280", size: { width: 1280, height: 800 }, scheme: "dark" },
          { vp: "375", size: { width: 375, height: 812 }, scheme: "light" },
          { vp: "375", size: { width: 375, height: 812 }, scheme: "dark" },
        ];
        const layouts: any[] = [];
        for (const label of ["entregado", "reabierto"]) {
          for (const c of combos) {
            await p.setViewportSize(c.size);
            await p.emulateMedia({ colorScheme: c.scheme });
            await openOrder(result.orders[label].id);
            await p.waitForFunction((dark: boolean) => document.documentElement.classList.contains("dark") === dark, c.scheme === "dark");
            await readTimeline();
            const layout = await trackingCard().evaluate((section: HTMLElement) => {
              const li = section.querySelector("ol > li")!;
              const name = li.querySelector("[data-step-name]")!.getBoundingClientRect();
              const tag = li.querySelector("[data-step-label]")!.getBoundingClientRect();
              return {
                overflowX: document.documentElement.scrollWidth - window.innerWidth,
                sameRow: Math.abs(tag.top - name.top) < 8 && tag.left > name.right,
                stacked: tag.top >= name.bottom - 2,
                cardBg: getComputedStyle(section).backgroundColor,
                text: getComputedStyle(section.querySelector("[data-step-name]")!).color,
              };
            });
            assert.ok(layout.overflowX <= 0, `${label} ${c.vp}/${c.scheme}: horizontal overflow ${layout.overflowX}px`);
            if (c.vp === "1280") assert.ok(layout.sameRow, `${label} ${c.vp}: name and situation on one row`);
            else assert.ok(layout.stacked, `${label} ${c.vp}: situation below the name`);
            layouts.push({ label, ...c, ...layout });
            await shoot(`09-${label}-${c.vp}-${c.scheme}`);
            if (label === "entregado") await shootPage(`09-${label}-${c.vp}-${c.scheme}-pagina`);
          }
        }
        for (const label of ["entregado", "reabierto"]) {
          const light = layouts.find((l) => l.label === label && l.vp === "1280" && l.scheme === "light");
          const dark = layouts.find((l) => l.label === label && l.vp === "1280" && l.scheme === "dark");
          assert.notEqual(light.cardBg, dark.cardBg, `${label}: dark theme applied to the card`);
        }
        result.layouts = layouts;
        await p.setViewportSize({ width: 1280, height: 800 });
        await p.emulateMedia({ colorScheme: "light" });
      });
    }

    await scenario("11", "aislamiento: pedido de otro tenant (demo) → 404 sin datos", async () => {
      const read = await call(`/api/orders/${FOREIGN_ORDER.id}`);
      const log = await call(`/api/orders/${FOREIGN_ORDER.id}/activity`);
      const statuses = await call("/api/order-statuses");
      for (const [what, r] of [["detail", read], ["activity", log]] as const) {
        assert.equal(r.status, 404, `${what}: ${r.status}`);
        assert.ok(!r.text.includes(FOREIGN_ORDER.reference) && !r.text.includes(FOREIGN_ORDER.statusId), `${what} leaks foreign data`);
      }
      assert.equal(statuses.body.tenant, "e2e");
      assert.ok(!statuses.text.includes(FOREIGN_ORDER.statusId), "catalog is the session tenant's only");
      await p.goto(`${target.baseUrl}/orders/${FOREIGN_ORDER.id}`);
      await p.getByText("No se pudo cargar el pedido").waitFor();
      assert.equal(await p.locator('ol[aria-label="Recorrido del pedido"]').count(), 0, "no timeline for a foreign order");
      const text: string = await p.locator("body").innerText();
      assert.ok(!text.includes(FOREIGN_ORDER.reference), "UI leaks the foreign reference");
      result.isolation = { detail: read.status, activity: log.status, ui: "No se pudo cargar el pedido" };
      await shootPage("11-pedido-ajeno-1280-light");
    });

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
