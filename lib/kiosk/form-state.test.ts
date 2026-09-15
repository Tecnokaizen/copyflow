import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAdvanceKioskStep,
  createKioskFormState,
  kioskSubmissionPayload,
  markKioskSubmissionFailed,
} from "./form-state";

describe("Kiosk mobile form state", () => {
  it("requires contact before order and order before confirmation", () => {
    const empty = createKioskFormState("submission-1");
    assert.equal(canAdvanceKioskStep("contact", empty), false);

    const contact = {
      ...empty,
      name: "Ana",
      email: "ana@example.com",
    };
    assert.equal(canAdvanceKioskStep("contact", contact), true);
    assert.equal(canAdvanceKioskStep("order", contact), false);

    const order = {
      ...contact,
      serviceId: "service-1",
      description: "Tarjetas",
    };
    assert.equal(canAdvanceKioskStep("order", order), true);
  });

  it("keeps fields and submission id after a retryable error", () => {
    const state = {
      ...createKioskFormState("submission-1"),
      name: "Ana",
      phone: "600123123",
      serviceId: "service-1",
      description: "Tarjetas",
    };
    assert.deepEqual(
      markKioskSubmissionFailed(state, "No se pudo enviar"),
      {
        ...state,
        submitting: false,
        error: "No se pudo enviar",
      }
    );
  });

  it("builds the explicit public DTO without tenant fields", () => {
    const state = {
      ...createKioskFormState("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"),
      name: "Ana",
      email: "ana@example.com",
      phone: "",
      serviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      description: "Tarjetas",
      dueAt: "2026-09-20T10:30",
      observations: "Mate",
    };
    const payload = kioskSubmissionPayload(state);
    assert.deepEqual(payload, {
      submission_id: state.submissionId,
      contact: {
        name: "Ana",
        email: "ana@example.com",
        phone: null,
      },
      service_id: state.serviceId,
      description: "Tarjetas",
      due_at: "2026-09-20T10:30:00.000Z",
      observations: "Mate",
    });
    assert.equal("tenant_id" in payload, false);
    assert.equal("slug" in payload, false);
  });
});
