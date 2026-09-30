import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatActivityText } from "./format";
import type { ActivityItem } from "./types";

function item(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: "act-1",
    action: "order.created",
    entity_type: "order",
    entity_id: "order-1",
    user_id: null,
    team_member_id: null,
    previous_values: null,
    new_values: null,
    metadata: {},
    created_at: "2026-09-17T12:00:00.000Z",
    actor: { id: "user-1", name: "Ana" },
    ...overrides,
  };
}

describe("formatActivityText order.archived", () => {
  it("M. renders Pedido archivado for order detail timeline", () => {
    assert.equal(
      formatActivityText(
        item({
          action: "order.archived",
          metadata: {
            reference: "PED-42",
            status_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          },
        })
      ),
      "Pedido archivado"
    );
  });

  it("keeps created and status_changed formatting", () => {
    assert.equal(formatActivityText(item({ action: "order.created" })), "Pedido creado");
    assert.equal(
      formatActivityText(
        item({
          action: "order.status_changed",
          previous_values: { status_name: "En curso" },
          new_values: { status_name: "Listo" },
        })
      ),
      "En curso → Listo"
    );
  });
});

describe("formatActivityText order.content_changed rich text", () => {
  it("A. flattens description HTML to human text", () => {
    const text = formatActivityText(
      item({
        action: "order.content_changed",
        metadata: { field: "description" },
        previous_values: { value: "<p>Anterior</p>" },
        new_values: { value: "<p>Texto <strong>negrita</strong></p>" },
      })
    );

    assert.equal(text.includes("<p>"), false);
    assert.equal(text.includes("<strong>"), false);
    assert.equal(text, "Descripción: Anterior → Texto negrita");
  });

  it("B. flattens notes HTML to human text", () => {
    const text = formatActivityText(
      item({
        action: "order.content_changed",
        metadata: { field: "notes" },
        previous_values: { value: "<p>Nota <em>interna</em></p>" },
        new_values: { value: "<p>Nota <em>interna</em></p>" },
      })
    );

    assert.equal(text.includes("<p>"), false);
    assert.equal(text.includes("<em>"), false);
    assert.equal(text, "Notas: Nota interna → Nota interna");
  });

  it("C. keeps angle brackets in a plain title", () => {
    const text = formatActivityText(
      item({
        action: "order.content_changed",
        metadata: { field: "title" },
        previous_values: { value: "Cartelería — pedido 200" },
        new_values: { value: "Carteles <VIP>" },
      })
    );

    assert.equal(text, "Título: Cartelería — pedido 200 → Carteles <VIP>");
  });

  it("D. truncates description after converting HTML to plain text", () => {
    const visible = "A".repeat(100);
    const text = formatActivityText(
      item({
        action: "order.content_changed",
        metadata: { field: "description" },
        previous_values: { value: "<p>Corta</p>" },
        new_values: { value: `<p><strong>${visible}</strong></p>` },
      })
    );
    const truncated = `${"A".repeat(77)}...`;

    assert.equal(text.includes("<p>"), false);
    assert.equal(text.includes("<strong>"), false);
    assert.equal(text, `Descripción: Corta → ${truncated}`);
    assert.equal(text.includes(visible), false);
  });

  it("E. keeps a legacy plain description", () => {
    const legacy = "Pedido antiguo sin HTML";
    const text = formatActivityText(
      item({
        action: "order.content_changed",
        metadata: { field: "description" },
        previous_values: { value: legacy },
        new_values: { value: legacy },
      })
    );

    assert.equal(text, `Descripción: ${legacy} → ${legacy}`);
  });
});

describe("formatActivityText order file events", () => {
  it("renders Archivo subido with optional original_name", () => {
    assert.equal(
      formatActivityText(item({ action: "order.file_uploaded" })),
      "Archivo subido",
    );
    assert.equal(
      formatActivityText(
        item({
          action: "order.file_uploaded",
          metadata: { original_name: "catalogo-final.pdf" },
        }),
      ),
      "Archivo subido: catalogo-final.pdf",
    );
  });

  it("renders Archivo eliminado with optional original_name", () => {
    assert.equal(
      formatActivityText(item({ action: "order.file_deleted" })),
      "Archivo eliminado",
    );
    assert.equal(
      formatActivityText(
        item({
          action: "order.file_deleted",
          metadata: { original_name: "  brief.docx  " },
        }),
      ),
      "Archivo eliminado: brief.docx",
    );
  });

  it("ignores non-string original_name without inventing fields", () => {
    assert.equal(
      formatActivityText(
        item({
          action: "order.file_uploaded",
          metadata: { original_name: 123 },
        }),
      ),
      "Archivo subido",
    );
  });
});
