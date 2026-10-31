/**
 * SUR4 E10 · DEMO: post-its, work sequence, custom labels and the work sheet
 * across the four synthetic tenants of the feature matrix (contract §11),
 * through the real UI, API and database. Run seed-sur4.ts first.
 *
 *   set -a; source .env.e2e-sur4.local; set +a
 *   PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs npx tsx e2e/staging/sur4-features.ts
 *
 * Per tenant, with its synthetic owner: team, service and stores through the
 * app API; four orders (nothing, legacy notes, service outside and inside the
 * description); what the order page, the API, the work sheet and the receipt
 * PDF show for the tenant's features; post-its (internal, printable after
 * confirmation, pinned, unpinned, voided, legacy conversion) and the sequence
 * (suggested stages, three steps: two people and one unassigned, first marked
 * done) from the order page. Then: features off and on keep the data; the
 * viewer of completo reads but cannot write; every tenant is denied every
 * other tenant's order, notes and steps through the app and through
 * PostgREST with its own JWT (RLS, tenant_id).
 *
 * Adds orders, notes, steps, stages, team, one service and one store to the
 * four `e2e-sur4-*` tenants only; changes nothing else. The feature off/on
 * phase uses the audited set_tenant_feature_v2 and always restores the matrix.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded at runtime, outside package.json. */
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { orderLabels } from "../../lib/orders/labels";
import { LEGACY_NOTES_NOTICE } from "../../lib/print/work-sheet-rules";
import { drawnLines } from "../../lib/quotes/pdf/pdf-inspect";
import { resolveSur4Targets, type StagingTarget, type Sur4TenantSlug } from "./guard";
import { Harness, type Page } from "./harness";
import { Redactor } from "./redact";
import { adminClient, setFeature } from "./sur4-admin";
import { SUR4_MATRIX, SUR4_SERVICE, SUR4_TEAM, ownerEmail, type Sur4Tenant } from "./sur4-matrix";
import { runId } from "./synthetic";

type Call = { status: number; body: any };

type Ctx = {
  t: Sur4Tenant;
  target: StagingTarget;
  h: Harness;
  p: Page;
  tenantId: string;
  team: Record<string, string>;
  serviceId: string;
  storeId: string;
  orders: Record<"plain" | "legacy" | "outside" | "inside", any>;
  notes: { internal?: string; printable?: string; voided?: string; converted?: string };
  steps: string[];
  checks: Record<string, unknown>;
};

const env = process.env;

