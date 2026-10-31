import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadCustomerReceipt } from "@/lib/print/load-receipt";
import {
  CUSTOMER_RECEIPT_SELECT,
  customerReceiptModel,
  receiptFilename,
  type CustomerReceiptSource,
} from "@/lib/print/receipt";
import {
  ALL_WITNESSES,
  baseInput,
  PRIVATE,
  witnessCollection,
  witnessOrder,
} from "@/lib/print/receipt-pdf/fixture";

const ORDER_ID = "6f1c2f8e-1b2a-4c3d-9e4f-0a1b2c3d4e5f";
const TENANT = "tenant-a";
describe("customer receipt model (E4)", () => {
  it("contains no witness text at all, nor staff, status, priority or files", () => {
    const model = customerReceiptModel(witnessOrder() as CustomerReceiptSource, baseInput);
    const json = JSON.stringify(model);
    for (const text of [...ALL_WITNESSES, ...PRIVATE]) {
      assert.equal(json.includes(text), false, text);
    }
    assert.deepEqual(model.client, [
      { label: "Nombre", value: "Cliente Uno" },
      { label: "Empresa", value: "Empresa Uno" },
      { label: "Teléfono", value: "600 000 001" },
      { label: "Email", value: "uno@example.test" },
    ]);
    assert.deepEqual(model.amounts, [
      { label: "Total del pedido", value: "1.250,00 €" },
      { label: "Entregado a cuenta", value: "250,00 €" },
      { label: "Pendiente de cobro", value: "1.000,00 €" },
    ]);
    assert.deepEqual(model.pickup, { label: "Lugar de recogida", value: "Tienda Centro" });
    assert.deepEqual(model.dates.map((row) => row.label), ["Fecha de recepción", "Entrega prevista"]);
    assert.equal(model.descriptionTitle, "Descripción del trabajo");
    assert.deepEqual(model.descriptionLines, ["Encuadernación", "Tapa dura, 25 ejemplares.", "Estampación en dorado."]);
    assert.equal(model.filename, "Resguardo-S4C-0020.pdf");
    assert.equal(model.printedAt, "28/10/2026, 11:00");
  });

  it("uses the SUR4 names only with order_custom_labels and «Sin definir» without total", () => {
    const model = customerReceiptModel(witnessOrder() as CustomerReceiptSource, {
      ...baseInput,
      customLabels: true,
      amounts: { total: null, paid: "0.00", pending: null },
    });
    assert.deepEqual(model.amounts, [
      { label: "Total pedido", value: "Sin definir" },
      { label: "A cuenta", value: "0,00 €" },
      { label: "Falta por abonar", value: "Sin definir" },
    ]);
    assert.equal(model.descriptionTitle, "Descripción del trabajo");
  });

  it("skips the service when the description already names it, and the store when there is none", () => {
    const model = customerReceiptModel(
      { ...witnessOrder(), description: "<p>ENCUADERNACION en tapa dura</p>", store: null } as CustomerReceiptSource,
      baseInput
    );
    assert.deepEqual(model.descriptionLines, ["ENCUADERNACION en tapa dura"]);
    assert.equal(model.pickup, null);
  });

  it("builds a safe file name from the reference only", () => {
    assert.equal(receiptFilename("S4C-0020"), "Resguardo-S4C-0020.pdf");
    assert.equal(receiptFilename('A/../"b"; x.pdf\r\n'), "Resguardo-A-b-x-pdf.pdf");
    assert.equal(receiptFilename("Ñandú 12"), "Resguardo-Nandu-12.pdf");
    assert.equal(receiptFilename(""), "Resguardo-pedido.pdf");
    assert.equal(receiptFilename(null), "Resguardo-pedido.pdf");
    assert.match(receiptFilename("x".repeat(500)), /^Resguardo-x{64}\.pdf$/);
  });

  it("keeps a closed select without notes, staff, status or files", () => {
    for (const forbidden of ["notes", "external_folder_url", "team_members", "status", "priority", "order_files", "payments", "*"]) {
      assert.equal(CUSTOMER_RECEIPT_SELECT.includes(forbidden), false, forbidden);
    }
  });
});

