import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mapKioskOrderRow,
  mapKioskServiceRow,
  mapKioskTenantRow,
} from "./supabase-repository";

describe("Kiosk Supabase row mapping", () => {
  it("maps only valid active tenant and service rows", () => {
    assert.deepEqual(
      mapKioskTenantRow({
        id: "tenant-demo",
        name: "Demo",
        slug: "demo",
        active: true,
      }),
      { id: "tenant-demo", name: "Demo", slug: "demo", active: true }
    );
    assert.equal(mapKioskTenantRow({ id: "tenant-demo" }), null);

    assert.deepEqual(
      mapKioskServiceRow({
        id: "service-1",
        tenant_id: "tenant-demo",
        name: "Impresión",
        active: true,
      }),
      {
        id: "service-1",
        tenantId: "tenant-demo",
        name: "Impresión",
        active: true,
      }
    );
    assert.equal(mapKioskServiceRow({ id: "service-1" }), null);
  });

  it("reads only the Kiosk source from order metadata", () => {
    assert.deepEqual(
      mapKioskOrderRow({
        id: "order-1",
        tenant_id: "tenant-demo",
        reference: "DEMO-0001",
        metadata: {
          source: "kiosk",
          kiosk: { request_fingerprint: "fingerprint-1" },
          private: "not returned",
        },
      }),
      {
        id: "order-1",
        tenantId: "tenant-demo",
        reference: "DEMO-0001",
        source: "kiosk",
        fingerprint: "fingerprint-1",
      }
    );
    assert.equal(mapKioskOrderRow({ reference: "DEMO-0001" }), null);
  });
});