async function main() {
  const targets = resolveSur4Targets();
  const password = env.E2E_SUR4_PASSWORD ?? "";
  const secretKey = env.E2E_SUPABASE_SECRET_KEY ?? "";
  const publishableKey = env.E2E_SUPABASE_PUBLISHABLE_KEY ?? "";
  const operator = (env.E2E_SUR4_OPERATOR ?? "").trim();
  const bypass = targets.mode === "local" ? undefined : env.VERCEL_AUTOMATION_BYPASS_SECRET;
  assert.ok(password.length >= 16, "E2E_SUR4_PASSWORD is required");
  assert.ok(publishableKey, "E2E_SUPABASE_PUBLISHABLE_KEY is required (PostgREST checks with each tenant's own JWT)");
  assert.ok(operator, "E2E_SUR4_OPERATOR is required (the feature off/on phase is audited)");
  assert.ok(env.PLAYWRIGHT_MODULE, "PLAYWRIGHT_MODULE is required");

  const run = runId();
  const dir = path.join(env.E2E_ARTIFACTS_DIR ?? "e2e-artifacts", `sur4-features-${run}`);
  const redactor = new Redactor([password, secretKey, publishableKey, bypass]);
  const admin = adminClient(targets, secretKey);
  const W = {
    internal: `TESTIGO-POSTIT-INTERNO-${run}`,
    printable: `POSTIT-IMPRIMIBLE-${run}`,
    voided: `TESTIGO-POSTIT-ANULADO-${run}`,
    legacy: `TESTIGO-NOTAS-PEDIDO-${run}`,
  };
  const result: any = {
    run,
    mode: targets.mode,
    deploymentSha: env.E2E_DEPLOYMENT_SHA ?? null,
    tenants: {},
    checks: {},
  };
  const ctxs: Ctx[] = [];

  async function call(c: { p: Page; target: StagingTarget }, url: string, method = "GET", data?: unknown): Promise<Call> {
    assert.ok(url.startsWith("/api/") || url.startsWith("/orders/"));
    const r = await c.p.request.fetch(c.target.baseUrl + url, { method, data, timeout: 60_000, maxRedirects: 0 });
    const type = r.headers()["content-type"] ?? "";
    if (type.includes("application/pdf")) return { status: r.status(), body: await r.body() };
    const text = await r.text();
    let body: any;
    try { body = JSON.parse(text); } catch { body = { text: text.slice(0, 300) }; }
    return { status: r.status(), body };
  }

  async function login(p: Page, target: StagingTarget, email: string) {
    await p.goto(target.baseUrl + "/auth/login");
    await p.locator("#email").fill(email);
    await p.locator("#password").fill(password);
    await Promise.all([
      p.waitForURL((u: URL) => u.origin === target.baseUrl && !u.pathname.startsWith("/auth/"), { timeout: 60_000 }),
      p.getByRole("button", { name: "Login", exact: true }).click(),
    ]);
    await p.evaluate(() => localStorage.setItem("gestcopy-theme", "light"));
  }

  const settle = (p: Page) => p.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);

  async function openOrder(c: Ctx, order: any) {
    await c.p.goto(`${c.target.baseUrl}/orders/${order.id}`);
    await c.p.getByText(order.reference, { exact: false }).first().waitFor({ timeout: 45_000 });
    await settle(c.p);
  }

  async function printSheet(c: Ctx, order: any) {
    await c.p.goto(`${c.target.baseUrl}/orders/${order.id}/print`);
    const sheet = c.p.locator(".print-sheet").first();
    await sheet.waitFor({ timeout: 45_000 });
    await settle(c.p);
    return {
      text: await sheet.innerText(),
      ficha: (await c.p.locator(".ws-head").count()) > 0,
      notes: (await c.p.locator(".ws-notes").count()) > 0 ? await c.p.locator(".ws-notes").innerText() : null,
      steps: await c.p.locator(".ws-step").evaluateAll((items: Element[]) =>
        items.map((li) => ({ text: (li as HTMLElement).innerText, done: li.querySelector(".ws-check-mark") !== null }))),
      service: (await c.p.locator(".ws-service").count()) > 0 ? (await c.p.locator(".ws-service").innerText()).trim() : null,
      referenceNote: (await c.p.locator(".print-reference-note").count()) > 0
        ? (await c.p.locator(".print-reference-note").innerText()).trim()
        : null,
      notice: (await c.p.locator(".print-notice").count()) > 0 ? (await c.p.locator(".print-notice").innerText()).trim() : null,
    };
  }

  async function receiptLines(c: Ctx, order: any): Promise<string[]> {
    const r = await call(c, `/api/orders/${order.id}/receipt`);
    assert.equal(r.status, 200, `receipt ${order.reference}: HTTP ${r.status}`);
    const pdf = await PDFDocument.load(r.body);
    return pdf.getPages().flatMap((page) => drawnLines(pdf, page).map((line) => line.text));
  }

  // ------------------------------------------------------------------ tenant
  async function openTenant(t: Sur4Tenant): Promise<Ctx> {
    const target = targets.tenants[t.slug];
    const h = new Harness(target, redactor, path.join(dir, t.slug), bypass);
    const c: Ctx = {
      t, target, h, p: null, tenantId: "", team: {}, serviceId: "", storeId: "",
      orders: {} as Ctx["orders"], notes: {}, steps: [], checks: {},
    };
    ctxs.push(c);
    result.tenants[t.slug] = c.checks;
    await h.start(env.PLAYWRIGHT_MODULE!);
    c.p = h.page;

    await h.step(`${t.slug}: login as the synthetic owner`, async () => {
      await login(c.p, target, ownerEmail(t.slug));
      const ctx = await call(c, "/api/context");
      assert.equal(ctx.status, 200);
      assert.equal(ctx.body.tenant.slug, t.slug);
      assert.equal(ctx.body.membership.role, "owner");
      c.tenantId = ctx.body.tenant.id;
      c.checks.login = true;
    });
    return c;
  }

  async function catalog(c: Ctx) {
    await c.h.step(`${c.t.slug}: team, service and stores`, async () => {
      const team = await call(c, "/api/team");
      assert.equal(team.status, 200);
      for (const person of SUR4_TEAM) {
        let row = team.body.members.find((m: any) => m.name === person.name);
        if (!row) {
          const created = await call(c, "/api/team", "POST", person);
          assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
          row = created.body.member;
        }
        assert.equal(row.can_receive_orders, person.can_receive_orders, person.name);
        c.team[person.name] = row.id;
      }

      const services = await call(c, "/api/services");
      assert.equal(services.status, 200);
      let service = services.body.services.find((s: any) => s.name === SUR4_SERVICE);
      if (!service) {
        const created = await call(c, "/api/services", "POST", { name: SUR4_SERVICE });
        assert.ok([200, 201].includes(created.status), JSON.stringify(created.body).slice(0, 200));
        service = created.body.service;
      }
      c.serviceId = service.id;

      let stores = await call(c, "/api/stores");
      assert.equal(stores.status, 200);
      for (const name of c.t.extraStores) {
        if (stores.body.stores.some((s: any) => s.name === name)) continue;
        const created = await call(c, "/api/stores", "POST", { name });
        assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 200));
      }
      stores = await call(c, "/api/stores");
      const active = stores.body.stores.filter((s: any) => s.active);
      assert.equal(active.length, 1 + c.t.extraStores.length, `${c.t.slug} must have ${1 + c.t.extraStores.length} active stores`);
      c.storeId = (active.find((s: any) => c.t.extraStores.includes(s.name)) ?? active[0]).id;
      c.checks.catalog = { team: Object.keys(c.team).length, activeStores: active.length };
    });

    // Without stages the order page offers no sequence at all, so they come first.
    if (c.t.features.workSequence) {
      await c.h.step(`${c.t.slug}: suggested work stages`, async () => {
        let stages = await call(c, "/api/work-stages");
        if (stages.body.stages.filter((s: any) => s.active).length < 3) {
          const created = await call(c, "/api/work-stages", "POST", { suggested: true });
          assert.ok([200, 201].includes(created.status), JSON.stringify(created.body).slice(0, 200));
          stages = await call(c, "/api/work-stages");
        }
        assert.ok(stages.body.stages.filter((s: any) => s.active).length >= 3);
        c.checks.stages = stages.body.stages.length;
      });
    }
  }

  async function createOrders(c: Ctx) {
    await c.h.step(`${c.t.slug}: four orders through the API`, async () => {
      const create = async (payload: Record<string, unknown>) => {
        const r = await call(c, "/api/orders", "POST", payload);
        assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 200));
        return r.body.order;
      };
      c.orders.plain = await create({ title: `E10 ${run} sin nada`, priority: "urgent" });
      c.orders.legacy = await create({ title: `E10 ${run} notas antiguas`, notes: `<p>${W.legacy}</p>` });
      c.orders.outside = await create({
        title: `E10 ${run} servicio fuera`,
        description: "<p>Doble cara, 350 g</p>",
        service_id: c.serviceId,
        store_id: c.storeId,
      });
      c.orders.inside = await create({
        title: `E10 ${run} servicio dentro`,
        description: `<p>${SUR4_SERVICE} en couché mate</p>`,
        service_id: c.serviceId,
      });
      assert.equal(c.orders.outside.store_id, c.storeId);
      c.checks.orders = Object.fromEntries(Object.entries(c.orders).map(([k, o]) => [k, o.reference]));
    });
  }

  async function matrixOnPage(c: Ctx) {
    const f = c.t.features;
    await c.h.step(`${c.t.slug}: the order page follows the features`, async () => {
      await openOrder(c, c.orders.outside);
      const p = c.p;
      assert.equal((await p.locator("#order-postits").count()) > 0, f.stickyNotes, "Post-its panel");
      assert.equal((await p.getByRole("button", { name: "Añadir secuencia" }).count()) > 0, f.workSequence, "«Añadir secuencia»");
      const labels = orderLabels({ custom: f.customLabels });
      const other = orderLabels({ custom: !f.customLabels });
      const factLabels = (await p.locator(".gc-fact-label").allInnerTexts()).map((x: string) => x.trim().replace(/:$/, ""));
      assert.ok(factLabels.includes(labels.description), `«${labels.description}» label (got ${factLabels.join(" | ")})`);
      assert.equal(factLabels.includes(other.description), false, `no «${other.description}» label`);
      const text = await p.locator("main").innerText();
      assert.ok(text.includes(labels.total), `«${labels.total}»`);
      assert.equal(text.includes(other.total), false, `no «${other.total}»`);
      c.checks.page = { postits: f.stickyNotes, sequence: f.workSequence, labels: labels.description };
    });

    await c.h.step(`${c.t.slug}: the API follows the features`, async () => {
      const id = c.orders.plain.id;
      const notes = await call(c, `/api/orders/${id}/notes`);
      assert.equal(notes.status, f.stickyNotes ? 200 : 404, "GET notes");
      const steps = await call(c, `/api/orders/${id}/work-steps`);
      assert.equal(steps.status, f.workSequence ? 200 : 404, "GET work-steps");
      const stages = await call(c, "/api/work-stages");
      assert.equal(stages.status, f.workSequence ? 200 : 404, "GET work-stages");
      if (!f.stickyNotes) {
        const write = await call(c, `/api/orders/${id}/notes`, "POST", { body: "<p>no</p>", visibility: "internal" });
        assert.equal(write.status, 404, "POST notes without the feature");
      }
      if (!f.workSequence) {
        const write = await call(c, `/api/orders/${id}/work-steps`, "PUT", { expected_version: "0", steps: [] });
        assert.equal(write.status, 404, "PUT work-steps without the feature");
      }
      c.checks.api = true;
    });
  }

  // ---------------------------------------------------------------- post-its
  async function postits(c: Ctx) {
    const p = c.p;
    const panel = p.locator("#order-postits");
    const card = (text: string) => panel.locator("article", { hasText: text });

    async function compose(text: string, options: { printable?: boolean; addressee?: string; pin?: boolean } = {}) {
      await panel.getByRole("button", { name: "Añadir nota", exact: true }).click();
      const form = p.getByRole("form", { name: "Nueva nota" });
      await form.waitFor();
      await form.locator('[contenteditable][aria-label="Texto de la nota"]').click();
      await p.keyboard.type(text);
      if (options.printable) await form.locator('input[type="radio"][value="printable"]').check();
      if (options.addressee) await form.getByLabel("Para (opcional)").selectOption({ label: options.addressee });
      if (options.pin) await form.getByRole("checkbox").check();
      await form.getByRole("button", { name: "Guardar nota" }).click();
      if (options.printable) {
        const dialog = p.getByRole("dialog", { name: "¿Marcar la nota como imprimible?" });
        await dialog.waitFor();
        await dialog.getByRole("button", { name: "Marcar como imprimible" }).click();
        await dialog.waitFor({ state: "detached" });
      }
      await card(text).waitFor();
    }

    await c.h.step(`${c.t.slug}: post-its from the order page`, async () => {
      await openOrder(c, c.orders.plain);
      await compose(W.internal);
      await compose(W.printable, { printable: true, addressee: "Raquel E2E", pin: true });
      const strip = p.getByRole("region", { name: "Post-its fijados" }).or(p.locator('[aria-label="Post-its fijados"]'));
      await strip.filter({ hasText: W.printable }).first().waitFor();

      // Pin and unpin from the card.
      await card(W.internal).getByRole("button", { name: "Fijar", exact: true }).click();
      await strip.filter({ hasText: W.internal }).first().waitFor();
      await card(W.internal).getByRole("button", { name: "Desfijar", exact: true }).click();
      await p.waitForFunction((text: string) =>
        ![...document.querySelectorAll('[aria-label="Post-its fijados"]')].some((el) => el.textContent?.includes(text)), W.internal);

      // A third one, printable then voided, through the API.
      const created = await call(c, `/api/orders/${c.orders.plain.id}/notes`, "POST", {
        body: `<p>${W.voided}</p>`, visibility: "printable", confirm_printable: true,
      });
      assert.ok([200, 201].includes(created.status), JSON.stringify(created.body).slice(0, 200));
      const list = await call(c, `/api/orders/${c.orders.plain.id}/notes`);
      const byText = (text: string) => list.body.notes.find((n: any) => n.body?.includes(text));
      c.notes.internal = byText(W.internal)?.id;
      c.notes.printable = byText(W.printable)?.id;
      c.notes.voided = byText(W.voided)?.id;
      assert.ok(c.notes.internal && c.notes.printable && c.notes.voided, "three notes listed");
      const voided = await call(c, `/api/orders/${c.orders.plain.id}/notes/${c.notes.voided}/state`, "POST", {
        action: "void", reason: "E10: nota de prueba anulada",
      });
      assert.equal(voided.status, 200, JSON.stringify(voided.body).slice(0, 200));

      const after = await call(c, `/api/orders/${c.orders.plain.id}/notes`);
      const internal = after.body.notes.find((n: any) => n.id === c.notes.internal);
      const printable = after.body.notes.find((n: any) => n.id === c.notes.printable);
      assert.equal(internal.visibility, "internal");
      assert.equal(internal.pinned, false);
      assert.equal(printable.visibility, "printable");
      assert.equal(printable.pinned, true);
      assert.ok(printable.printable_authorized_at, "printable after confirmation");
      assert.equal(printable.addressee?.id, c.team["Raquel E2E"]);
      assert.equal(after.body.notes.some((n: any) => n.id === c.notes.voided), false, "voided hidden by default");
      assert.equal(after.body.voided_count, 1);
      const all = await call(c, `/api/orders/${c.orders.plain.id}/notes?voided=1`);
      assert.equal(all.body.notes.find((n: any) => n.id === c.notes.voided)?.state, "voided");

      // History of the printable note: created, then nothing else changed its text.
      const history = await call(c, `/api/orders/${c.orders.plain.id}/notes/${c.notes.printable}`);
      assert.equal(history.status, 200);
      c.checks.postits = { internal: true, printableConfirmed: true, pinUnpin: true, voided: true };
    });

    await c.h.step(`${c.t.slug}: «Pasar a post-it» converts the legacy notes`, async () => {
      await openOrder(c, c.orders.legacy);
      const legacyCard = p.locator("section", { has: p.getByRole("heading", { name: "Notas anteriores" }) }).first();
      await legacyCard.getByText(W.legacy).waitFor();
      await legacyCard.getByRole("button", { name: "Pasar a post-it" }).click();
      const dialog = p.getByRole("dialog").filter({ hasText: "Se crea un post-it interno" });
      await dialog.getByRole("button", { name: "Pasar a post-it" }).click();
      await card(W.legacy).waitFor();
      // The card stays until the next load, with the confirmation and without the old text.
      await legacyCard.getByText("ahora son un post-it interno").waitFor();
      assert.equal(await legacyCard.getByText(W.legacy).count(), 0, "old text left the legacy card");
      assert.equal(await legacyCard.getByRole("button", { name: "Pasar a post-it" }).count(), 0);
      await p.reload();
      await card(W.legacy).waitFor();
      assert.equal(await p.getByRole("heading", { name: "Notas anteriores" }).count(), 0, "legacy card gone after reload");
      const notes = await call(c, `/api/orders/${c.orders.legacy.id}/notes`);
      const converted = notes.body.notes.find((n: any) => n.body?.includes(W.legacy));
      assert.equal(converted?.visibility, "internal", "converted to an internal post-it");
      c.notes.converted = converted.id;
      const order = await call(c, `/api/orders/${c.orders.legacy.id}`);
      assert.equal(order.status, 200);
      assert.ok(!order.body.order?.notes, "orders.notes emptied");
      c.checks.legacyConversion = true;
    });
  }

  // ---------------------------------------------------------------- sequence
  async function sequence(c: Ctx) {
    const p = c.p;
    await c.h.step(`${c.t.slug}: sequence from the order page`, async () => {
      await openOrder(c, c.orders.plain);
      const loaded = await call(c, `/api/orders/${c.orders.plain.id}/work-steps`);
      const stages = loaded.body.stages.filter((s: any) => s.active !== false).slice(0, 3);
      await p.getByRole("button", { name: "Añadir secuencia" }).click();
      // The editor is a dialog; it may propose steps, so it is brought to exactly three.
      const editor = p.locator('[role="dialog"]').filter({ hasText: "Editar secuencia" });
      await editor.waitFor();
      const rows = editor.locator("li").filter({ has: p.locator("select") });
      while ((await rows.count()) < 3) await editor.getByRole("button", { name: "Añadir paso" }).click();
      while ((await rows.count()) > 3) await editor.getByRole("button", { name: `Quitar el paso ${await rows.count()}` }).click();
      const people = [c.team["Raquel E2E"], c.team["Jesús E2E"], ""];
      for (let i = 0; i < 3; i++) {
        const [stage, person] = [rows.nth(i).locator("select").nth(0), rows.nth(i).locator("select").nth(1)];
        await stage.selectOption(stages[i].id);
        await person.selectOption(people[i]);
      }
      // Davinia cannot receive orders: never offered as an enabled option.
      const davinia = rows.nth(0).locator("select").nth(1).locator("option", { hasText: "Davinia E2E" });
      assert.ok((await davinia.count()) === 0 || (await davinia.first().isDisabled()), "Davinia not assignable");
      await editor.getByRole("button", { name: "Guardar secuencia" }).click();
      await editor.waitFor({ state: "detached" });
      await p.getByText("0 de 3 hechos").waitFor();

      await p.getByRole("button", { name: "Marcar hecho", exact: true }).first().click();
      const dialog = p.locator('[role="dialog"]').filter({ has: p.getByRole("button", { name: "Marcar hecho" }) });
      await dialog.getByRole("button", { name: "Marcar hecho" }).click();
      await dialog.waitFor({ state: "detached" });
      await p.getByText("1 de 3 hechos").waitFor();

      const after = await call(c, `/api/orders/${c.orders.plain.id}/work-steps`);
      const steps = after.body.steps;
      assert.equal(steps.length, 3);
      assert.deepEqual(steps.map((s: any) => s.done), [true, false, false]);
      assert.deepEqual(steps.map((s: any) => s.is_current), [false, true, false]);
      assert.deepEqual(steps.map((s: any) => s.team_member?.id ?? null), [c.team["Raquel E2E"], c.team["Jesús E2E"], null]);
      c.steps = steps.map((s: any) => s.id);
      c.checks.sequence = { steps: 3, done: 1, unassigned: 1 };
    });
  }

  // --------------------------------------------------- work sheet and receipt
  async function documents(c: Ctx) {
    const f = c.t.features;
    const labels = orderLabels({ custom: f.customLabels });
    await c.h.step(`${c.t.slug}: work sheet`, async () => {
      const plain = await printSheet(c, c.orders.plain);
      assert.equal(plain.ficha, f.workSheetFicha, "ficha profile only with order_work_sheet_ficha");
      for (const hidden of [W.internal, W.voided, W.legacy]) assert.equal(plain.text.includes(hidden), false, `${hidden} printed`);
      if (f.stickyNotes) {
        assert.ok(plain.notes?.includes(W.printable), "printable post-it printed");
      } else {
        assert.equal(plain.notes, null, "no post-its block");
      }
      if (f.workSequence) {
        assert.equal(plain.steps.length, 3);
        assert.deepEqual(plain.steps.map((s: any) => s.done), [true, false, false]);
        // innerText follows the CSS uppercase of the badge.
        assert.ok(/le toca/i.test(plain.steps[1].text), "current step marked");
        assert.equal(plain.steps.filter((s: any) => /le toca/i.test(s.text)).length, 1, "one current step");
        assert.ok(/sin asignar/i.test(plain.steps[2].text), "unassigned step");
      } else {
        assert.equal(plain.steps.length, 0, "no sequence block");
      }

      const legacy = await printSheet(c, c.orders.legacy);
      assert.equal(legacy.text.includes(W.legacy), false, "legacy notes never printed");
      // With post-its the legacy notes were converted, so there is nothing left to warn about.
      assert.equal(legacy.notice, f.stickyNotes ? null : LEGACY_NOTES_NOTICE);

      const outside = await printSheet(c, c.orders.outside);
      const inside = await printSheet(c, c.orders.inside);
      // Section titles are uppercase in CSS, and innerText follows it.
      const has = (text: string, needle: string) => text.toLocaleLowerCase("es").includes(needle.toLocaleLowerCase("es"));
      assert.ok(has(outside.text, labels.description), `«${labels.description}» title`);
      if (f.workSheetFicha) {
        assert.equal(outside.service, SUR4_SERVICE, "service outside the description: printed first");
        assert.equal(inside.service, null, "service inside the description: not repeated");
        const storeName = c.t.extraStores[0];
        assert.equal(outside.referenceNote, `Tienda: ${storeName}`, "store next to the reference (two active stores)");
        assert.equal(plain.referenceNote, null, "no store, no note");
        assert.ok(has(outside.text, labels.total), `«${labels.total}» on the ficha`);
      } else {
        assert.equal(outside.service, null);
        assert.equal(outside.referenceNote, null);
      }
      c.checks.workSheet = { profile: plain.ficha ? "ficha" : "standard", notes: Boolean(plain.notes), steps: plain.steps.length };
    });

    await c.h.step(`${c.t.slug}: receipt PDF`, async () => {
      const statuses = await call(c, "/api/order-statuses");
      const statusNames: string[] = (statuses.body.statuses ?? statuses.body.order_statuses ?? []).map((s: any) => s.name);
      for (const order of [c.orders.plain, c.orders.legacy]) {
        const lines = await receiptLines(c, order);
        const text = lines.join("\n");
        for (const hidden of [W.internal, W.printable, W.voided, W.legacy, "Urgente"]) {
          assert.equal(text.includes(hidden), false, `${hidden} on the receipt of ${order.reference}`);
        }
        for (const name of statusNames) assert.equal(lines.some((l) => l.trim() === name), false, `status ${name} on the receipt`);
        assert.ok(text.includes(order.reference), "reference on the receipt");
        assert.ok(text.includes(labels.total), `«${labels.total}» on the receipt`);
      }
      c.checks.receipt = { statusesChecked: statusNames.length };
    });
  }

  // -------------------------------------------------------- feature off / on
  async function offOn(c: Ctx, key: "stickyNotes" | "workSequence") {
    await c.h.step(`${c.t.slug}: ${key} off and on keeps the data`, async () => {
      const id = c.orders.plain.id;
      const api = key === "stickyNotes" ? `/api/orders/${id}/notes` : `/api/orders/${id}/work-steps`;
      const before = await call(c, api);
      assert.equal(before.status, 200);
      const ids = (key === "stickyNotes" ? before.body.notes : before.body.steps).map((x: any) => x.id).sort();
      try {
        await setFeature(admin, c.t.slug, c.tenantId, key, false, `SUR4 E10 off/on check ${run}`, operator);
        assert.equal((await call(c, api)).status, 404, "hidden while off");
        await openOrder(c, c.orders.plain);
        if (key === "stickyNotes") assert.equal(await c.p.locator("#order-postits").count(), 0);
        else assert.equal(await c.p.getByText("Secuencia de trabajo").count(), 0);
        const sheet = await printSheet(c, c.orders.plain);
        if (key === "stickyNotes") assert.equal(sheet.notes, null, "printable post-it not printed while off");
        else assert.equal(sheet.steps.length, 0, "steps not printed while off");
      } finally {
        await setFeature(admin, c.t.slug, c.tenantId, key, true, `SUR4 E10 off/on check ${run}: restore`, operator);
      }
      const back = await call(c, api);
      assert.equal(back.status, 200);
      assert.deepEqual((key === "stickyNotes" ? back.body.notes : back.body.steps).map((x: any) => x.id).sort(), ids, "same data back");
      c.checks[`offOn_${key}`] = true;
    });
  }

  // ------------------------------------------------------------------ viewer
  async function viewer(c: Ctx) {
    const h = new Harness(c.target, redactor, path.join(dir, `${c.t.slug}-viewer`), bypass);
    const v = { p: null as Page, target: c.target, h };
    try {
      await h.start(env.PLAYWRIGHT_MODULE!);
      v.p = h.page;
      await h.step(`${c.t.slug}: the viewer reads, never writes`, async () => {
        await login(v.p, c.target, ownerEmail(c.t.slug, "viewer"));
        const ctx = await call(v, "/api/context");
        assert.equal(ctx.body.membership.role, "viewer");
        const id = c.orders.plain.id;
        const notes = await call(v, `/api/orders/${id}/notes`);
        assert.equal(notes.status, 200);
        assert.equal(notes.body.can_create, false);
        assert.ok(notes.body.notes.some((n: any) => n.id === c.notes.printable), "reads the post-its");
        const write = await call(v, `/api/orders/${id}/notes`, "POST", { body: "<p>no</p>", visibility: "internal" });
        assert.equal(write.status, 403, "viewer cannot add a post-it");
        const state = await call(v, `/api/orders/${id}/notes/${c.notes.internal}/state`, "POST", { action: "pin" });
        assert.equal(state.status, 403, "viewer cannot pin");
        const steps = await call(v, `/api/orders/${id}/work-steps`);
        assert.equal(steps.status, 200);
        assert.equal(steps.body.can_edit, false);
        const done = await call(v, `/api/orders/${id}/work-steps/${c.steps[1]}/done`, "POST", { done: true });
        assert.equal(done.status, 403, "viewer cannot mark a step");
        const stage = await call(v, "/api/work-stages", "POST", { name: "No" });
        assert.equal(stage.status, 403, "viewer cannot create stages");
        await v.p.goto(`${c.target.baseUrl}/orders/${id}`);
        await v.p.locator("#order-postits").waitFor();
        await settle(v.p);
        assert.equal(await v.p.locator("#order-postits").getByRole("button", { name: "Añadir nota" }).count(), 0);
        assert.equal(await v.p.getByRole("button", { name: "Editar secuencia" }).count(), 0);
        c.checks.viewer = true;
      });
      h.assertNoProductionEgress();
    } finally {
      await h.finish({ run, tenant: c.t.slug, role: "viewer", checks: c.checks.viewer ?? false });
    }
  }

  // --------------------------------------------------------------- isolation
  async function isolation() {
    const jwtClients = new Map<Sur4TenantSlug, SupabaseClient>();
    for (const c of ctxs) {
      const client = createClient(targets.supabaseUrl, publishableKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { error } = await client.auth.signInWithPassword({ email: ownerEmail(c.t.slug), password });
      assert.equal(error, null, `sign in ${c.t.slug}`);
      jwtClients.set(c.t.slug, client);
    }

    for (const a of ctxs) {
      await a.h.step(`${a.t.slug}: no other tenant reachable (app and PostgREST)`, async () => {
        const db = jwtClients.get(a.t.slug)!;
        // Positive controls: the same queries see the tenant's own rows.
        const ownOrders = await db.from("orders").select("id, tenant_id").eq("id", a.orders.plain.id);
        assert.equal(ownOrders.data?.length, 1, "own order visible");
        if (a.t.features.stickyNotes) {
          const own = await db.from("order_notes").select("id, tenant_id").eq("order_id", a.orders.plain.id);
          assert.ok((own.data?.length ?? 0) >= 2, "own notes visible");
          assert.ok(own.data!.every((n: any) => n.tenant_id === a.tenantId), "own notes carry own tenant_id");
        }
        if (a.t.features.workSequence) {
          const own = await db.from("order_work_steps").select("id, tenant_id").eq("order_id", a.orders.plain.id);
          assert.equal(own.data?.length, 3, "own steps visible");
        }
        const anyNotes = await db.from("order_notes").select("tenant_id").limit(500);
        assert.ok((anyNotes.data ?? []).every((n: any) => n.tenant_id === a.tenantId), "only own tenant_id in order_notes");
        const anySteps = await db.from("order_work_steps").select("tenant_id").limit(500);
        assert.ok((anySteps.data ?? []).every((n: any) => n.tenant_id === a.tenantId), "only own tenant_id in order_work_steps");

        let denied = 0;
        for (const b of ctxs) {
          if (b === a) continue;
          const id = b.orders.plain.id;
          for (const url of [
            `/api/orders/${id}`,
            `/api/orders/${id}/notes`,
            `/api/orders/${id}/work-steps`,
            `/api/orders/${id}/receipt`,
          ]) {
            const r = await call(a, url);
            assert.equal(r.status, 404, `${a.t.slug} → ${b.t.slug} ${url.replace(id, ":id")}: HTTP ${r.status}`);
            denied++;
          }
          if (a.t.features.stickyNotes && b.notes.printable) {
            const r = await call(a, `/api/orders/${a.orders.plain.id}/notes/${b.notes.printable}`);
            assert.equal(r.status, 404, "foreign note under an own order");
            const s = await call(a, `/api/orders/${a.orders.plain.id}/notes/${b.notes.printable}/state`, "POST", { action: "unpin" });
            assert.equal(s.status, 404, "foreign note state");
            denied += 2;
          }
          if (a.t.features.workSequence && b.steps[0]) {
            const r = await call(a, `/api/orders/${a.orders.plain.id}/work-steps/${b.steps[0]}/done`, "POST", { done: false });
            assert.ok([404, 409].includes(r.status), `foreign step: HTTP ${r.status}`);
            denied++;
          }
          const print = await a.p.request.fetch(`${a.target.baseUrl}/orders/${id}/print`, { maxRedirects: 0 });
          const printText = await print.text();
          assert.equal(printText.includes(b.orders.plain.reference), false, "foreign work sheet");
          denied++;

          // PostgREST with the tenant's own JWT: RLS returns nothing and refuses writes.
          for (const [table, column] of [["orders", "id"], ["order_notes", "order_id"], ["order_work_steps", "order_id"]] as const) {
            const r = await db.from(table).select("id").eq(column, id);
            assert.equal(r.data?.length ?? 0, 0, `${table} of ${b.t.slug} visible`);
            denied++;
          }
          if (b.notes.printable) {
            const versions = await db.from("order_note_versions").select("id").eq("note_id", b.notes.printable);
            assert.equal(versions.data?.length ?? 0, 0, "foreign note versions visible");
            const events = await db.from("order_note_events").select("id").eq("note_id", b.notes.printable);
            assert.equal(events.data?.length ?? 0, 0, "foreign note events visible");
            const rpcState = await db.rpc("set_order_note_state_v1", { p_note_id: b.notes.printable, p_action: "unpin", p_reason: null });
            assert.ok(rpcState.error || rpcState.data?.ok !== true, "foreign note state through RPC");
            denied += 3;
          }
          const rpcNote = await db.rpc("create_order_note_v1", { p_order_id: id, p_body: "<p>no</p>" });
          assert.ok(rpcNote.error || rpcNote.data?.ok !== true, "foreign note through RPC");
          if (b.steps[0]) {
            const rpcStep = await db.rpc("set_order_work_step_done_v1", { p_step_id: b.steps[0], p_done: false });
            assert.ok(rpcStep.error || rpcStep.data?.ok !== true, "foreign step through RPC");
          }
          const insert = await db.from("order_notes").insert({ tenant_id: b.tenantId, order_id: id, body: "<p>no</p>" });
          assert.ok(insert.error, "direct insert into order_notes refused");
          denied += 3;
        }
        // staging-branch: one host for every tenant, so also try the override
        // itself. With its own session, switching the Preview tenant to another
        // tenant must be refused (not a member), and switching back restores it.
        let overrideDenied = 0;
        if (a.target.previewTenant) {
          for (const b of ctxs) {
            if (b === a) continue;
            await a.h.selectPreviewTenant(b.t.slug);
            for (const url of [`/api/orders/${b.orders.plain.id}`, `/api/orders/${b.orders.plain.id}/notes`, "/api/orders"]) {
              const r = await call(a, url);
              assert.ok([401, 403, 404].includes(r.status), `${a.t.slug} as ${b.t.slug} ${url}: HTTP ${r.status}`);
              assert.equal(JSON.stringify(r.body).includes(b.orders.plain.id), false, "foreign order leaked through the override");
              overrideDenied++;
            }
          }
          await a.h.selectPreviewTenant(a.t.slug);
          const own = await call(a, `/api/orders/${a.orders.plain.id}`);
          assert.equal(own.status, 200, "own tenant restored after the override attempts");
        }
        a.checks.isolation = { denied, overrideDenied };
      });
    }

    // The foreign attempts changed nothing: every tenant still sees its own data as before.
    for (const b of ctxs) {
      await b.h.step(`${b.t.slug}: own data unchanged after the foreign attempts`, async () => {
        if (b.t.features.workSequence) {
          const steps = await call(b, `/api/orders/${b.orders.plain.id}/work-steps`);
          assert.deepEqual(steps.body.steps.map((s: any) => s.done), [true, false, false]);
        }
        if (b.t.features.stickyNotes) {
          const notes = await call(b, `/api/orders/${b.orders.plain.id}/notes`);
          assert.equal(notes.body.notes.find((n: any) => n.id === b.notes.printable)?.pinned, true);
        }
      });
    }
    for (const client of jwtClients.values()) await client.auth.signOut().catch(() => undefined);
    result.checks.isolation = true;
  }

  // ---------------------------------------------------------------- the run
  try {
    for (const t of SUR4_MATRIX) {
      const c = await openTenant(t);
      await catalog(c);
      await createOrders(c);
      await matrixOnPage(c);
      if (t.features.stickyNotes) await postits(c);
      if (t.features.workSequence) await sequence(c);
      await documents(c);
    }
    const bySlug = (slug: Sur4TenantSlug) => ctxs.find((c) => c.t.slug === slug)!;
    await offOn(bySlug("e2e-sur4-postits"), "stickyNotes");
    await offOn(bySlug("e2e-sur4-secuencia"), "workSequence");
    for (const c of ctxs) if (c.t.viewer) await viewer(c);
    await isolation();
    for (const c of ctxs) c.h.assertNoProductionEgress();
    result.checks.noProductionEgress = true;
    result.status = "passed";
  } catch (e) {
    result.status = "failed";
    result.error = redactor.text(e instanceof Error ? e.message : String(e));
    console.error(result.error);
  } finally {
    for (const c of ctxs) {
      result.tenants[c.t.slug] = { ...c.checks, consoleErrors: c.h.consoleErrors.length, blocked: c.h.blocked.length };
      await c.h.finish({ run, tenant: c.t.slug, checks: c.checks }).catch((error: unknown) => {
        result.status = "failed";
        result.artifactError = redactor.text(String(error));
      });
    }
    await mkdir(dir, { recursive: true });
    const summary = redactor.text(JSON.stringify(result, null, 2));
    redactor.assertClean("summary.json", summary);
    await writeFile(path.join(dir, "summary.json"), summary);
    console.log(summary);
    console.log("Artifacts: " + dir);
  }
  process.exitCode = result.status === "passed" ? 0 : 1;
}

main().catch((error: unknown) => {
  const redactor = new Redactor([env.E2E_SUR4_PASSWORD, env.E2E_SUPABASE_SECRET_KEY, env.E2E_SUPABASE_PUBLISHABLE_KEY]);
  console.error(redactor.text(`[e2e-sur4] configuration refused: ${error instanceof Error ? error.message : String(error)}`));
  process.exit(2);
});