describe("customer receipt loader (E4)", () => {
  function fake(options: { orderTenant?: string; customLabels?: boolean } = {}) {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    const client = {
      calls,
      async rpc(name: string, args: Record<string, unknown>) {
        calls.push({ table: `rpc:${name}`, method: "rpc", args: [args] });
        if (name === "tenant_has_feature") return { data: args.p_code === "order_custom_labels" && options.customLabels === true, error: null };
        if (name === "order_collection_v1") return { data: witnessCollection, error: null };
        throw new Error(name);
      },
      from(table: string) {
        const filters: Array<[string, unknown]> = [];
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq"]) {
          chain[method] = (...args: unknown[]) => {
            calls.push({ table, method, args });
            if (method === "eq") filters.push([String(args[0]), args[1]]);
            return chain;
          };
        }
        chain.maybeSingle = async () => {
          const tenant = filters.find(([key]) => key === "tenant_id")?.[1];
          if (table === "orders") return { data: tenant === (options.orderTenant ?? TENANT) ? witnessOrder() : null, error: null };
          if (table === "tenant_settings") {
            return {
              data: {
                business_name: "Taller Norte",
                timezone: "Europe/Madrid",
                branding: {
                  quote_footer: "<p>Pie configurado</p>",
                  logo: { storage_key: `branding/${TENANT}/logo/11111111-1111-4111-8111-111111111111`, content_type: "image/png" },
                },
              },
              error: null,
            };
          }
          throw new Error(table);
        };
        return chain;
      },
    };
    return client;
  }

  it("binds every read to the session tenant and never prints a witness", async () => {
    const supabase = fake({ customLabels: true });
    const loaded = await loadCustomerReceipt(ORDER_ID, { supabase: supabase as never, tenant: { id: TENANT, name: "Taller" } });
    assert.equal(loaded.status, "ok");
    if (loaded.status !== "ok") return;
    for (const text of ALL_WITNESSES) assert.equal(JSON.stringify(loaded).includes(text), false, text);
    assert.equal(loaded.model.footer, "<p>Pie configurado</p>");
    assert.equal(loaded.model.amounts[0].label, "Total pedido");
    assert.equal(loaded.logo?.contentType, "image/png");
    const tables = new Set(supabase.calls.map((call) => call.table));
    assert.deepEqual([...tables].sort(), ["orders", "rpc:order_collection_v1", "rpc:tenant_has_feature", "tenant_settings"]);
    assert.deepEqual(
      supabase.calls.filter((call) => call.table === "orders" && call.method === "eq").map((call) => call.args),
      [["id", ORDER_ID], ["tenant_id", TENANT]]
    );
    assert.deepEqual(supabase.calls.find((call) => call.table === "orders" && call.method === "select")?.args, [CUSTOMER_RECEIPT_SELECT]);
  });

  it("answers not_found for another tenant or a malformed id", async () => {
    const foreign = fake({ orderTenant: "tenant-b" });
    assert.equal((await loadCustomerReceipt(ORDER_ID, { supabase: foreign as never, tenant: { id: TENANT, name: "T" } })).status, "not_found");
    assert.equal(foreign.calls.some((call) => call.table === "rpc:order_collection_v1"), false);
    const malformed = fake();
    assert.equal((await loadCustomerReceipt("../x", { supabase: malformed as never, tenant: { id: TENANT, name: "T" } })).status, "not_found");
    assert.equal(malformed.calls.length, 0);
  });

  it("drops a logo stored under another tenant", async () => {
    const supabase = fake({ orderTenant: "tenant-z" });
    const loaded = await loadCustomerReceipt(ORDER_ID, { supabase: supabase as never, tenant: { id: "tenant-z", name: "Z" } });
    assert.equal(loaded.status, "ok");
    assert.equal(loaded.status === "ok" && loaded.logo, null);
  });
});
