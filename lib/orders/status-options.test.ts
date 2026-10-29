import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  INACTIVE_STATUS_SUFFIX,
  isSelectableStatus,
  statusOptionsWithCurrent,
} from "./status-options";

const root = path.join(import.meta.dirname, "../..");
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

const CATALOGUE = [
  { id: "new", name: "Nuevo", active: true },
  { id: "old", name: "En imprenta", active: false },
  { id: "ready", name: "Listo" },
  { id: "gone", name: "Revisión antigua", active: false },
];

describe("order status selectors", () => {
  it("offers only active statuses as new values", () => {
    assert.deepEqual(statusOptionsWithCurrent(CATALOGUE, { id: "new", name: "Nuevo" }), [
      { id: "new", name: "Nuevo" },
      { id: "ready", name: "Listo" },
    ]);
    assert.equal(isSelectableStatus({ id: "x", name: "X" }), true, "missing flag = active");
    assert.equal(isSelectableStatus({ id: "x", name: "X", active: false }), false);
  });

  it("keeps a deactivated current status visible, marked and not selectable", () => {
    const options = statusOptionsWithCurrent(CATALOGUE, { id: "old", name: "En imprenta" });
    assert.deepEqual(options, [
      { id: "new", name: "Nuevo" },
      { id: "old", name: `En imprenta${INACTIVE_STATUS_SUFFIX}`, unavailable: true },
      { id: "ready", name: "Listo" },
    ]);
    // Other deactivated statuses stay hidden.
    assert.equal(options.some((option) => option.id === "gone"), false);
    // Catalogue order is preserved (sort_order comes from the API).
    assert.deepEqual(options.map((option) => option.id), ["new", "old", "ready"]);
  });

  it("shows the stored value while the catalogue is not loaded, without labelling it", () => {
    assert.deepEqual(statusOptionsWithCurrent([], { id: "old", name: " En imprenta " }), [
      { id: "old", name: "En imprenta", unavailable: true },
    ]);
    assert.deepEqual(statusOptionsWithCurrent([], { id: "old" }), [
      { id: "old", name: "Estado actual", unavailable: true },
    ]);
    assert.deepEqual(statusOptionsWithCurrent(CATALOGUE.slice(0, 1), { id: "" }), [
      { id: "new", name: "Nuevo" },
    ]);
  });

  it("both order status selectors use the rule and disable the unavailable option", () => {
    for (const file of [
      "components/orders/detail/order-quick-actions.tsx",
      "components/orders/detail/order-production.tsx",
    ]) {
      const text = source(file);
      assert.match(text, /statusOptionsWithCurrent\(statuses,/, file);
      assert.match(text, /disabled=\{status\.unavailable\}/, file);
      assert.doesNotMatch(text, /\{statuses\.map\(\(status\) =>/, file);
    }
    assert.match(
      source("components/orders/detail/order-header.tsx"),
      /currentStatusName=\{order\.status\?\.name\}/
    );
  });

  it("the status list API keeps sending the active flag the selectors rely on", () => {
    assert.match(source("app/api/order-statuses/route.ts"), /"id, code, name, active,/);
  });
});
