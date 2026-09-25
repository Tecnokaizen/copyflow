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
    assert.match(ui, /title="Presupuestos"/);
    assert.match(ui, /Ver presupuestos/);
    assert.match(ui, /label="Pedidos activos"/);
    assert.match(ui, /label="Urgentes"/);
    assert.match(ui, /label="Retrasados"/);
    assert.match(ui, /label="Entregas hoy"/);
    assert.match(ui, /label="Abiertos"/);
    assert.match(ui, /href="\/quotes\?status=pending"/);
    assert.match(ui, /grid-cols-2 gap-3 lg:grid-cols-4/);
    assert.doesNotMatch(ui, /Presupuestos abiertos/);
    const kpi = ui.indexOf('label="Entregas hoy"');
    const quotes = ui.indexOf('title="Presupuestos"');
    const upcoming = ui.indexOf('title="Próximas entregas"');
    assert.ok(kpi >= 0 && kpi < quotes && quotes < upcoming);
    const quotesBlock = ui.slice(quotes, upcoming);
    assert.equal(quotesBlock.includes("gc-kpi"), false);
    assert.equal(ui.includes("brandColor"), false);
    assert.match(ui, /gc-kpi-value-urgent/);
    assert.match(ui, /gc-kpi-value-warning/);
    assert.match(ui, /gc-kpi-value-info/);
    assert.equal(ui.includes("data?.quotes") && !ui.includes("quotesEnabled"), true);
  });
});