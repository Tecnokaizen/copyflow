import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { WorkSheetDocument } from "@/components/print/order-print-document";
import {
  PrintFacts,
  PrintFiles,
  PrintFrame,
  PrintRichText,
} from "@/components/print/print-frame";
import { formatCustomerNotificationStatus, formatPriority } from "@/lib/orders/format";
import * as orderFeatures from "@/lib/orders/order-features";
import { NO_ORDER_FEATURES, type OrderFeatures } from "@/lib/orders/order-features";
import { isRichTextEmpty } from "@/lib/rich-text/html";
import * as format from "@/lib/print/format";
import * as orderDocument from "@/lib/print/order-document";
import { printBranding, workSheetModel, type WorkSheetSource } from "@/lib/print/order-document";
import type { PrintBranding, PrintFact, WorkSheetModel } from "@/lib/print/types";
import * as queries from "@/lib/print/work-sheet-queries";
import * as rules from "@/lib/print/work-sheet-rules";
import {
  printableService,
  printableStore,
  workSheetProfile,
} from "@/lib/print/work-sheet-rules";
import {
  renderWorkSheetHtml,
  sampleWorkSheetModel,
  sur4WorkSheetSamples,
} from "@/lib/print/work-sheet-samples";
import * as branding from "@/lib/tenant/branding";
import * as zonedDay from "@/lib/time/zoned-day";
import { isUuid } from "@/lib/team/payload";

const ORDER_ID = "6f1c2f8e-1b2a-4c3d-9e4f-0a1b2c3d4e5f";
const TENANT = "tenant-a";
const brand: PrintBranding = printBranding({
  displayName: "Taller Norte",
  logoUrl: "/api/tenant/logo",
  brandColor: "#0f3d2e",
});

// Contract §10: every excluded field carries a witness; only the last one may
// ever be printed, and only on the work sheet.
const WITNESSES = [
  "TESTIGO-NOTAS-PEDIDO",
  "TESTIGO-NOTAS-CLIENTE",
  "TESTIGO-POSTIT-INTERNO",
  "TESTIGO-POSTIT-ANULADO",
  "TESTIGO-POSTIT-SUPRIMIDO",
  "TESTIGO-DRIVE",
  "TESTIGO-COBRO",
] as const;
const PRINTABLE = "TESTIGO-IMPRIMIBLE";

