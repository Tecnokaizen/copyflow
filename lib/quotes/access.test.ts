import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { canAccessQuotesModule } from "./access";
import { canViewActivity } from "../auth/membership-roles";
import { navStructureForRole } from "../nav/items";
import { operationalCreateVisibility } from "./workflow";

describe("Quotes operational access", () => {
  for (const role of ["owner", "admin", "manager", "staff", "viewer"] as const) {
    for (const enabled of [true, false]) {
      it(`${role}, quotes ${enabled ? "ON" : "OFF"}: gates module, navigation and creation`, () => {
        const allowed = enabled && role !== "viewer";
        assert.equal(canAccessQuotesModule(role, enabled), allowed);
        assert.equal(operationalCreateVisibility(role, enabled).quote, allowed);
        assert.equal(
          navStructureForRole(role, { quotes: enabled }).some(
            (entry) => entry.type === "link" && entry.item.id === "quotes"
          ),
          allowed
        );
      });
    }
  }

  it("fails closed for absent and unknown roles", () => {
    for (const role of [null, undefined, "", "Personal", "superadmin"]) {
      assert.equal(canAccessQuotesModule(role, true), false);
    }
  });

  it("keeps staff outside global Activity", () => {
    assert.equal(canViewActivity("staff"), false);
    assert.equal(canViewActivity("viewer"), false);
  });

  it("keeps every Quotes API and the page layout behind the shared gate", () => {
    for (const file of [
      "app/api/quotes/route.ts", "app/api/quotes/statuses/route.ts",
      "app/api/quotes/[id]/route.ts", "app/api/quotes/[id]/status/route.ts",
      "app/api/quotes/[id]/convert/route.ts", "app/api/quotes/[id]/activity/route.ts",
    ]) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      assert.match(source, /await requireQuotesAccess\(\)/, file);
      assert.match(source, /return access.response/, file);
    }
    const layout = readFileSync(new URL("../../app/quotes/layout.tsx", import.meta.url), "utf8");
    assert.match(layout, /canAccessQuotesModule\(context.membership.role, enabled\)/);
  });

  it("scopes activity to the current tenant before calling the quote-only RPC", () => {
    const source = readFileSync(new URL("../../app/api/quotes/[id]/activity/route.ts", import.meta.url), "utf8");
    assert.match(source, /\.eq\("tenant_id", access.context.tenant.id\)/);
    assert.match(source, /\.rpc\("list_quote_activity", \{\s*p_quote_id: id/);
    assert.equal(source.includes('.from("activity_log")'), false);
    assert.equal(source.includes("list_activity_log"), false);
    assert.ok(source.indexOf("if (quoteError || !quote)") < source.indexOf('.rpc("list_quote_activity"'));
  });
});
