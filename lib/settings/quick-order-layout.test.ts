import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canManageQuickOrderLayout,
  DEFAULT_QUICK_ORDER_LAYOUT,
  QUICK_ORDER_FIELD_LABELS,
  QUICK_ORDER_FIELDS,
  fieldsForPlacement,
  layoutFromCheckedFields,
  layoutsEqual,
  layoutsMatch,
  mergeQuickOrderLayoutPreference,
  parseQuickOrderLayoutPatch,
  placementFromChecked,
  planQuickOrderLayoutUpdate,
  resolveQuickOrderLayout,
  revisionsMatch,
  sameSettingsRevision,
  serializeSettingsRevision,
  toggleQuickOrderField,
  userFacingQuickOrderLayoutSaveError,
} from "./quick-order-layout";

const CUSTOM_LAYOUT = {
  file_status: "more",
  files: "more",
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
      file_status: "more",
      files: "more",
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
    assert.deepEqual(
      QUICK_ORDER_FIELDS.map((field) => QUICK_ORDER_FIELD_LABELS[field]),
      [
        "Cliente",
        "Servicio",
        "Descripción",
        "Tienda",
        "Entrega prevista",
        "Prioridad",
        "Responsable",
        "Canal de entrada",
        "Nombre del pedido",
        "Contexto",
        "Notas internas",
        "Estado de archivos",
        "Archivos adjuntos",
      ]
    );
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
      "file_status",
      "files",
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
      { layout: { ...CUSTOM_LAYOUT, client: "invalid" }, revision: "rev" },
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

  it("toggles checked fields to Principal and the rest to Más opciones", () => {
    const next = toggleQuickOrderField(
      DEFAULT_QUICK_ORDER_LAYOUT,
      "notes",
      true
    );
    const unchecked = toggleQuickOrderField(next, "client", false);

    assert.equal(unchecked.notes, "primary");
    assert.equal(unchecked.client, "more");
    assert.equal(layoutsEqual(DEFAULT_QUICK_ORDER_LAYOUT, next), false);
    assert.equal(
      layoutsEqual(DEFAULT_QUICK_ORDER_LAYOUT, DEFAULT_QUICK_ORDER_LAYOUT),
      true
    );
  });

  it("treats equivalent timestamps as the same settings revision", () => {
    assert.equal(
      sameSettingsRevision(
        "2026-09-16T12:00:00.123456+00:00",
        "2026-09-16T12:00:00.123Z"
      ),
      true
    );
    assert.equal(
      sameSettingsRevision(
        "2026-09-16T12:00:00.123456+00",
        "2026-09-16T12:00:00.123Z"
      ),
      true
    );
    assert.equal(
      sameSettingsRevision(
        "2026-09-16T12:00:00.000Z",
        "2026-09-16T12:00:01.000Z"
      ),
      false
    );
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

  it("maps a checked checkbox to Principal and unchecked to Más opciones", () => {
    assert.equal(placementFromChecked(true), "primary");
    assert.equal(placementFromChecked(false), "more");
    assert.deepEqual(
      layoutFromCheckedFields([
        "client",
        "service",
        "description",
        "store",
        "due_at",
        "priority",
        "assigned_team_member",
      ]),
      DEFAULT_QUICK_ORDER_LAYOUT
    );
    assert.deepEqual(
      layoutFromCheckedFields([
        "service",
        "entry_channel",
        "title",
        "notes",
      ]),
      {
        client: "more",
        service: "primary",
        description: "more",
        store: "more",
        due_at: "more",
        priority: "more",
        assigned_team_member: "more",
        entry_channel: "primary",
        title: "primary",
        order_context: "more",
        notes: "primary",
        file_status: "more",
        files: "more",
      }
    );
    assert.ok(
      Object.values(layoutFromCheckedFields(["client"])).every(
        (placement) => placement === "primary" || placement === "more"
      )
    );
  });

  it("treats equivalent timestamp revisions as a match despite ISO format drift", () => {
    const fromPostgres = "2026-09-16T15:57:56.123456+00:00";
    const fromJsonDate = new Date(fromPostgres).toISOString();
    const fromSpaceOffset = "2026-09-16 15:57:56.123456+00";
    const fromShortOffset = "2026-09-16T15:57:56.123456+00";

    assert.notEqual(fromPostgres, fromJsonDate);
    assert.equal(
      serializeSettingsRevision(fromPostgres),
      "2026-09-16T15:57:56.123Z"
    );
    assert.equal(serializeSettingsRevision(fromShortOffset), fromJsonDate);
    assert.equal(revisionsMatch(fromPostgres, fromPostgres), true);
    assert.equal(revisionsMatch(fromPostgres, fromJsonDate), true);
    assert.equal(revisionsMatch(fromPostgres, fromSpaceOffset), true);
    assert.equal(revisionsMatch(fromPostgres, fromShortOffset), true);
    assert.equal(
      revisionsMatch(fromPostgres, "2026-09-16T15:57:57.123456+00:00"),
      false
    );
    assert.equal(revisionsMatch(fromPostgres, ""), false);
    assert.equal(revisionsMatch(null, fromPostgres), false);
  });

  it("plans a PATCH that persists without filtering on updated_at text", () => {
    const currentUpdatedAt = "2026-09-16T15:57:56.123456+00:00";
    const submittedRevision = new Date(currentUpdatedAt).toISOString();
    const now = new Date("2026-09-16T16:02:00.000Z");

    const stale = planQuickOrderLayoutUpdate({
      currentUpdatedAt,
      submittedRevision: "2026-09-16T15:50:00.000Z",
      currentPreferences: { seed: "commercial-v1" },
      layout: CUSTOM_LAYOUT,
      now,
    });
    assert.deepEqual(stale, {
      ok: false,
      status: 409,
      error: "Quick order settings changed",
    });

    const planned = planQuickOrderLayoutUpdate({
      currentUpdatedAt,
      submittedRevision,
      currentPreferences: { seed: "commercial-v1" },
      layout: CUSTOM_LAYOUT,
      now,
    });

    assert.equal(planned.ok, true);
    if (!planned.ok) {
      throw new Error("expected a persistable update plan");
    }

    assert.deepEqual(planned.filters, { tenant_id: true });
    assert.equal("updated_at" in planned.filters, false);
    assert.deepEqual(planned.values, {
      preferences: {
        seed: "commercial-v1",
        quick_order_layout_v1: {
          version: 1,
          placements: CUSTOM_LAYOUT,
        },
      },
      updated_at: "2026-09-16T16:02:00.000Z",
    });
    assert.equal(
      layoutsMatch(
        resolveQuickOrderLayout(planned.values.preferences),
        CUSTOM_LAYOUT
      ),
      true
    );

    const encoded = new URLSearchParams({
      updated_at: `eq.${currentUpdatedAt}`,
    }).toString();
    assert.match(encoded, /%2B00%3A00/);
  });

  it("keeps save errors user-facing and never silent", () => {
    assert.equal(
      userFacingQuickOrderLayoutSaveError(409),
      "La configuración cambió en otra sesión. Se ha cargado la versión más reciente."
    );
    assert.equal(
      userFacingQuickOrderLayoutSaveError(403),
      "No tienes permiso para guardar esta configuración."
    );
    assert.equal(
      userFacingQuickOrderLayoutSaveError(500),
      "No se pudo guardar la configuración. Inténtalo de nuevo."
    );
    assert.equal(userFacingQuickOrderLayoutSaveError(200), null);
  });
});
