import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  builtOrderDetailLayouts,
  orderDetailLayout,
} from "@/components/orders/detail/views";
import {
  ORDER_DETAIL_MODULE_KEYS,
  type OrderDetailFacts,
  type OrderDetailModules,
} from "@/components/orders/detail/views/contract";
import {
  IMPLEMENTED_ORDER_DETAIL_VIEWS,
  ORDER_DETAIL_VIEW_CODES,
} from "@/lib/orders/detail-views";
import { orderLabels } from "@/lib/orders/labels";
import { NO_ORDER_FEATURES } from "@/lib/orders/order-features";
import type { Order } from "@/lib/orders/types";

// Order Detail Views V1 — layout contract: every module exactly once, header
// variant (header, headerCompact or headerProduction), gated modules may be
// null, and no layout loads data.

const HEADER_KEYS = ["header", "headerCompact", "headerProduction"];

function marker(key: string): ReactNode {
  return createElement("i", { "data-module": key });
}

function markers(nullKeys: string[] = []): OrderDetailModules {
  return Object.fromEntries(
    ORDER_DETAIL_MODULE_KEYS.map((key) => [
      key,
      nullKeys.includes(key) ? null : marker(key),
    ])
  ) as OrderDetailModules;
}

const FACTS = {
  order: {
    id: "o1",
    reference: "T-0001",
    title: "Pedido de prueba",
    priority: "normal",
    due_at: null,
    status: { name: "Pendiente", code: "pending" },
    assigned_team_member: null,
    assigned_team_member_id: null,
    archived_at: null,
  } as unknown as Order,
  labels: orderLabels({ custom: false }),
  features: { ...NO_ORDER_FEATURES, stickyNotes: true, workSequence: true },
  collection: null,
  statuses: [],
  canMutate: true,
  archived: false,
  editing: false,
  noteComposeRequest: 0,
} satisfies OrderDetailFacts;

const OPTIONAL = ["pinnedNotes", "sequence", "tracking", "stickyNotes", "sourceQuote"];
const ALWAYS = ["production", "files", "summary", "fulfillment", "activity", "legacyNotes", "notices"];

function count(html: string, key: string) {
  return html.split(`data-module="${key}"`).length - 1;
}

describe("Order Detail Views — layout contract", () => {
  it("registers a layout for every implemented view", () => {
    const built = new Set(builtOrderDetailLayouts().map(([code]) => code));
    for (const code of IMPLEMENTED_ORDER_DETAIL_VIEWS) {
      assert.ok(built.has(code), `${code} is implemented but has no layout`);
    }
  });

  it("unknown or unbuilt codes render the classic layout", () => {
    const classic = orderDetailLayout("classic");
    const built = new Set(builtOrderDetailLayouts().map(([code]) => code));
    for (const code of ORDER_DETAIL_VIEW_CODES) {
      if (!built.has(code)) assert.equal(orderDetailLayout(code), classic);
    }
  });

  for (const [code, { Layout }] of builtOrderDetailLayouts()) {
    describe(code, () => {
      it("places every module exactly once (one header)", () => {
        const html = renderToStaticMarkup(
          createElement(Layout, { modules: markers(), facts: FACTS })
        );
        const headers = HEADER_KEYS.reduce((sum, key) => sum + count(html, key), 0);
        assert.equal(headers, 1, "exactly one header variant");
        for (const key of ORDER_DETAIL_MODULE_KEYS) {
          if (HEADER_KEYS.includes(key)) continue;
          assert.equal(count(html, key), 1, `${key} must appear exactly once`);
        }
      });

      it("renders without the optional modules (features off, no quote)", () => {
        const html = renderToStaticMarkup(
          createElement(Layout, {
            modules: markers(OPTIONAL),
            facts: { ...FACTS, features: NO_ORDER_FEATURES },
          })
        );
        for (const key of OPTIONAL) assert.equal(count(html, key), 0);
        for (const key of ALWAYS) {
          assert.equal(count(html, key), 1, `${key} must still appear`);
        }
      });

      it("renders an archived, read-only order with every module", () => {
        const html = renderToStaticMarkup(
          createElement(Layout, {
            modules: markers(),
            facts: { ...FACTS, canMutate: false, archived: true },
          })
        );
        for (const key of ALWAYS) assert.equal(count(html, key), 1, key);
      });
    });
  }
});

