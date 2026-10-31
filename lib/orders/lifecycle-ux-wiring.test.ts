import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");

function read(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("lifecycle UX wiring", () => {
  it("I. quick actions archive through /archive helper and confirm copy", () => {
    const source = read("components/orders/detail/order-quick-actions.tsx");
    assert.match(source, /planStatusSave/);
    assert.match(source, /ARCHIVE_CONFIRM_COPY/);
    assert.match(source, /Archivar pedido/);
    assert.match(source, /canShowArchiveAction/);
    assert.match(source, /onArchive/);
  });

  it("workspace archives via PATCH archive path and maps lifecycle errors", () => {
    // Order Detail Views V1: logic in useOrderWorkspace, notices in the modules.
    const source = read("components/orders/detail/use-order-workspace.ts");
    const modules = read("components/orders/detail/order-detail-modules.tsx");
    assert.match(source, /archiveOrderPath/);
    assert.match(source, /parseLifecycleApiError/);
    assert.match(source, /method:\s*"PATCH"/);
    assert.match(source, /draftTerminalConfirm/);
    assert.match(modules, /Pedido archivado · solo consulta/);
    assert.equal(source.includes('.from("orders").update'), false);
    assert.equal(modules.includes('.from("orders").update'), false);
  });

  it("header shows archived badge and blocks mutations when archived", () => {
    const source = read("components/orders/detail/order-header.tsx");
    assert.match(source, /Archivado/);
    assert.match(source, /canMutateOrderActions/);
    assert.match(source, /isOrderArchived/);
  });
});
