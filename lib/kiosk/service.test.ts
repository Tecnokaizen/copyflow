import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { KioskOrderInput } from "./payload";
import {
  KioskServiceError,
  getKioskBootstrap,
  kioskInputFingerprint,
  submitKioskOrder,
  type KioskRepository,
  type KioskOrderInsert,
} from "./service";

const DEMO = { id: "tenant-demo", name: "Gestcopy Demo", slug: "demo", active: true };
const SUR4 = { id: "tenant-sur4", name: "SUR4", slug: "sur4", active: true };
const SERVICE_DEMO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVICE_SUR4 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SUBMISSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function input(overrides: Partial<KioskOrderInput> = {}): KioskOrderInput {
  return {
    submissionId: SUBMISSION,
    contact: {
      name: "Ana Ruiz",
      email: "ana@example.com",
      phone: "600 123 123",
    },
    serviceId: SERVICE_DEMO,
    description: "200 tarjetas a color",
    dueAt: "2026-09-20T10:30:00.000Z",
    observations: "Papel mate",
    ...overrides,
  };
}

function repository(overrides: Partial<KioskRepository> = {}) {
  const inserts: KioskOrderInsert[] = [];
  const repo: KioskRepository = {
    findTenantBySlug: async (slug) =>
      slug === "demo" ? DEMO : slug === "sur4" ? SUR4 : null,
    listActiveServices: async (tenantId) =>
      tenantId === DEMO.id
        ? [{ id: SERVICE_DEMO, name: "Impresión", tenantId: DEMO.id, active: true }]
        : [{ id: SERVICE_SUR4, name: "Encuadernación", tenantId: SUR4.id, active: true }],
    findActiveService: async (tenantId, serviceId) => {
      const all = [
        { id: SERVICE_DEMO, name: "Impresión", tenantId: DEMO.id, active: true },
        { id: SERVICE_SUR4, name: "Encuadernación", tenantId: SUR4.id, active: true },
      ];
      return (
        all.find(
          (service) =>
            service.tenantId === tenantId &&
            service.id === serviceId &&
            service.active
        ) ?? null
      );
    },
    listInitialStatuses: async () => [{ id: "status-initial" }],
    listKioskChannels: async () => [{ id: "channel-kiosk" }],
    findOrderById: async () => null,
    insertOrder: async (order) => {
      inserts.push(order);
      return { reference: "DEMO-0042" };
    },
    ...overrides,
  };
  return { repo, inserts };
}

describe("getKioskBootstrap", () => {
  it("isolates DEMO and SUR4 and returns only the public DTO", async () => {
    const { repo } = repository();
    assert.deepEqual(await getKioskBootstrap("demo", repo), {
      tenant: { name: "Gestcopy Demo" },
      services: [{ id: SERVICE_DEMO, name: "Impresión" }],
    });
    assert.deepEqual(await getKioskBootstrap("sur4", repo), {
      tenant: { name: "SUR4" },
      services: [{ id: SERVICE_SUR4, name: "Encuadernación" }],
    });
  });

  it("fails closed for missing, unknown or inactive tenants", async () => {
    const { repo } = repository({
      findTenantBySlug: async (slug) =>
        slug === "inactive" ? { ...DEMO, slug, active: false } : null,
    });
    assert.equal(await getKioskBootstrap(null, repo), null);
    assert.equal(await getKioskBootstrap("unknown", repo), null);
    assert.equal(await getKioskBootstrap("inactive", repo), null);
  });

  it("stays unavailable without one initial status, Kiosk channel or service", async () => {
    for (const override of [
      { listInitialStatuses: async () => [] },
      { listKioskChannels: async () => [] },
      { listActiveServices: async () => [] },
    ]) {
      const { repo } = repository(override);
      assert.equal(await getKioskBootstrap("demo", repo), null);
    }
  });
});

