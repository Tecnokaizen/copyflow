import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseStoreCreatePayload, parseStorePatchPayload } from "./payload";
import { mapStore } from "./types";

describe("parseStoreCreatePayload", () => {
  it("creates a store with a trimmed name", () => {
    assert.deepEqual(parseStoreCreatePayload({ name: "  Principal  " }), {
      ok: true,
      data: { name: "Principal", code: null, active: true },
    });
  });

  it("accepts code and active", () => {
    assert.deepEqual(
      parseStoreCreatePayload({
        name: "Sur 4 Colores 1",
        code: "s1",
        active: false,
      }),
      {
        ok: true,
        data: { name: "Sur 4 Colores 1", code: "s1", active: false },
      }
    );
  });

  it("rejects a blank name or tenant_id as the name", () => {
    assert.equal(parseStoreCreatePayload({}).ok, false);
    assert.equal(parseStoreCreatePayload({ name: "   " }).ok, false);
  });
});

describe("parseStorePatchPayload", () => {
  it("accepts a partial update including deactivation", () => {
    assert.deepEqual(parseStorePatchPayload({ active: false }), {
      ok: true,
      data: { active: false },
    });
    assert.deepEqual(parseStorePatchPayload({ name: "Tienda Norte" }), {
      ok: true,
      data: { name: "Tienda Norte" },
    });
  });

  it("rejects an empty patch", () => {
    assert.equal(parseStorePatchPayload({}).ok, false);
    assert.equal(parseStorePatchPayload({ name: " " }).ok, false);
  });
});

describe("mapStore", () => {
  it("maps a tenant store row", () => {
    assert.deepEqual(
      mapStore({
        id: "11111111-1111-4111-8111-111111111111",
        name: "Principal",
        code: null,
        active: true,
        tenant_id: "should-not-leak-into-mapper-as-required",
      }),
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Principal",
        code: null,
        active: true,
      }
    );
  });
});