describe("Order Detail Views — layouts never load data", () => {
  it("no fetch, Supabase or effects in layout files", () => {
    const dir = import.meta.dirname;
    const files = readdirSync(dir).filter((f) => f.endsWith("-layout.tsx"));
    assert.ok(files.length > 0);
    for (const file of files) {
      const source = readFileSync(join(dir, file), "utf8");
      assert.doesNotMatch(source, /\bfetch\(/, `${file} must not fetch`);
      assert.doesNotMatch(source, /supabase/i, `${file} must not touch Supabase`);
      assert.doesNotMatch(source, /useEffect/, `${file} must not run effects`);
    }
  });
});

describe("Order Detail Views — per-view behaviour", () => {
  it("B groups every module into four mounted sections and opens Trabajo first", async () => {
    const { TabsOrderLayout } = await import("@/components/orders/detail/views/tabs-layout");
    const html = renderToStaticMarkup(
      createElement(TabsOrderLayout, { modules: markers(), facts: FACTS })
    );
    const panels = html.match(/<div[^>]*role="tabpanel"[^>]*>/g) ?? [];
    assert.equal(panels.length, 4);
    assert.equal(panels.filter((tag) => !/\bhidden=""/.test(tag)).length, 1);
    // The display class must agree: Tailwind's `flex` would beat [hidden].
    const hasClass = (tag: string, name: string) =>
      (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/).includes(name);
    assert.equal(panels.filter((tag) => hasClass(tag, "flex")).length, 1);
    assert.equal(panels.filter((tag) => hasClass(tag, "hidden")).length, 3);
    assert.match(html, /aria-selected="true"[^>]*>Trabajo/);
    for (const label of ["Trabajo", "Cobro y entrega", "Post-its", "Secuencia de trabajo"]) {
      assert.ok(html.includes(`>${label}</button>`), `tab ${label} exists`);
    }
    // Every section keeps its data mounted, even while hidden: uploads,
    // financial drafts, notes and the timeline survive switching tabs.
    for (const key of [
      "summary", "production", "files", "fulfillment", "pinnedNotes",
      "stickyNotes", "legacyNotes", "sequence", "tracking", "activity",
    ]) assert.equal(count(html, key), 1, `${key} is rendered once`);
    const moduleOrder = [
      "sourceQuote", "summary", "production", "files", "fulfillment",
      "pinnedNotes", "stickyNotes", "legacyNotes", "sequence", "tracking", "activity",
    ];
    for (let i = 1; i < moduleOrder.length; i++) {
      assert.ok(
        html.indexOf(`data-module="${moduleOrder[i - 1]}"`) <
        html.indexOf(`data-module="${moduleOrder[i]}"`),
        `${moduleOrder[i]} follows ${moduleOrder[i - 1]}`
      );
    }
    // The post-it composer navigation happens on a live prop change, not
    // during server rendering; only panel grouping is asserted here.
  });

  it("B shows its four tabs as a 2×2 grid on narrow screens and one row from md, never by scrolling", () => {
    const { Layout } = orderDetailLayout("tabs");
    const html = renderToStaticMarkup(createElement(Layout, { modules: markers(), facts: FACTS }));
    const tablist = html.match(/<div[^>]*role="tablist"[^>]*>/)?.[0] ?? "";
    assert.match(tablist, /\bgrid\b/);
    assert.match(tablist, /\bgrid-cols-2\b/);
    assert.match(tablist, /\bmd:flex\b/);
    assert.doesNotMatch(tablist, /overflow-x-auto/);
    assert.equal(html.split('role="tab"').length - 1, 4);
  });

  it("A, C and D keep resumen, trabajo y archivos in one work group", () => {
    for (const code of ["operational", "production", "hybrid"] as const) {
      const { Layout } = orderDetailLayout(code);
      const html = renderToStaticMarkup(createElement(Layout, { modules: markers(), facts: FACTS }));
      assert.equal(
        html.split('data-order-work-group=""').length - 1, 1,
        `${code}: single work group`
      );
      const groupIndex = html.indexOf('data-order-work-group=""');
      const markersInOrder = ["sourceQuote", "summary", "production", "files"];
      let previous = groupIndex;
      for (const key of markersInOrder) {
        const index = html.indexOf(`data-module="${key}"`);
        assert.ok(index > previous, `${code}: ${key} belongs to the grouped work area`);
        previous = index;
      }
      assert.equal(count(html, "fulfillment"), 1, `${code}: finances stay available`);
      assert.equal(count(html, "tracking"), 1, `${code}: visual tracking preserved`);
      assert.equal(count(html, "stickyNotes"), 1, `${code}: sticky notes preserved`);
    }
    const { Layout } = orderDetailLayout("classic");
    const classic = renderToStaticMarkup(createElement(Layout, { modules: markers(), facts: FACTS }));
    assert.doesNotMatch(classic, /data-order-work-group/, "classic stays unchanged");
  });

  it("C folds administration but keeps it mounted, and opens it while editing", async () => {
    const { ProductionOrderLayout } = await import("@/components/orders/detail/views/production-layout");
    const closed = renderToStaticMarkup(
      createElement(ProductionOrderLayout, { modules: markers(), facts: FACTS })
    );
    assert.match(closed, /<details[^>]*data-fold="Administración"/);
    assert.doesNotMatch(closed, /<details[^>]*open=""[^>]*data-fold="Administración"/);
    assert.equal(count(closed, "fulfillment"), 1);
    const editing = renderToStaticMarkup(
      createElement(ProductionOrderLayout, {
        modules: markers(),
        facts: { ...FACTS, editing: true },
      })
    );
    assert.match(editing, /<details[^>]*open=""[^>]*data-fold="Administración"/);
  });

  it("C folds «Gestión del pedido» like Administración: closed, mounted, open while editing", async () => {
    const { ProductionOrderLayout } = await import("@/components/orders/detail/views/production-layout");
    const closed = renderToStaticMarkup(createElement(ProductionOrderLayout, { modules: markers(), facts: FACTS }));
    assert.match(closed, /<details[^>]*data-fold="Gestión del pedido"/);
    assert.doesNotMatch(closed, /<details[^>]*open=""[^>]*data-fold="Gestión del pedido"/);
    const fold = closed.slice(closed.indexOf('data-fold="Gestión del pedido"'), closed.indexOf('data-fold="Administración"'));
    for (const key of ["summary", "production", "files"]) assert.equal(count(fold, key), 1, `${key} mounted inside the fold`);
    assert.doesNotMatch(closed, /<h2[^>]*>Gestión del pedido<\/h2>/, "no duplicate heading");
    const editing = renderToStaticMarkup(createElement(ProductionOrderLayout, { modules: markers(), facts: { ...FACTS, editing: true } }));
    assert.match(editing, /<details[^>]*open=""[^>]*data-fold="Gestión del pedido"/);
  });

  it("C and D lead with the production board even without sequence and post-its", () => {
    for (const code of ["production", "hybrid"] as const) {
      const { Layout } = orderDetailLayout(code);
      const html = renderToStaticMarkup(
        createElement(Layout, {
          modules: markers(OPTIONAL),
          facts: { ...FACTS, features: NO_ORDER_FEATURES },
        })
      );
      assert.match(html, /aria-label="Producción del pedido"/, code);
      assert.match(html, /Sin responsable/, code);
    }
  });

  it("A and D use the compact header, C the production one; classic and B the full one", () => {
    const expectations = {
      classic: "header",
      operational: "headerCompact",
      tabs: "header",
      production: "headerProduction",
      hybrid: "headerCompact",
    } as const;
    for (const [code, key] of Object.entries(expectations)) {
      const { Layout } = orderDetailLayout(code as keyof typeof expectations);
      const html = renderToStaticMarkup(createElement(Layout, { modules: markers(), facts: FACTS }));
      assert.equal(count(html, key), 1, `${code} uses ${key}`);
    }
  });
});

describe("nextStatusHint", () => {
  it("follows the tenant catalog, skips cancelled and inactive, stops at closed", async () => {
    const { nextStatusHint } = await import("@/components/orders/detail/views/parts");
    const statuses = [
      { id: "s1", code: "recibido", name: "Recibido", is_initial: true },
      { id: "s2", code: "anulado", name: "Anulado", is_cancelled: true },
      { id: "s3", code: "diseno", name: "Diseño", active: false },
      { id: "s4", code: "produccion", name: "Producción" },
      { id: "s5", code: "recogido", name: "Recogido", is_closed: true },
    ] as unknown as OrderDetailFacts["statuses"];
    const at = (id: string, status: Record<string, unknown>) =>
      ({
        ...FACTS,
        statuses,
        order: { ...FACTS.order, status_id: id, status },
      }) as OrderDetailFacts;
    assert.equal(nextStatusHint(at("s1", { code: "recibido", name: "Recibido" }))?.name, "Producción");
    assert.equal(nextStatusHint(at("s4", { code: "produccion", name: "Producción" }))?.name, "Recogido");
    assert.equal(nextStatusHint(at("s5", { code: "recogido", name: "Recogido", is_closed: true })), null);
    assert.equal(nextStatusHint(at("zz", { code: "otro", name: "Otro" })), null);
  });
});
