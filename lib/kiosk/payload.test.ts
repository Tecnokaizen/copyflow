import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildKioskOrderNotes,
  parseKioskOrderPayload,
} from "./payload";

const SUBMISSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVICE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    submission_id: SUBMISSION_ID,
    contact: {
      name: " Ana Ruiz ",
      email: " ANA@example.com ",
      phone: " 600 123 123 ",
    },
    service_id: SERVICE_ID,
    description: " 200 tarjetas a color ",
    due_at: "2026-09-20T10:30:00.000Z",
    observations: " Papel mate ",
    ...overrides,
  };
}

describe("parseKioskOrderPayload", () => {
  it("normalizes the explicit public DTO", () => {
    const parsed = parseKioskOrderPayload(validPayload());
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.data, {
      submissionId: SUBMISSION_ID,
      contact: {
        name: "Ana Ruiz",
        email: "ana@example.com",
        phone: "600 123 123",
      },
      serviceId: SERVICE_ID,
      descriptionHtml: "<p>200 tarjetas a color</p>",
      descriptionPlain: "200 tarjetas a color",
      dueAt: "2026-09-20T10:30:00.000Z",
      observations: "Papel mate",
    });
  });

  it("requires a name and at least email or phone", () => {
    for (const contact of [
      { name: "", email: "a@example.com", phone: null },
      { name: "Ana", email: null, phone: null },
      { name: "Ana", email: "not-an-email", phone: null },
    ]) {
      assert.equal(
        parseKioskOrderPayload(validPayload({ contact })).ok,
        false
      );
    }
  });

  it("rejects invalid ids, empty description and invalid due date", () => {
    assert.equal(
      parseKioskOrderPayload(validPayload({ submission_id: "not-uuid" })).ok,
      false
    );
    assert.equal(
      parseKioskOrderPayload(validPayload({ service_id: "not-uuid" })).ok,
      false
    );
    assert.equal(
      parseKioskOrderPayload(validPayload({ description: " " })).ok,
      false
    );
    assert.equal(
      parseKioskOrderPayload(validPayload({ due_at: "tomorrow" })).ok,
      false
    );
  });

  it("rejects tenant authority and unknown top-level fields", () => {
    assert.equal(
      parseKioskOrderPayload(validPayload({ tenant_id: "foreign" })).ok,
      false
    );
    assert.equal(
      parseKioskOrderPayload(validPayload({ slug: "sur4" })).ok,
      false
    );
    assert.equal(
      parseKioskOrderPayload(validPayload({ assigned_team_member_id: SERVICE_ID })).ok,
      false
    );
  });

  it("enforces bounded public text fields", () => {
    assert.equal(
      parseKioskOrderPayload(
        validPayload({
          contact: { name: "x".repeat(121), email: "a@example.com" },
        })
      ).ok,
      false
    );
    assert.equal(
      parseKioskOrderPayload(validPayload({ description: "x".repeat(4001) }))
        .ok,
      false
    );
    assert.equal(
      parseKioskOrderPayload(validPayload({ observations: "x".repeat(2001) }))
        .ok,
      false
    );
  });

  it("stores canonical HTML and measures 4000 visible characters", () => {
    const plain = "x".repeat(4000);
    const wrapped = parseKioskOrderPayload(
      validPayload({ description: `<p><strong>${plain}</strong></p>` })
    );
    assert.equal(wrapped.ok, true);
    if (!wrapped.ok) return;
    assert.equal(wrapped.data.descriptionPlain, plain);
    assert.equal(wrapped.data.descriptionPlain.length, 4000);
    assert.equal(
      wrapped.data.descriptionHtml,
      `<p><strong>${plain}</strong></p>`
    );
    assert.equal(
      parseKioskOrderPayload(validPayload({ description: "x".repeat(4001) })).ok,
      false
    );
    assert.equal(
      parseKioskOrderPayload(
        validPayload({ description: `<p>${"y".repeat(4001)}</p>` })
      ).ok,
      false
    );
  });

  it("rejects absurd canonical HTML without shrinking normal formatting", () => {
    const href = `https://example.com/${"a".repeat(800)}`;
    const huge = Array.from(
      { length: 300 },
      () => `<p><a href="${href}">ok</a></p>`
    ).join("");
    assert.equal(huge.length > 200_000, true);
    assert.equal(
      parseKioskOrderPayload(validPayload({ description: huge })).ok,
      false
    );
  });

  it("keeps observations as plain text and strips dangerous description markup", () => {
    const attack = parseKioskOrderPayload(
      validPayload({
        description:
          '<p>Hola</p><script>alert(1)</script><img src=x onerror="alert(1)"><a href="javascript:alert(1)">x</a>',
        observations: "ver <detalle>",
      })
    );
    assert.equal(attack.ok, true);
    if (!attack.ok) return;
    assert.equal(attack.data.descriptionPlain, "Hola\nx");
    assert.equal(/<script\b|onerror\s*=|javascript:/i.test(attack.data.descriptionHtml), false);
    assert.equal(attack.data.observations, "ver <detalle>");
  });
});

describe("buildKioskOrderNotes", () => {
  it("keeps contact and observations visible to internal operators", () => {
    assert.equal(
      buildKioskOrderNotes({
        name: "Ana Ruiz",
        email: "ana@example.com",
        phone: null,
        observations: "Papel mate",
      }),
      [
        "Solicitud Kiosk",
        "Contacto: Ana Ruiz",
        "Email: ana@example.com",
        "Observaciones: Papel mate",
      ].join("\n")
    );
  });
});
