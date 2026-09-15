import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KioskOrderInput } from "./payload";
import {
  KioskServiceError,
  getKioskBootstrap,
  kioskInputFingerprint,
  mapKioskBootstrapResult,
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
    const fingerprint = kioskInputFingerprint(INPUT);
    assert.match(fingerprint, /^[a-f0-9]{64}$/);
    assert.notEqual(
      fingerprint,
      kioskInputFingerprint({ ...INPUT, description: "Otro pedido" })
    );
  });
});

describe("signed Kiosk orchestration", () => {
  const capability = {
    tenantSlug: "demo",
    clientKey: "a".repeat(64),
    issuedAt: 1_789_000_000,
    signature: "b".repeat(64),
  };

  it("delegates bootstrap and submit only through the gateway", async () => {
    let submittedFingerprint = "";
    const gateway = {
      bootstrap: async () => ({
        status: "ready",
        tenant: { name: "DEMO" },
        services: [{ id: INPUT.serviceId, name: "Impresión" }],
      }),
      submit: async (
        receivedCapability: typeof capability,
        receivedInput: KioskOrderInput,
        fingerprint: string,
        title: string
      ) => {
        assert.deepEqual(receivedCapability, capability);
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
    assert.deepEqual(await submitKioskOrder(capability, INPUT, gateway), {
      ok: true,
      reference: "DEMO-0042",
      replay: false,
    });
    assert.equal(submittedFingerprint, kioskInputFingerprint(INPUT));
  });
});
