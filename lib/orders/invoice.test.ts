import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildDraftSaveSteps, createOrderDraft, normalizeInvoiceState } from "./draft";
import {
  formatInvoiceFlag,
  invoiceFromSelectValue,
  invoiceSelectValue,
  parseInvoicePayload,
} from "./invoice";
import type { Order, OrderStatus } from "./types";

const STATUSES: OrderStatus[] = [{ id: "st-1", code: "received", name: "Recibido", is_initial: true }];

function order(overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1", reference: "PED-1", title: "Tarjetas", description: null, priority: "normal",
    due_at: null, received_at: null, ready_at: null, delivered_at: null, archived_at: null, version: "0",
    customer_notification_status: "not_notified", notes: null, external_folder_url: null, client_id: null,
    status_id: "st-1", client: null, service: null, service_id: null, entry_channel_id: null,
    assigned_team_member_id: null, order_context_id: null, store_id: null, entry_channel: null,
    assigned_team_member: null, status: { name: "Recibido", code: "received" }, order_context: null,
    store: null, file_status_id: null, quote_status_id: null, payment_status_id: null,
    delivery_method_id: null, file_status: null, quote_status: null, payment_status: null,
    delivery_method: null,
    ...overrides,
  };
}

describe("parseInvoicePayload (server validation)", () => {
  it("accepts every valid combination", () => {
    assert.deepEqual(parseInvoicePayload({ invoice_required: null, invoice_delivered: null }), { ok: true, value: { invoice_required: null, invoice_delivered: null } });
    assert.deepEqual(parseInvoicePayload({ invoice_required: false, invoice_delivered: null }), { ok: true, value: { invoice_required: false, invoice_delivered: null } });
    assert.deepEqual(parseInvoicePayload({ invoice_required: true, invoice_delivered: null }), { ok: true, value: { invoice_required: true, invoice_delivered: null } });
    assert.deepEqual(parseInvoicePayload({ invoice_required: true, invoice_delivered: false }), { ok: true, value: { invoice_required: true, invoice_delivered: false } });
    assert.deepEqual(parseInvoicePayload({ invoice_required: true, invoice_delivered: true }), { ok: true, value: { invoice_required: true, invoice_delivered: true } });
  });

  it("normalises delivery to null when not required", () => {
    assert.deepEqual(parseInvoicePayload({ invoice_required: false, invoice_delivered: false }), { ok: true, value: { invoice_required: false, invoice_delivered: null } });
    assert.deepEqual(parseInvoicePayload({ invoice_required: null, invoice_delivered: false }), { ok: true, value: { invoice_required: null, invoice_delivered: null } });
  });

  it("rejects «Entregada: Sí» without «Requiere factura: Sí» and malformed values", () => {
    assert.equal(parseInvoicePayload({ invoice_required: false, invoice_delivered: true }).ok, false);
    assert.equal(parseInvoicePayload({ invoice_required: null, invoice_delivered: true }).ok, false);
    for (const bad of ["true", 1, 0, "si", {}, []]) {
      assert.equal(parseInvoicePayload({ invoice_required: bad, invoice_delivered: null }).ok, false, String(bad));
      assert.equal(parseInvoicePayload({ invoice_required: true, invoice_delivered: bad }).ok, false, String(bad));
    }
    assert.equal(parseInvoicePayload({}).ok, false, "both keys are required");
    assert.equal(parseInvoicePayload({ invoice_required: true }).ok, false);
  });
});

describe("invoice select helpers", () => {
  it("round-trips the tri-state", () => {
    for (const value of [true, false, null]) assert.equal(invoiceFromSelectValue(invoiceSelectValue(value)), value);
    assert.equal(invoiceSelectValue(undefined), "");
    assert.deepEqual([true, false, null, undefined].map(formatInvoiceFlag), ["Sí", "No", "Sin indicar", "Sin indicar"]);
  });
});

describe("invoice draft step", () => {
  it("has no step for an untouched historical order", () => {
    const historical = order();
    assert.deepEqual(buildDraftSaveSteps(historical, createOrderDraft(historical, STATUSES), STATUSES), []);
  });

  it("emits one invoice step with normalised values", () => {
    const base = order();
    const draft = createOrderDraft(base, STATUSES);
    draft.invoice_required = true;
    draft.invoice_delivered = true;
    assert.deepEqual(buildDraftSaveSteps(base, draft, STATUSES), [
      { kind: "invoice", invoice_required: true, invoice_delivered: true, label: "Factura" },
    ]);

    const required = order({ invoice_required: true, invoice_delivered: true });
    const unset = createOrderDraft(required, STATUSES);
    unset.invoice_required = false; // Sí → No, delivery left stale in the draft
    assert.deepEqual(buildDraftSaveSteps(required, unset, STATUSES), [
      { kind: "invoice", invoice_required: false, invoice_delivered: null, label: "Factura" },
    ]);
  });

  it("ignores a stale delivery value when nothing applicable changed", () => {
    const notRequired = order({ invoice_required: false, invoice_delivered: null });
    const draft = createOrderDraft(notRequired, STATUSES);
    draft.invoice_delivered = false;
    assert.deepEqual(buildDraftSaveSteps(notRequired, draft, STATUSES), []);
    assert.deepEqual(normalizeInvoiceState(false, true), { invoice_required: false, invoice_delivered: null });
  });
});