describe("submitKioskOrder", () => {
  it("uses the tenant service, initial status and Kiosk channel", async () => {
    const { repo, inserts } = repository();
    const result = await submitKioskOrder("demo", input(), repo);
    assert.deepEqual(result, { ok: true, reference: "DEMO-0042", replay: false });
    assert.equal(inserts.length, 1);
    assert.deepEqual(inserts[0], {
      id: SUBMISSION,
      tenant_id: DEMO.id,
      title: "200 tarjetas a color",
      description: "200 tarjetas a color",
      service_id: SERVICE_DEMO,
      status_id: "status-initial",
      entry_channel_id: "channel-kiosk",
      priority: "normal",
      due_at: "2026-09-20T10:30:00.000Z",
      notes: [
        "Solicitud Kiosk",
        "Contacto: Ana Ruiz",
        "Email: ana@example.com",
        "Teléfono: 600 123 123",
        "Observaciones: Papel mate",
      ].join("\n"),
      metadata: {
        source: "kiosk",
        kiosk: {
          submission_id: SUBMISSION,
          request_fingerprint: kioskInputFingerprint(input()),
          contact: input().contact,
        },
      },
      created_by: null,
    });
  });

  it("rejects a service from another tenant", async () => {
    const { repo, inserts } = repository();
    await assert.rejects(
      () =>
        submitKioskOrder(
          "demo",
          input({ serviceId: SERVICE_SUR4 }),
          repo
        ),
      (error: unknown) =>
        error instanceof KioskServiceError &&
        error.code === "invalid_configuration" &&
        error.status === 400
    );
    assert.equal(inserts.length, 0);
  });

  it("requires exactly one initial status and one active Kiosk channel", async () => {
    for (const override of [
      { listInitialStatuses: async () => [] },
      {
        listInitialStatuses: async () => [
          { id: "one" },
          { id: "two" },
        ],
      },
      { listKioskChannels: async () => [] },
    ]) {
      const { repo, inserts } = repository(override);
      await assert.rejects(
        () => submitKioskOrder("demo", input(), repo),
        (error: unknown) =>
          error instanceof KioskServiceError &&
          error.code === "invalid_configuration" &&
          error.status === 503
      );
      assert.equal(inserts.length, 0);
    }
  });

  it("replays the same Kiosk order without a second insert", async () => {
    const { repo, inserts } = repository({
      findOrderById: async () => ({
        id: SUBMISSION,
        tenantId: DEMO.id,
        source: "kiosk",
        reference: "DEMO-0041",
        fingerprint: kioskInputFingerprint(input()),
      }),
    });
    assert.deepEqual(await submitKioskOrder("demo", input(), repo), {
      ok: true,
      reference: "DEMO-0041",
      replay: true,
    });
    assert.equal(inserts.length, 0);
  });

  it("replays after a concurrent duplicate insert wins the race", async () => {
    let lookups = 0;
    const { repo } = repository({
      findOrderById: async () => {
        lookups += 1;
        return lookups === 1
          ? null
          : {
              id: SUBMISSION,
              tenantId: DEMO.id,
              source: "kiosk",
              reference: "DEMO-0043",
              fingerprint: kioskInputFingerprint(input()),
            };
      },
      insertOrder: async () => {
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      },
    });
    assert.deepEqual(await submitKioskOrder("demo", input(), repo), {
      ok: true,
      reference: "DEMO-0043",
      replay: true,
    });
    assert.equal(lookups, 2);
  });

  it("rejects changed payload under an existing submission id", async () => {
    const { repo } = repository({
      findOrderById: async () => ({
        id: SUBMISSION,
        tenantId: DEMO.id,
        source: "kiosk",
        reference: "DEMO-0041",
        fingerprint: kioskInputFingerprint(input()),
      }),
    });
    await assert.rejects(
      () =>
        submitKioskOrder(
          "demo",
          input({ description: "Un pedido diferente" }),
          repo
        ),
      (error: unknown) =>
        error instanceof KioskServiceError &&
        error.code === "could_not_create" &&
        error.status === 409
    );
  });

  it("does not reveal an id collision from SUR4", async () => {
    const { repo, inserts } = repository({
      findOrderById: async () => ({
        id: SUBMISSION,
        tenantId: SUR4.id,
        source: "kiosk",
        reference: "SUR4-0001",
        fingerprint: kioskInputFingerprint(input()),
      }),
    });
    await assert.rejects(
      () => submitKioskOrder("demo", input(), repo),
      (error: unknown) =>
        error instanceof KioskServiceError &&
        error.code === "could_not_create" &&
        error.status === 409
    );
    assert.equal(inserts.length, 0);
  });

  it("performs one write so failures cannot leave partial records", async () => {
    let writes = 0;
    const { repo } = repository({
      insertOrder: async () => {
        writes += 1;
        throw new Error("database unavailable");
      },
    });
    await assert.rejects(
      () => submitKioskOrder("demo", input(), repo),
      /database unavailable/
    );
    assert.equal(writes, 1);
  });
});
