import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canManageQuickOrderLayout,
  DEFAULT_QUICK_ORDER_LAYOUT,
  QUICK_ORDER_FIELD_LABELS,
  QUICK_ORDER_FIELDS,
  fieldsForPlacement,
  mergeQuickOrderLayoutPreference,
  parseQuickOrderLayoutPatch,
  resolveQuickOrderLayout,
} from "./quick-order-layout";

const CUSTOM_LAYOUT = {
  client: "more",
  service: "primary",
  description: "more",
  store: "primary",
  due_at: "more",
  priority: "primary",
  assigned_team_member: "more",
  entry_channel: "primary",
  title: "primary",
  order_context: "more",
  notes: "primary",
} as const;

describe("quick order layout preferences", () => {
  it("allows only owners to access configuration", () => {
    assert.equal(canManageQuickOrderLayout("owner"), true);
    assert.equal(canManageQuickOrderLayout("admin"), false);
    assert.equal(canManageQuickOrderLayout("manager"), false);
    assert.equal(canManageQuickOrderLayout("staff"), false);
    assert.equal(canManageQuickOrderLayout("viewer"), false);
    assert.equal(canManageQuickOrderLayout(null), false);
  });

  it("uses the exact legacy layout when the preference is absent or invalid", () => {
    const expected = {
      client: "primary",
      service: "primary",
      description: "primary",
      store: "primary",
      due_at: "primary",
      priority: "primary",
      assigned_team_member: "primary",
      entry_channel: "more",
      title: "more",
      order_context: "more",
      notes: "more",
    };

    assert.deepEqual(DEFAULT_QUICK_ORDER_LAYOUT, expected);
    assert.deepEqual(resolveQuickOrderLayout(undefined), expected);
    assert.deepEqual(resolveQuickOrderLayout({}), expected);
    assert.deepEqual(
      resolveQuickOrderLayout({
        quick_order_layout_v1: {
          version: 2,
          placements: CUSTOM_LAYOUT,
        },
      }),
      expected
    );
  });

  it("resolves a complete valid tenant layout without dropping fields", () => {
    const resolved = resolveQuickOrderLayout({
      quick_order_layout_v1: {
        version: 1,
        placements: CUSTOM_LAYOUT,
      },
    });

    assert.deepEqual(resolved, CUSTOM_LAYOUT);
    assert.deepEqual(
      [
        ...fieldsForPlacement(resolved, "primary"),
        ...fieldsForPlacement(resolved, "more"),
      ].sort(),
      [...QUICK_ORDER_FIELDS].sort()
    );
  });

  it("provides a settings label for every supported field", () => {
    assert.deepEqual(Object.keys(QUICK_ORDER_FIELD_LABELS), [
      ...QUICK_ORDER_FIELDS,
    ]);
  });

  it("preserves fixed field order inside both placements", () => {
    assert.deepEqual(fieldsForPlacement(CUSTOM_LAYOUT, "primary"), [
      "service",
      "store",
      "priority",
      "entry_channel",
      "title",
      "notes",
    ]);
    assert.deepEqual(fieldsForPlacement(CUSTOM_LAYOUT, "more"), [
      "client",
      "description",
      "due_at",
      "assigned_team_member",
      "order_context",
    ]);
  });

  it("parses only a complete exact PATCH body and revision", () => {
    assert.deepEqual(
      parseQuickOrderLayoutPatch({
        layout: CUSTOM_LAYOUT,
        revision: "2026-09-16T12:00:00.000Z",
      }),
      {
        ok: true,
        layout: CUSTOM_LAYOUT,
        revision: "2026-09-16T12:00:00.000Z",
      }
    );

    for (const invalid of [
      null,
      {},
      { layout: CUSTOM_LAYOUT },
      { layout: { ...CUSTOM_LAYOUT, client: "hidden" }, revision: "rev" },
      {
        layout: { ...CUSTOM_LAYOUT, unexpected: "more" },
        revision: "rev",
      },
      {
        layout: Object.fromEntries(
          Object.entries(CUSTOM_LAYOUT).filter(([key]) => key !== "notes")
        ),
        revision: "rev",
      },
      { layout: CUSTOM_LAYOUT, revision: "rev", tenant_id: "tenant-a" },
    ]) {
      assert.deepEqual(parseQuickOrderLayoutPatch(invalid), { ok: false });
    }
  });

  it("merges the versioned preference without replacing neighboring settings", () => {
    assert.deepEqual(
      mergeQuickOrderLayoutPreference(
        {
          default_view: "dashboard",
          week_starts_on: "monday",
          seed: "commercial-v1",
        },
        CUSTOM_LAYOUT
      ),
      {
        default_view: "dashboard",
        week_starts_on: "monday",
        seed: "commercial-v1",
        quick_order_layout_v1: {
          version: 1,
          placements: CUSTOM_LAYOUT,
        },
      }
    );
  });
});