// ---------------------------------------------------------------------------
// Frozen copy of the order print of today (main e218939 + #146, before E2):
// orderPrintModel and OrderPrintDocument. Only this test uses it, to prove the
// standard profile prints the same minus «Notas internas» (N25).
type LegacyFact = PrintFact | null;
function legacyText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}
function legacyFact(label: string, value: string | null | undefined): LegacyFact {
  const trimmed = legacyText(value);
  return trimmed ? { label, value: trimmed } : null;
}
function legacyFacts(rows: LegacyFact[]): PrintFact[] {
  return rows.filter((row): row is PrintFact => row !== null);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function legacyOrderPrintModel(order: any, input: { files: Array<string | null | undefined>; branding: PrintBranding; timeZone: string }) {
  const reference = legacyText(order.reference) ?? "Sin referencia";
  const clientName = legacyText(order.client?.name) ?? "Sin cliente";
  const title = legacyText(order.title) ?? "Sin título";
  const readyAt = format.formatPrintTimestamp(order.ready_at, input.timeZone);
  const deliveredAt = format.formatPrintTimestamp(order.delivered_at, input.timeZone);
  return {
    documentTitle: `Pedido ${reference} — ${clientName}`,
    kind: "Pedido" as const,
    reference,
    title,
    branding: input.branding,
    client: legacyFacts([
      legacyFact("Nombre", order.client?.name),
      legacyFact("Empresa", order.client?.company_name),
      legacyFact("Contacto", order.client?.contact_name),
      legacyFact("Teléfono", order.client?.phone),
      legacyFact("Email", order.client?.email),
    ]),
    order: legacyFacts([
      legacyFact("Servicio", order.service?.name),
      legacyFact("Tienda", order.store?.name),
      legacyFact("Canal", order.entry_channel?.name),
      legacyFact("Contexto", order.order_context?.name),
      legacyFact("Estado", order.status?.name),
      legacyFact("Prioridad", formatPriority(order.priority ?? "")),
      legacyFact("Responsable", order.assigned_team_member?.name ?? "Sin responsable"),
    ]),
    dates: legacyFacts([
      legacyFact("Recepción", format.formatPrintTimestamp(order.received_at, input.timeZone) ?? "—"),
      legacyFact("Entrega prevista", format.formatPrintTimestamp(order.due_at, input.timeZone) ?? "—"),
      readyAt ? legacyFact("Terminado", readyAt) : null,
      deliveredAt ? legacyFact("Entregado", deliveredAt) : null,
    ]),
    description: isRichTextEmpty(order.description) ? null : order.description ?? null,
    production: legacyFacts([
      legacyFact("Archivos", order.file_status?.name),
      legacyFact("Presupuesto del pedido", order.quote_status?.name),
    ]),
    payment: legacyFacts([
      legacyFact("Pago", order.payment_status?.name),
      legacyFact("Método de entrega", order.delivery_method?.name),
      legacyFact("Cliente avisado", formatCustomerNotificationStatus(order.customer_notification_status ?? "")),
    ]),
    notes: isRichTextEmpty(order.notes) ? null : order.notes ?? null,
    files: format.printFileNames(input.files),
    fileCountLabel: format.printFileCountLabel(format.printFileNames(input.files).length),
  };
}
type LegacyModel = ReturnType<typeof legacyOrderPrintModel>;
function legacyOrderPrintDocument(model: LegacyModel) {
  return createElement(
    PrintFrame,
    { branding: model.branding, kind: model.kind, reference: model.reference } as ComponentProps<typeof PrintFrame>,
    createElement("h1", { className: "print-title" }, model.title),
    createElement(PrintFacts, { title: "Cliente", rows: model.client }),
    createElement(PrintFacts, { title: "Pedido", rows: model.order }),
    createElement(PrintFacts, { title: "Fechas", rows: model.dates }),
    createElement(PrintRichText, { title: "Instrucciones", value: model.description, textStyles: true }),
    createElement(PrintFacts, { title: "Producción", rows: model.production }),
    createElement(PrintFacts, { title: "Cobro y entrega", rows: model.payment }),
    createElement(PrintRichText, { title: "Notas internas", value: model.notes, textStyles: true }),
    createElement(PrintFiles, { countLabel: model.fileCountLabel, files: model.files })
  );
}
// ---------------------------------------------------------------------------

/** The worst case: a row that also carries every excluded field. */
function witnessOrder() {
  return {
    reference: "DEMO-0300",
    title: "Folletos de feria",
    description: '<p>Tríptico <span data-text-color="red">NO CORTAR</span> a 3 mm.</p>',
    notes: "<p>TESTIGO-NOTAS-PEDIDO juan@example.test 600111222</p>",
    external_folder_url: "https://drive.google.com/TESTIGO-DRIVE",
    priority: "urgent",
    received_at: "2026-10-15T08:30:00.000Z",
    due_at: "2026-10-20T16:00:00.000Z",
    ready_at: "2026-10-19T10:00:00.000Z",
    delivered_at: "2026-10-20T11:00:00.000Z",
    customer_notification_status: "notified",
    client: {
      name: "Imprenta Sol",
      company_name: "Sol SL",
      contact_name: "Ana",
      email: "ana@sol.test",
      phone: "611222333",
      notes: "TESTIGO-NOTAS-CLIENTE",
      tax_id: "B11111111",
    },
    service: { name: "Folletos" },
    store: { name: "Centro" },
    entry_channel: { name: "Mostrador" },
    order_context: { name: "Feria" },
    status: { name: "En producción" },
    assigned_team_member: { name: "Luis" },
    file_status: { name: "Recibido" },
    quote_status: { name: "Aceptado" },
    payment_status: { name: "Parcial" },
    delivery_method: { name: "Recogida" },
  };
}

const witnessNotes = [
  { body: "<p>TESTIGO-POSTIT-INTERNO</p>", visibility: "internal", state: "open", redacted_at: null, pinned: true },
  { body: "<p>TESTIGO-POSTIT-ANULADO</p>", visibility: "printable", state: "voided", redacted_at: null },
  { body: "<p>TESTIGO-POSTIT-SUPRIMIDO</p>", visibility: "printable", state: "open", redacted_at: "2026-10-27T10:00:00Z" },
  { body: null, visibility: "printable", state: "voided", redacted_at: "2026-10-27T10:00:00Z" },
  { body: `<p>${PRINTABLE}</p>`, visibility: "printable", state: "open", redacted_at: null },
];

const witnessCollection = {
  ok: true,
  total_amount: "120.00",
  paid_amount: "50.00",
  pending_amount: "70.00",
  collection_state: "partial",
  row_version: "4",
  payments: [
    {
      id: "p1", amount: "50.00", paid_at: "2026-10-16T10:00:00Z", created_by: "u1",
      payment_method: "TESTIGO-COBRO", void_reason: "TESTIGO-COBRO",
      receipt: { id: "f9", original_name: "TESTIGO-COBRO.pdf" },
    },
  ],
};

const witnessSteps = [
  { position: 2, completed_at: null, is_current: true, stage: { name: "Corte", icon: "cut" }, team_member: { name: "Marta" } },
  {
    position: 1, completed_at: "2026-10-16T09:00:00Z", is_current: false,
    stage: { name: "Impresión", icon: "print" }, team_member: { name: "Luis" }, executed_by: { name: "Pedro" },
  },
];

const ALL_ON: OrderFeatures = { customLabels: true, stickyNotes: true, workSequence: true, workSheetFicha: true };

type Call = { table: string; method: string; args: unknown[] };

function fakeSupabase(options: {
  features?: Partial<Record<string, boolean>>;
  orderTenant?: string;
  files?: string[];
  activeStores?: number;
}) {
  const calls: Call[] = [];
  const results = (table: string, selected: string) => {
    switch (table) {
      case "orders":
        return selected.trim() === "notes"
          ? { data: { notes: witnessOrder().notes }, error: null }
          : { data: witnessOrder(), error: null };
      case "tenant_settings":
        return { data: { business_name: "Taller Norte", branding: null, timezone: "Europe/Madrid" }, error: null };
      case "order_files":
        return { data: (options.files ?? []).map((original_name) => ({ original_name, created_at: "2026-10-15T08:00:00Z" })), error: null };
      case "order_work_steps":
        return { data: witnessSteps, error: null };
      case "order_notes":
        // A database that ignored every filter: the model must still drop them.
        return { data: witnessNotes, error: null };
      case "stores":
        return { data: null, count: options.activeStores ?? 2, error: null };
      default:
        throw new Error(`unexpected table ${table}`);
    }
  };
  const client = {
    calls,
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
      if (name === "tenant_has_feature") {
        return { data: args.p_tenant_id === TENANT && options.features?.[String(args.p_code)] === true, error: null };
      }
      if (name === "order_collection_v1") return { data: witnessCollection, error: null };
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      let selected = "";
      const filters: Array<[string, unknown]> = [];
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "is", "not", "order", "limit"]) {
        chain[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          if (method === "select") selected = String(args[0]);
          if (method === "eq") filters.push([String(args[0]), args[1]]);
          return chain;
        };
      }
      const resolve = () => {
        const tenant = filters.find(([key]) => key === "tenant_id")?.[1];
        if (table === "orders" && tenant !== (options.orderTenant ?? TENANT)) return { data: null, error: null };
        return results(table, selected);
      };
      chain.maybeSingle = async () => resolve();
      chain.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(resolve()).then(onFulfilled, onRejected);
      return chain;
    },
  };
  return client;
}

