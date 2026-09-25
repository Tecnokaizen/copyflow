import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAdvanceKioskStep,
  createKioskFormState,
  kioskSubmissionPayload,
  markKioskSubmissionFailed,
} from "./form-state";

describe("Kiosk mobile form state", () => {
  it("requires a service before details, without requiring contact yet", () => {
    const empty = createKioskFormState("submission-1");
    assert.equal(canAdvanceKioskStep("service", empty), false);
    const selected = { ...empty, serviceId: "service-1" };
    assert.equal(canAdvanceKioskStep("service", selected), true);
    assert.equal(canAdvanceKioskStep("details", selected), false);
    assert.equal(canAdvanceKioskStep("contact", selected), false);
  });

  it("requires both a selected service and a nonblank description for details", () => {
    const empty = createKioskFormState("submission-1");
    assert.equal(
      canAdvanceKioskStep("details", { ...empty, description: "Tarjetas" }),
      false,
    );
    assert.equal(
      canAdvanceKioskStep("details", {
        ...empty,
        serviceId: "service-1",
        description: "  ",
      }),
      false,
    );
    assert.equal(
      canAdvanceKioskStep("details", {
        ...empty,
        serviceId: "service-1",
        description: "Tarjetas",
      }),
      true,
    );
  });

  it("still requires a name and at least one contact method", () => {
    const empty = createKioskFormState("submission-1");
    assert.equal(canAdvanceKioskStep("contact", empty), false);
    assert.equal(
      canAdvanceKioskStep("contact", { ...empty, name: "Ana" }),
      false,
    );
    assert.equal(
      canAdvanceKioskStep("contact", { ...empty, email: "ana@example.com" }),
      false,
    );
    assert.equal(
      canAdvanceKioskStep("contact", {
        ...empty,
        name: "  ",
        phone: "600123123",
      }),
      false,
    );
    assert.equal(
      canAdvanceKioskStep("contact", {
        ...empty,
        name: "Ana",
        phone: "  ",
        email: " ",
      }),
      false,
    );
    assert.equal(
      canAdvanceKioskStep("contact", {
        ...empty,
        name: "Ana",
        email: "ana@example.com",
      }),
      true,
    );
    assert.equal(
      canAdvanceKioskStep("contact", {
        ...empty,
        name: "Ana",
        phone: "600123123",
      }),
      true,
    );
  });

  it("uses a changed service while preserving the draft and submission ID", () => {
    const draft = {
      ...createKioskFormState("submission-1"),
      serviceId: "service-1",
      description: "Tarjetas",
      name: "Ana",
      phone: "600123123",
      observations: "Mate",
    };
    const changed = { ...draft, serviceId: "service-2" };
    assert.equal(canAdvanceKioskStep("service", changed), true);
    assert.equal(canAdvanceKioskStep("details", changed), true);
    assert.equal(canAdvanceKioskStep("contact", changed), true);
    assert.deepEqual(kioskSubmissionPayload(changed), {
      ...kioskSubmissionPayload(draft),
      service_id: "service-2",
    });
  });

  it("keeps fields and submission id after a retryable error", () => {
    const state = {
      ...createKioskFormState("submission-1"),
      name: "Ana",
      phone: "600123123",
      serviceId: "service-1",
      description: "Tarjetas",
    };
    assert.deepEqual(markKioskSubmissionFailed(state, "No se pudo enviar"), {
      ...state,
      submitting: false,
      error: "No se pudo enviar",
    });
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
      due_at: new Date("2026-09-20T10:30").toISOString(),
      observations: "Mate",
    });
    assert.equal("tenant_id" in payload, false);
    assert.equal("slug" in payload, false);
  });
});
