import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARCHIVE_CONFIRM_COPY,
  archiveOrderPath,
  canMutateOrderActions,
  canShowArchiveAction,
  lifecycleUxErrorMessage,
  orderStatusOptionsWithCurrent,
  planStatusSave,
  resolveTerminalConfirmCopy,
  terminalKindFromStatus,
} from "./lifecycle-ux";

const open = { is_closed: false, is_cancelled: false, is_ready: false };
const ready = { is_closed: false, is_cancelled: false, is_ready: true };
const closed = { is_closed: true, is_cancelled: false, is_ready: true };
const cancelled = { is_closed: false, is_cancelled: true, is_ready: false };

describe("terminalKindFromStatus / confirm copy", () => {
  it("A. non-terminal statuses do not require special terminal confirmation", () => {
    assert.equal(terminalKindFromStatus(open), null);
    assert.equal(terminalKindFromStatus(ready), null);
    assert.equal(
      planStatusSave({
        currentStatusId: "st-open",
        nextStatusId: "st-ready",
        nextStatus: ready,
        terminalConfirmed: false,
      }).type,
      "save_direct"
    );
  });

  it("B. closed destination requires confirmation with delivery copy", () => {
    assert.equal(terminalKindFromStatus(closed), "closed");
    const copy = resolveTerminalConfirmCopy(closed);
    assert.equal(copy.title, "Marcar pedido como entregado");
    assert.match(copy.description, /cierra el pedido/i);
    assert.equal(copy.confirmLabel, "Confirmar entrega");

    const plan = planStatusSave({
      currentStatusId: "st-open",
      nextStatusId: "st-closed",
      nextStatus: closed,
      terminalConfirmed: false,
    });
    assert.equal(plan.type, "require_terminal_confirm");
    if (plan.type === "require_terminal_confirm") {
      assert.equal(plan.copy.title, copy.title);
    }
  });

  it("C. cancelled destination requires confirmation with cancel copy", () => {
    assert.equal(terminalKindFromStatus(cancelled), "cancelled");
    const copy = resolveTerminalConfirmCopy(cancelled);
    assert.equal(copy.title, "Cancelar pedido");
    assert.match(copy.description, /colas operativas/i);
    assert.equal(copy.confirmLabel, "Confirmar cancelación");
  });

  it("D. confirmed terminal plan proceeds to save", () => {
    const plan = planStatusSave({
      currentStatusId: "st-open",
      nextStatusId: "st-closed",
      nextStatus: closed,
      terminalConfirmed: true,
    });
    assert.deepEqual(plan, {
      type: "save_direct",
      statusId: "st-closed",
    });
  });

  it("E. cancelling the dialog never reaches save_direct while unconfirmed", () => {
    const plan = planStatusSave({
      currentStatusId: "st-open",
      nextStatusId: "st-cancelled",
      nextStatus: cancelled,
      terminalConfirmed: false,
    });
    assert.equal(plan.type, "require_terminal_confirm");
    assert.notEqual(plan.type, "save_direct");
  });

  it("uses generic terminal copy for atypical flag combinations", () => {
    const both = { is_closed: true, is_cancelled: true, is_ready: false };
    // Prefer cancelled semantics when both are set (safer destructive path).
    assert.equal(terminalKindFromStatus(both), "cancelled");
  });
});

describe("archive CTA visibility", () => {
  it("F. archive visible only for terminal + not archived", () => {
    assert.equal(
      canShowArchiveAction({
        archived_at: null,
        status: closed,
      }),
      true
    );
    assert.equal(
      canShowArchiveAction({
        archived_at: null,
        status: cancelled,
      }),
      true
    );
  });

  it("G. archive hidden while order is still active", () => {
    assert.equal(
      canShowArchiveAction({
        archived_at: null,
        status: open,
      }),
      false
    );
    assert.equal(
      canShowArchiveAction({
        archived_at: null,
        status: ready,
      }),
      false
    );
  });

  it("H. archive hidden when already archived", () => {
    assert.equal(
      canShowArchiveAction({
        archived_at: "2026-09-17T12:00:00.000Z",
        status: closed,
      }),
      false
    );
  });

  it("I. archive path targets PATCH /api/orders/[id]/archive", () => {
    assert.equal(
      archiveOrderPath("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      "/api/orders/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/archive"
    );
  });

  it("J. archive confirm copy is non-destructive consultable messaging", () => {
    assert.equal(ARCHIVE_CONFIRM_COPY.title, "Archivar pedido");
    assert.match(ARCHIVE_CONFIRM_COPY.description, /consulta/i);
    assert.equal(ARCHIVE_CONFIRM_COPY.confirmLabel, "Archivar");
  });
});

describe("lifecycle UX errors and permissions", () => {
  it("K. ORDER_ARCHIVED maps to understandable Spanish copy", () => {
    assert.equal(
      lifecycleUxErrorMessage("ORDER_ARCHIVED"),
      "Este pedido está archivado y no admite cambios."
    );
  });

  it("L. ORDER_NOT_TERMINAL maps to understandable Spanish copy", () => {
    assert.equal(
      lifecycleUxErrorMessage("ORDER_NOT_TERMINAL"),
      "Solo puedes archivar un pedido entregado o cancelado."
    );
  });

  it("N. viewer (canWrite=false) has no mutable lifecycle actions", () => {
    assert.equal(
      canMutateOrderActions({
        canWrite: false,
        archived_at: null,
      }),
      false
    );
  });

  it("O. archived orders stay readable but block mutations", () => {
    assert.equal(
      canMutateOrderActions({
        canWrite: true,
        archived_at: "2026-09-17T12:00:00.000Z",
      }),
      false
    );
    assert.equal(
      canMutateOrderActions({
        canWrite: true,
        archived_at: null,
      }),
      true
    );
  });
});

describe("order status selector options", () => {
  const statuses = [
    { id: "st-new", name: "Nuevo", active: true },
    { id: "st-old", name: "E2E track histórico", active: false },
    { id: "st-ready", name: "Listo", active: true },
    { id: "st-legacy", name: "Sin campo active" },
  ];

  it("P. inactive statuses are not offered (the database rejects them)", () => {
    assert.deepEqual(orderStatusOptionsWithCurrent(statuses, "st-new"), [
      { id: "st-new", name: "Nuevo" },
      { id: "st-ready", name: "Listo" },
      { id: "st-legacy", name: "Sin campo active" },
    ]);
  });

  it("Q. an inactive current status stays visible, labelled and not selectable", () => {
    const options = orderStatusOptionsWithCurrent(statuses, "st-old");
    assert.deepEqual(options, [
      { id: "st-new", name: "Nuevo" },
      {
        id: "st-old",
        name: "E2E track histórico (inactivo)",
        unavailable: true,
      },
      { id: "st-ready", name: "Listo" },
      { id: "st-legacy", name: "Sin campo active" },
    ]);
    assert.deepEqual(
      options.filter((option) => !option.unavailable).map((option) => option.id),
      ["st-new", "st-ready", "st-legacy"]
    );
  });

  it("R. an active current status is listed normally", () => {
    const options = orderStatusOptionsWithCurrent(statuses, "st-ready");
    assert.equal(options.some((option) => option.unavailable), false);
    assert.equal(options.some((option) => option.id === "st-old"), false);
  });
});
