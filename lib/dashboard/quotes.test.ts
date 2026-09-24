import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { quoteOperationalCounts } from "./quotes";

describe("quote dashboard counts", () => {
  it("keeps potential work out of converted and rejected quotes", () => {
    assert.deepEqual(
      quoteOperationalCounts([
        { code: "draft", converted: false },
        { code: "pending", converted: false },
        { code: "sent", converted: false },
        { code: "accepted", converted: false },
        { code: "accepted", converted: true },
        { code: "rejected", converted: false },
      ]),
      {
        open: 4,
        in_review: 1,
        sent: 1,
        accepted_pending: 1,
      }
    );
  });

  it("loads quote counts only behind the quotes feature", () => {
    const source = readFileSync(
      new URL("../../app/api/dashboard/route.ts", import.meta.url),
      "utf8"
    );
    assert.match(source, /tenantHasFeature/);
    assert.match(source, /canAccessQuotesModule/);
    assert.match(source, /if \(quotesEnabled\)/);
    assert.match(source, /\.eq\("tenant_id", tenantId\)/);
    assert.equal(source.includes("counts.quotes"), false);

    const ui = readFileSync(
      new URL("../../components/dashboard/tenant-dashboard.tsx", import.meta.url),
      "utf8"
    );
    assert.match(ui, /data\?\.quotes/);
    assert.match(ui, /Presupuestos abiertos/);
  });
});