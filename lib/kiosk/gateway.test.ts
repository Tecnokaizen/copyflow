import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KioskOrderInput } from "./payload";
import type { KioskCapability } from "./trusted-request";
import {
  KioskServiceError,
  admitKioskRequest,
  getKioskBootstrap,
  kioskCanonicalPayload,
  kioskInputFingerprint,
  mapKioskBootstrapResult,
  mapKioskAdmissionResult,
  mapKioskSubmitResult,
  submitKioskOrder,
} from "./service";

const INPUT: KioskOrderInput = {
  submissionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  contact: {
    name: "Ana",
    email: "ana@example.com",
    phone: null,
  },
  serviceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  description: "Tarjetas",
  dueAt: null,
  observations: "Mate",
};

describe("Kiosk database result mapping", () => {
  it("maps a one-shot admission permit and rate rejection", () => {
    assert.equal(
      mapKioskAdmissionResult({
        status: "admitted",
        permit: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    );
    assert.throws(
      () => mapKioskAdmissionResult({ status: "rate_limited" }),
      (error: unknown) =>
        error instanceof KioskServiceError &&
        error.code === "rate_limited"
    );
  });

  it("returns a minimal bootstrap DTO and drops private fields", () => {
    assert.deepEqual(
      mapKioskBootstrapResult({
        status: "ready",
        tenant: {
          name: "DEMO",
          id: "private",
          slug: "private",
        },
        services: [
          {
            id: INPUT.serviceId,
            name: "Impresión",
            metadata: { private: true },
          },
        ],
      }),
      {
        tenant: { name: "DEMO" },
        services: [{ id: INPUT.serviceId, name: "Impresión" }],
      }
    );
  });

  it("fails closed for unavailable or malformed bootstrap results", () => {
    assert.equal(mapKioskBootstrapResult({ status: "unavailable" }), null);
    assert.equal(
      mapKioskBootstrapResult({
        status: "ready",
        tenant: { name: "DEMO" },
        services: [{ id: "not-uuid", name: "Private" }],
      }),
      null
    );
  });

  it("maps create and replay without exposing order ids", () => {
    assert.deepEqual(
      mapKioskSubmitResult({
        status: "created",
        reference: "DEMO-0042",
        order_id: "private",
      }),
      { ok: true, reference: "DEMO-0042", replay: false }
    );
    assert.deepEqual(
      mapKioskSubmitResult({
        status: "replay",
        reference: "DEMO-0042",
      }),
      { ok: true, reference: "DEMO-0042", replay: true }
    );
  });

  it("maps safe database failure codes", () => {
    assert.throws(
      () => mapKioskSubmitResult({ status: "invalid_service" }),
      (error: unknown) =>
        error instanceof KioskServiceError &&
        error.code === "invalid_configuration" &&
        error.status === 400
    );
    assert.throws(
      () => mapKioskSubmitResult({ status: "rate_limited" }),
      (error: unknown) =>
        error instanceof KioskServiceError &&
        error.code === "rate_limited" &&
        error.status === 429
    );
  });
});

describe("kioskInputFingerprint", () => {
  it("binds normalized request content", () => {
    assert.equal(
      kioskCanonicalPayload(INPUT),
      "kiosk-payload-v1|8:Tarjetas|36:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb|3:Ana|15:ana@example.com|0:|8:Tarjetas|0:|4:Mate"
    );
    const fingerprint = kioskInputFingerprint(INPUT);
    assert.equal(
      fingerprint,
      "f5822604bd71e597cb043d7bc8fa41548e0cd9f9e1c4faf66feaa74f4b75f58f"
    );
    assert.notEqual(
      fingerprint,
      kioskInputFingerprint({ ...INPUT, description: "Otro pedido" })
    );
    for (const altered of [
      { ...INPUT, serviceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { ...INPUT, contact: { ...INPUT.contact, name: "Luis" } },
      { ...INPUT, contact: { ...INPUT.contact, email: "otro@example.com" } },
      { ...INPUT, contact: { ...INPUT.contact, phone: "600123123" } },
      { ...INPUT, dueAt: "2026-09-20T10:30:00.000Z" },
      { ...INPUT, observations: "Brillo" },
    ]) {
      assert.notEqual(fingerprint, kioskInputFingerprint(altered));
    }
  });
});

describe("signed Kiosk orchestration", () => {
  const capability = {
    tenantSlug: "demo",
    clientKey: "a".repeat(64),
    issuedAt: 1_789_000_000,
    purpose: "bootstrap" as const,
    binding: "bootstrap",
    signature: "b".repeat(64),
  };

  it("delegates bootstrap and submit only through the gateway", async () => {
    let submittedFingerprint = "";
    const permitId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const fingerprint = kioskInputFingerprint(INPUT);
    const submitCapability: KioskCapability = {
      ...capability,
      purpose: "submit",
      binding: `${permitId}|${INPUT.submissionId}|${fingerprint}`,
    };
    const gateway = {
      bootstrap: async () => ({
        status: "ready",
        tenant: { name: "DEMO" },
        services: [{ id: INPUT.serviceId, name: "Impresión" }],
      }),
      admit: async () => ({
        status: "admitted",
        permit: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      }),
      submit: async (
        receivedCapability: KioskCapability,
        receivedPermitId: string,
        receivedInput: KioskOrderInput,
        fingerprint: string,
        title: string
      ) => {
        assert.deepEqual(receivedCapability, submitCapability);
        assert.equal(
          receivedPermitId,
          permitId
        );
        assert.deepEqual(receivedInput, INPUT);
        submittedFingerprint = fingerprint;
        assert.equal(title, "Tarjetas");
        return { status: "created", reference: "DEMO-0042" };
      },
    };
    assert.deepEqual(await getKioskBootstrap(capability, gateway), {
      tenant: { name: "DEMO" },
      services: [{ id: INPUT.serviceId, name: "Impresión" }],
    });
    assert.equal(
      await admitKioskRequest(
        { ...capability, purpose: "admit", binding: "request" },
        gateway
      ),
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    );
    assert.deepEqual(
      await submitKioskOrder(
        submitCapability,
        permitId,
        INPUT,
        gateway
      ),
      {
      ok: true,
      reference: "DEMO-0042",
      replay: false,
      }
    );
    assert.equal(submittedFingerprint, kioskInputFingerprint(INPUT));
  });
});
