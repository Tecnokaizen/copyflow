import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  canManageOrderDetailView,
  mergeOrderDetailViewPreference,
  orderDetailViewState,
  parseOrderDetailViewPatch,
  planOrderDetailViewUpdate,
  userFacingOrderDetailViewSaveError,
} from "@/lib/settings/order-detail-view";

const NOW = new Date("2026-10-30T12:00:00.000Z");
const OTHER = {
  quick_order_layout_v1: { version: 1, placements: { client: "primary" } },
  branding: { accent: "#123456" },
};

describe("parseOrderDetailViewPatch", () => {
  it("accepts an implemented view with a revision", () => {
    assert.deepEqual(parseOrderDetailViewPatch({ view: "tabs", revision: "r1" }), {
      ok: true,
      view: "tabs",
      revision: "r1",
    });
    assert.equal(parseOrderDetailViewPatch({ view: "classic", revision: "r1" }).ok, true);
  });

  it("rejects unknown views, missing revision and extra keys", () => {
    for (const body of [
      null,
      [],
      { view: "kanban", revision: "r1" },
      { view: "tabs" },
      { view: "tabs", revision: "  " },
      { view: "tabs", revision: "r1", tenant_id: "x" },
      { view: "tabs", revision: "r1", previous_view: "classic" },
    ]) {
      assert.equal(parseOrderDetailViewPatch(body).ok, false, JSON.stringify(body));
    }
  });
});

describe("mergeOrderDetailViewPreference", () => {
  it("keeps every other preference untouched", () => {
    const next = mergeOrderDetailViewPreference({
      currentPreferences: OTHER,
      view: "hybrid",
      userId: "u1",
      now: NOW,
    });
    assert.deepEqual(next.quick_order_layout_v1, OTHER.quick_order_layout_v1);
    assert.deepEqual(next.branding, OTHER.branding);
    assert.deepEqual(next.order_detail_view_v1, {
      version: 1,
      view: "hybrid",
      previous_view: "classic",
      updated_at: NOW.toISOString(),
      updated_by: "u1",
    });
  });

  it("remembers the view applied before, and keeps it when re-applying", () => {
    const first = mergeOrderDetailViewPreference({ currentPreferences: OTHER, view: "tabs", userId: "u1", now: NOW });
    const second = mergeOrderDetailViewPreference({ currentPreferences: first, view: "production", userId: "u2", now: NOW });
    assert.equal((second.order_detail_view_v1 as { previous_view: string }).previous_view, "tabs");
    const again = mergeOrderDetailViewPreference({ currentPreferences: second, view: "production", userId: "u2", now: NOW });
    assert.equal((again.order_detail_view_v1 as { previous_view: string }).previous_view, "tabs");
  });

  it("treats a malformed stored value as the classic page", () => {
    const next = mergeOrderDetailViewPreference({
      currentPreferences: { ...OTHER, order_detail_view_v1: { version: 9, view: "x" } },
      view: "tabs",
      userId: "u1",
      now: NOW,
    });
    assert.equal((next.order_detail_view_v1 as { previous_view: string }).previous_view, "classic");
  });
});

describe("planOrderDetailViewUpdate (optimistic concurrency)", () => {
  it("refuses a stale revision without computing a write", () => {
    const planned = planOrderDetailViewUpdate({
      currentUpdatedAt: "2026-10-30T11:00:00.000Z",
      submittedRevision: "2026-10-30T10:00:00.000Z",
      currentPreferences: OTHER,
      view: "tabs",
      userId: "u1",
      now: NOW,
    });
    assert.deepEqual(planned, { ok: false, status: 409, error: "Order detail view changed" });
  });

  it("writes the merged preferences when the revision matches", () => {
    const planned = planOrderDetailViewUpdate({
      currentUpdatedAt: "2026-10-30T11:00:00.123456+00:00",
      submittedRevision: "2026-10-30T11:00:00.123Z",
      currentPreferences: OTHER,
      view: "tabs",
      userId: "u1",
      now: NOW,
    });
    assert.equal(planned.ok, true);
  });
});

describe("orderDetailViewState", () => {
  it("defaults to the classic page with no previous view", () => {
    const state = orderDetailViewState({}, "2026-10-30T11:00:00.000Z");
    assert.equal(state.view, "classic");
    assert.equal(state.previousView, null);
    assert.equal(state.revision, "2026-10-30T11:00:00.000Z");
  });
});

describe("permissions and copy", () => {
  it("owner and admin only", () => {
    assert.equal(canManageOrderDetailView("owner"), true);
    assert.equal(canManageOrderDetailView("admin"), true);
    assert.equal(canManageOrderDetailView("manager"), false);
    assert.equal(canManageOrderDetailView("staff"), false);
  });

  it("user-facing errors", () => {
    assert.equal(userFacingOrderDetailViewSaveError(200), null);
    assert.match(userFacingOrderDetailViewSaveError(409) ?? "", /Otra persona/);
    assert.match(userFacingOrderDetailViewSaveError(403) ?? "", /propietario o un administrador/);
  });
});

describe("route wiring", () => {
  const root = join(import.meta.dirname, "../..");
  const route = readFileSync(join(root, "app/api/settings/order-detail-view/route.ts"), "utf8");
  const page = readFileSync(join(root, "app/settings/order-detail-view/page.tsx"), "utf8");

  it("checks the role on GET and PATCH, server side", () => {
    assert.equal(route.split("canManageOrderDetailView(context.membership.role)").length - 1, 2);
    assert.match(page, /canManageOrderDetailView\(context\.membership\.role\)/);
    assert.match(page, /notFound\(\)/);
  });

  it("compare-and-set on updated_at, scoped to the tenant, never service_role", () => {
    assert.match(route, /\.eq\("tenant_id", context\.tenant\.id\)\s*\n\s*\.eq\("updated_at", current\.updated_at\)/);
    assert.match(route, /if \(!updated\) \{/);
    assert.doesNotMatch(route, /service_role|createAdminClient|SUPABASE_SERVICE/);
    assert.doesNotMatch(route, /\.from\("orders"\)/);
  });
});