type WorkSheetLoad =
  | { status: "denied" }
  | { status: "not_found" }
  | { status: "ok"; model: WorkSheetModel; legacyNotes: boolean };

function loaderHarness(options: Parameters<typeof fakeSupabase>[0] & { session?: boolean } = {}) {
  const supabase = fakeSupabase(options);
  const deps: Record<string, unknown> = {
    "server-only": {},
    react: { cache: (fn: unknown) => fn },
    "@/lib/orders/order-features": orderFeatures,
    "@/lib/print/order-document": orderDocument,
    "@/lib/print/work-sheet-queries": queries,
    "@/lib/print/work-sheet-rules": rules,
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/tenant/branding": branding,
    "@/lib/tenant/current-context": {
      getCurrentContext: async () => (options.session === false ? null : { tenant: { id: TENANT, name: "Taller Norte" } }),
    },
    "@/lib/time/zoned-day": zonedDay,
    "@/lib/team/payload": { isUuid },
  };
  const code = ts.transpileModule(readFileSync(new URL("./load-order.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} as { loadWorkSheet: (id: string) => Promise<WorkSheetLoad>; WORK_SHEET_SELECT: string } };
  new Function("require", "module", "exports", code)((name: string) => {
    if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`);
    return deps[name];
  }, mod, mod.exports);
  return { supabase, exports: mod.exports, load: (id = ORDER_ID) => mod.exports.loadWorkSheet(id) };
}

function render(model: WorkSheetModel, legacyNotes = false) {
  return renderToStaticMarkup(
    createElement(WorkSheetDocument, { model, legacyNotes, receiptHref: `/api/orders/${ORDER_ID}/receipt` })
  );
}

function featuresFor(features: OrderFeatures): Partial<Record<string, boolean>> {
  return Object.fromEntries(
    (Object.keys(features) as Array<keyof OrderFeatures>).map((key) => [orderFeatures.ORDER_FEATURE_CODES[key], features[key]])
  );
}

describe("work sheet standard profile (N25)", () => {
  const files = ["plano.pdf", "justificante-entrega.pdf", "subida-pendiente.ai"];

  it("is today's print minus «Notas internas», in the model and on paper", () => {
    const order = witnessOrder();
    const legacy = legacyOrderPrintModel(order, { files, branding: brand, timeZone: "Europe/Madrid" });
    const model = workSheetModel(order as WorkSheetSource, {
      profile: "standard",
      features: NO_ORDER_FEATURES,
      files,
      branding: brand,
      timeZone: "Europe/Madrid",
    });

    const { notes: legacyNotes, ...legacyRest } = legacy;
    assert.ok(legacyNotes, "today's print carries the notes");
    for (const [key, value] of Object.entries(legacyRest)) {
      assert.deepEqual(model[key as keyof WorkSheetModel], value, key);
    }
    assert.equal("notes" in model, false);
    // Only the new, empty blocks are added.
    const added = Object.keys(model).filter((key) => !(key in legacy)).sort();
    assert.deepEqual(added, ["descriptionTitle", "ficha", "printableNotes", "profile", "steps"]);
    assert.equal(model.descriptionTitle, "Instrucciones");
    assert.deepEqual([model.profile, model.ficha, model.steps, model.printableNotes], ["standard", null, [], []]);
    // Payment receipts and pending uploads are listed, as today.
    assert.deepEqual(model.files, files);

    const legacyHtml = renderToStaticMarkup(legacyOrderPrintDocument(legacy));
    const notesHtml = renderToStaticMarkup(
      createElement(PrintRichText, { title: "Notas internas", value: legacy.notes, textStyles: true })
    );
    assert.ok(legacyHtml.includes(notesHtml));
    const html = renderToStaticMarkup(createElement(WorkSheetDocument, { model }));
    assert.equal(html, legacyHtml.replace(notesHtml, ""));
  });

  it("adds steps and printable post-its after today's blocks, only with feature and data", () => {
    const base = { profile: "standard" as const, files, branding: brand, timeZone: "Europe/Madrid" };
    const order = witnessOrder() as WorkSheetSource;
    const off = workSheetModel(order, { ...base, features: NO_ORDER_FEATURES, steps: witnessSteps, notes: witnessNotes });
    assert.deepEqual([off.steps, off.printableNotes], [[], []]);
    const offHtml = render(off);
    assert.equal(offHtml.includes("Secuencia de trabajo"), false);
    assert.equal(offHtml.includes("Post-its"), false);

    const empty = workSheetModel(order, { ...base, features: { ...NO_ORDER_FEATURES, stickyNotes: true, workSequence: true } });
    const emptyHtml = render(empty);
    assert.equal(emptyHtml.includes("Secuencia de trabajo"), false, "never an empty heading");
    assert.equal(emptyHtml.includes("Post-its"), false, "never an empty heading");

    const on = workSheetModel(order, {
      ...base,
      features: { ...NO_ORDER_FEATURES, stickyNotes: true, workSequence: true },
      steps: witnessSteps,
      notes: witnessNotes,
    });
    const html = render(on);
    assert.deepEqual(on.steps.map((step) => [step.position, step.stageName, step.personName, step.executorName, step.done, step.current]), [
      [1, "Impresión", "Luis", "Pedro", true, false],
      [2, "Corte", "Marta", null, false, true],
    ]);
    assert.deepEqual(on.printableNotes, [{ body: `<p>${PRINTABLE}</p>` }]);
    const files_ = html.indexOf("subida-pendiente.ai");
    const steps = html.indexOf("Secuencia de trabajo");
    const notes = html.indexOf("Post-its");
    assert.ok(files_ > 0 && steps > files_ && notes > steps, "after the existing blocks");
    assert.match(html, /aria-label="Hecho"/);
    assert.match(html, /aria-label="Pendiente"/);
    assert.match(html, /Le toca/);
  });
});

describe("work sheet profile (N25)", () => {
  it("is ficha only with order_work_sheet_ficha, whatever else arrives", () => {
    assert.equal(workSheetProfile(NO_ORDER_FEATURES), "standard");
    assert.equal(workSheetProfile({ ...NO_ORDER_FEATURES, workSheetFicha: true }), "ficha");
    for (const value of ["true", 1, "ficha", {}, [], null, undefined]) {
      assert.equal(workSheetProfile({ workSheetFicha: value as never }), "standard", String(value));
    }
    const request = { ...NO_ORDER_FEATURES, profile: "ficha", perfil: "ficha", ficha: true, workSheet: "ficha" };
    assert.equal(workSheetProfile(request as never), "standard");
    const everythingElse: OrderFeatures = { customLabels: true, stickyNotes: true, workSequence: true, workSheetFicha: false };
    assert.equal(workSheetProfile(everythingElse), "standard");
  });

  it("comes from the server-side feature of the session tenant, never from the URL", async () => {
    const page = readFileSync(new URL("../../app/orders/[id]/print/page.tsx", import.meta.url), "utf8");
    assert.equal(/searchParams|useSearchParams|headers\(\)|cookies\(\)/.test(page), false);

    for (const features of [NO_ORDER_FEATURES, { customLabels: true, stickyNotes: true, workSequence: true, workSheetFicha: false }]) {
      const h = loaderHarness({ features: featuresFor(features) });
      const loaded = await h.load();
      assert.equal(loaded.status, "ok");
      if (loaded.status === "ok") assert.equal(loaded.model.profile, "standard");
      const featureCalls = h.supabase.calls.filter((call) => call.table === "rpc:tenant_has_feature");
      assert.ok(featureCalls.length >= 4);
      assert.ok(featureCalls.every((call) => (call.args[0] as { p_tenant_id: string }).p_tenant_id === TENANT));
    }

    const ficha = await loaderHarness({ features: featuresFor(ALL_ON) }).load();
    assert.equal(ficha.status === "ok" && ficha.model.profile, "ficha");

    for (const id of [`${ORDER_ID}?profile=ficha`, `${ORDER_ID}&perfil=ficha`, "ficha"]) {
      const h = loaderHarness({ features: featuresFor(NO_ORDER_FEATURES) });
      assert.equal((await h.load(id)).status, "not_found");
      assert.equal(h.supabase.calls.length, 0);
    }
  });

  it("denies without session and hides orders of another tenant", async () => {
    const denied = loaderHarness({ session: false });
    assert.equal((await denied.load()).status, "denied");
    assert.equal(denied.supabase.calls.length, 0);
    const foreign = loaderHarness({ orderTenant: "tenant-b", features: featuresFor(ALL_ON) });
    assert.equal((await foreign.load()).status, "not_found");
    assert.equal(foreign.supabase.calls.some((call) => ["order_notes", "order_work_steps", "order_files"].includes(call.table)), false);
  });
});

describe("closed selects (contract §6)", () => {
  it("never ask for notes or external_folder_url", async () => {
    const { WORK_SHEET_SELECT } = loaderHarness().exports;
    const { CUSTOMER_RECEIPT_SELECT } = await import("@/lib/print/receipt");
    for (const [name, select] of [["WORK_SHEET_SELECT", WORK_SHEET_SELECT], ["CUSTOMER_RECEIPT_SELECT", CUSTOMER_RECEIPT_SELECT]]) {
      assert.ok(select.includes("reference"), name);
      assert.equal(select.includes("notes"), false, name);
      assert.equal(select.includes("external_folder_url"), false, name);
      assert.equal(select.includes("*"), false, name);
      assert.equal(/tax_id|metadata|row_version|payments|order_files/.test(select), false, name);
    }
    assert.equal(queries.WORK_SHEET_NOTE_SELECT.includes("notes"), false);
    assert.equal(/author|reason|version/.test(queries.WORK_SHEET_NOTE_SELECT), false);
  });

  it("reads printable post-its, steps and stores with their own filters", async () => {
    const h = loaderHarness({ features: featuresFor(ALL_ON), activeStores: 3 });
    await h.load();
    const of = (table: string, method: string) =>
      h.supabase.calls.filter((call) => call.table === table && call.method === method).map((call) => call.args);
    assert.deepEqual(of("order_notes", "eq"), [["tenant_id", TENANT], ["order_id", ORDER_ID], ["visibility", "printable"]]);
    assert.deepEqual(of("order_notes", "neq"), [["state", "voided"]]);
    assert.deepEqual(of("order_notes", "not"), [["body", "is", null]]);
    assert.deepEqual(of("order_notes", "is"), [["redacted_at", null]]);
    assert.deepEqual(of("order_work_steps", "eq"), [["tenant_id", TENANT], ["order_id", ORDER_ID]]);
    assert.match(String(of("order_work_steps", "select")[0][0]), /team_members!order_work_steps_team_member_fk\(name\)/);
    assert.match(String(of("order_work_steps", "select")[0][0]), /team_members!order_work_steps_executed_by_fk\(name\)/);
    assert.deepEqual(of("stores", "select"), [["id", { count: "exact", head: true }]]);
    assert.deepEqual(of("stores", "eq"), [["tenant_id", TENANT], ["active", true]]);
    // The ficha profile never lists files.
    assert.equal(h.supabase.calls.some((call) => call.table === "order_files"), false);
  });

  it("does not read post-its or steps without their feature", async () => {
    const h = loaderHarness({ features: featuresFor(NO_ORDER_FEATURES) });
    await h.load();
    const tables = new Set(h.supabase.calls.map((call) => call.table));
    for (const table of ["order_notes", "order_work_steps", "stores", "rpc:order_collection_v1"]) {
      assert.equal(tables.has(table), false, table);
    }
    assert.ok(tables.has("order_files"));
    const files = h.supabase.calls.filter((call) => call.table === "order_files");
    assert.ok(files.some((call) => call.method === "is" && call.args[0] === "deleted_at"));
    assert.equal(files.some((call) => call.method === "eq" && call.args[0] === "status"), false, "pending uploads stay listed");
  });
});

describe("witness texts (contract §10)", () => {
  for (const profile of ["standard", "ficha"] as const) {
    for (const stickyNotes of [true, false]) {
      it(`${profile} profile, post-its ${stickyNotes ? "on" : "off"}: only ${PRINTABLE} can be printed`, async () => {
        const features: OrderFeatures = { ...ALL_ON, stickyNotes, workSheetFicha: profile === "ficha" };
        const h = loaderHarness({ features: featuresFor(features), files: ["plano.pdf"] });
        const loaded = await h.load();
        assert.equal(loaded.status, "ok");
        if (loaded.status !== "ok") return;
        assert.equal(loaded.model.profile, profile);
        assert.equal(loaded.legacyNotes, true, "the notice knows there are notes");

        const fromLoader = JSON.stringify(loaded);
        const html = render(loaded.model, loaded.legacyNotes);
        const pure = workSheetModel(witnessOrder() as WorkSheetSource, {
          profile,
          features,
          branding: brand,
          timeZone: "Europe/Madrid",
          files: ["plano.pdf"],
          steps: witnessSteps,
          notes: witnessNotes,
          amounts: rules.collectionAmounts(witnessCollection),
          activeStoreCount: 2,
        });
        const pureJson = JSON.stringify(pure);
        const pureHtml = render(pure, true);
        for (const witness of WITNESSES) {
          for (const [where, text] of [["loader", fromLoader], ["html", html], ["model", pureJson], ["pure html", pureHtml]]) {
            assert.equal(text.includes(witness), false, `${witness} in ${where}`);
          }
        }
        for (const text of [fromLoader, html, pureJson, pureHtml]) {
          assert.equal(text.includes(PRINTABLE), stickyNotes);
          assert.equal(text.includes("juan@example.test"), false);
        }
        assert.match(html, /class="print-notice print-screen-only"/);
        assert.match(html, /Este pedido tiene notas internas, que no se imprimen\./);
      });
    }
  }

  it("hasLegacyNotes answers a boolean and drops the text", async () => {
    const supabase = fakeSupabase({});
    const result = await queries.hasLegacyNotes(supabase as never, TENANT, ORDER_ID);
    assert.equal(result, true);
    assert.deepEqual(
      supabase.calls.filter((call) => call.method === "eq").map((call) => call.args),
      [["id", ORDER_ID], ["tenant_id", TENANT]]
    );
    const empty = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { notes: "<p> </p>" }, error: null }) }) }) }) }) };
    assert.equal(await queries.hasLegacyNotes(empty as never, TENANT, ORDER_ID), false);
  });

  it("the print stylesheet hides the notice on paper", () => {
    const css = readFileSync(new URL("../../components/print/print.css", import.meta.url), "utf8");
    assert.match(css, /@media print\s*\{[^}]*\.print-screen-only[^}]*display:\s*none !important/);
  });
});

describe("work sheet ficha profile (N19, N20)", () => {
  const input = {
    profile: "ficha" as const,
    branding: brand,
    timeZone: "Europe/Madrid",
    amounts: { total: "1250.00", paid: "250.00", pending: "1000.00" },
    activeStoreCount: 2,
    printedAt: "2026-10-28T10:00:00.000Z",
  };

  it("prints the sur4-0134 blocks and nothing of the standard-only ones", () => {
    const model = workSheetModel(witnessOrder() as WorkSheetSource, { ...input, features: { ...NO_ORDER_FEATURES, workSheetFicha: true }, files: ["plano.pdf"] });
    const html = render(model);
    assert.deepEqual([model.order, model.dates, model.production, model.payment, model.files], [[], [], [], [], []]);
    assert.ok(model.ficha);
    for (const absent of ["En producción", "Mostrador", "Feria", ">Terminado<", ">Entregado<", "plano.pdf", "Recogida", "Avisado", "Parcial", ">Estado<", ">Canal<", ">Contexto<"]) {
      assert.equal(html.includes(absent), false, absent);
    }
    for (const label of ["Total del pedido", "Entregado a cuenta", "Pendiente de cobro", "Instrucciones"]) {
      assert.ok(html.includes(label), label);
    }
    assert.match(html, /1\.250,00 €/);
    for (const present of ["Hoja de trabajo", "DEMO-0300", "Tienda: Centro", "Imprenta Sol", "Sol SL", "611222333", "ana@sol.test",
      "Fecha de entrega", "Requiere prueba", "Fecha de envío prueba", "Fecha prueba", "Responsable", "Luis",
      "Prioridad", "Urgente", "Fecha de recepción", "Archivos", "Recibido", "Presupuesto", "Aceptado", "Documento interno"]) {
      assert.ok(html.includes(present), present);
    }
    // Reading order of sur4-0134: client and amounts, description, responsable, bottom row.
    const order = ["Imprenta Sol", "Total del pedido", "Fecha de entrega", "Requiere prueba", "Instrucciones", "Responsable", "Fecha de recepción"]
      .map((text) => html.indexOf(text));
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    assert.match(html, /@page ws-ficha \{ @bottom-left \{ content: "Documento interno \\00B7  Impreso el 28\/10\/2026, 11:00"; \} \}/);
  });

  it("names amounts and description with order_custom_labels and says «Sin definir» without total", () => {
    const model = workSheetModel(witnessOrder() as WorkSheetSource, {
      ...input,
      amounts: { total: null, paid: "0.00", pending: null },
      features: { ...NO_ORDER_FEATURES, workSheetFicha: true, customLabels: true },
    });
    assert.deepEqual(model.ficha?.amounts, [
      { label: "Total pedido", value: "Sin definir" },
      { label: "A cuenta", value: "0,00 €" },
      { label: "Falta por abonar", value: "Sin definir" },
    ]);
    assert.equal(model.descriptionTitle, "Descripción");
  });

  it("prints the store only with more than one active store, and the service only when new", () => {
    const features = { ...NO_ORDER_FEATURES, workSheetFicha: true };
    const one = workSheetModel(witnessOrder() as WorkSheetSource, { ...input, features, activeStoreCount: 1 });
    assert.equal(one.ficha?.store, null);
    assert.equal(render(one).includes("Tienda: Centro"), false);
    const noStore = workSheetModel({ ...witnessOrder(), store: null } as WorkSheetSource, { ...input, features, activeStoreCount: 5 });
    assert.equal(noStore.ficha?.store, null);
    assert.equal(one.ficha?.service, "Folletos");
    const inside = workSheetModel({ ...witnessOrder(), description: "<p>Folletos  tríptico</p>" } as WorkSheetSource, { ...input, features });
    assert.equal(inside.ficha?.service, null);
  });

  it("printableService compares lowercase, without accents and with single spaces", () => {
    assert.equal(printableService("Encuadernación", "<p>ENCUADERNACION en tapa dura</p>"), false);
    assert.equal(printableService("Tarjetas  de visita", "<p>Tarjetas de visita a doble cara</p>"), false);
    assert.equal(printableService("Tarjetas de visita", "<p>Tarjetas</p><p>de visita</p>"), false);
    assert.equal(printableService("Plastificado", "<p>Encuadernación</p>"), true);
    assert.equal(printableService("Plastificado", null), true);
    assert.equal(printableService("", "<p>x</p>"), false);
    assert.equal(printableService(null, "<p>x</p>"), false);
  });

  it("printableStore needs a store and more than one active store", () => {
    assert.equal(printableStore("Centro", 2), true);
    assert.equal(printableStore("Centro", 1), false);
    assert.equal(printableStore("Centro", 0), false);
    assert.equal(printableStore("  ", 3), false);
    assert.equal(printableStore(null, 3), false);
    assert.equal(printableStore("Centro", Number.NaN), false);
  });
});

describe("A4 samples of sur4-0134 (N14)", () => {
  it("renders every sample as a standalone page with the ficha layout", () => {
    const samples = sur4WorkSheetSamples();
    assert.deepEqual(samples.map((sample) => sample.name), [
      "sur4-0134-base",
      "sur4-0134-pasos-y-postits",
      "sur4-0134-servicio-fuera-y-sin-total",
      "sur4-0134-una-tienda",
      "sur4-0134-a4-completo",
    ]);
    for (const sample of samples) {
      const model = sampleWorkSheetModel(sample);
      const html = renderWorkSheetHtml(model);
      assert.equal(model.profile, "ficha");
      assert.match(html, /^<!doctype html><html lang="es">/);
      assert.match(html, /Encuadernaciones Magerit/);
      assert.match(html, /Total pedido/);
      assert.match(html, /Falta por abonar/);
      assert.match(html, /Descripción/);
      assert.match(html, /size: A4/);
      assert.equal(html.includes("TESTIGO"), false);
    }
    const [base, full, outside, oneStore, complete] = samples.map((sample) => sampleWorkSheetModel(sample));
    assert.deepEqual([complete.steps.length, complete.printableNotes.length], [3, 5]);
    assert.equal(base.ficha?.service, null, "the service is already in the description");
    assert.equal(base.ficha?.store, "Tienda Centro");
    assert.deepEqual([base.steps.length, base.printableNotes.length], [0, 0]);
    assert.deepEqual([full.steps.length, full.printableNotes.length], [3, 5]);
    assert.equal(outside.ficha?.service, "Plastificado");
    assert.equal(outside.ficha?.amounts[0].value, "Sin definir");
    assert.equal(oneStore.ficha?.store, null);
    const html = renderWorkSheetHtml(full);
    assert.match(html, /Secuencia de trabajo/);
    assert.match(html, /Sin asignar/);
    assert.match(html, /Post-its/);
  });
});
