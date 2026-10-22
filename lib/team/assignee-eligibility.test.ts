import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assigneeOptionsWithCurrent,
  isAssigneeNotEligibleError,
} from "./assignee-eligibility";
import { interpretCommercialDatabaseError } from "../quotes/commercial";
import { QUOTE_MESSAGES } from "../quotes/errors";

const root = path.join(import.meta.dirname, "../..");
const source = (file: string) => readFileSync(path.join(root, file), "utf8");

const DB_ERROR = { code: "22023", message: "team member cannot receive orders" };

describe("assignee eligibility (R6)", () => {
  it("recognises the database refusal and nothing else", () => {
    assert.equal(isAssigneeNotEligibleError(DB_ERROR), true);
    assert.equal(
      isAssigneeNotEligibleError({ code: "22023", message: "invalid team member for current tenant" }),
      false
    );
    assert.equal(isAssigneeNotEligibleError({ code: "42501", message: DB_ERROR.message }), false);
    assert.equal(isAssigneeNotEligibleError(null), false);
  });

  it("keeps the current, no longer eligible assignee visible but not selectable", () => {
    const options = [{ id: "a", name: "Ana" }];
    assert.deepEqual(assigneeOptionsWithCurrent(options, { id: "a", name: "Ana" }), [
      { id: "a", name: "Ana" },
    ]);
    assert.deepEqual(assigneeOptionsWithCurrent(options, { id: null }), [{ id: "a", name: "Ana" }]);
    assert.deepEqual(assigneeOptionsWithCurrent(options, { id: "b", name: "Bea" }), [
      { id: "a", name: "Ana" },
      { id: "b", name: "Bea (no disponible)", unavailable: true },
    ]);
    assert.equal(
      assigneeOptionsWithCurrent([], { id: "b", name: " " })[0].name,
      "Responsable actual (no disponible)"
    );
  });

  it("quote routes answer the refusal with a specific message", () => {
    const failure = interpretCommercialDatabaseError(DB_ERROR, QUOTE_MESSAGES.convert);
    assert.equal(failure.status, 422);
    assert.equal(failure.code, "assignee_not_eligible");
    assert.equal(failure.error, QUOTE_MESSAGES.assignee);
    // Other 22xxx errors keep their generic answer.
    assert.equal(
      interpretCommercialDatabaseError({ code: "22023", message: "other" }, QUOTE_MESSAGES.convert).code,
      "business_invariant"
    );
  });

  it("selectors ask only for assignable people", () => {
    assert.match(source("app/api/orders/options/route.ts"), /\.eq\("can_receive_orders", true\)/);
    for (const file of [
      "components/quotes/quote-conversion-dialog.tsx",
      "components/quotes/quote-creation-editor.tsx",
      "components/quotes/quote-assignment.tsx",
      "components/quotes/quote-form.tsx",
    ]) {
      const text = source(file);
      assert.match(text, /\/api\/team\?assignable=true/, file);
      assert.doesNotMatch(text, /\/api\/team\?active=true/, file);
    }
  });

  it("direct writes map the refusal instead of failing with 500", () => {
    for (const file of [
      "app/api/orders/route.ts",
      "app/api/quotes/route.ts",
      "app/api/quotes/[id]/route.ts",
    ]) {
      assert.match(source(file), /isAssigneeNotEligibleError\(/, file);
    }
  });
});
