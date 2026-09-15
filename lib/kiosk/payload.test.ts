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
      description: "200 tarjetas a color",
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
