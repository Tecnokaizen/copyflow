import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultActiveStoreId,
  evaluateStoreAssignment,
  parseStoreListFilter,
  storeListFilterParam,
} from "./scope";
import { canWriteStores } from "@/lib/auth/membership-roles";
import { parseOptionalStoreId } from "./payload";

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STORE_A = "11111111-1111-4111-8111-111111111111";
const STORE_B = "22222222-2222-4222-8222-222222222222";

describe("evaluateStoreAssignment", () => {
  it("allows an order without a store", () => {
    const result = evaluateStoreAssignment({
      sessionTenantId: TENANT_A,
      storeId: null,
      store: null,
    });

    assert.deepEqual(result, { ok: true });
  });

  it("allows a store that belongs to the session tenant", () => {
    const result = evaluateStoreAssignment({
      sessionTenantId: TENANT_A,
      storeId: STORE_A,
      store: { id: STORE_A, tenant_id: TENANT_A, active: true },
    });

    assert.deepEqual(result, { ok: true });
  });

  it("rejects a store from another tenant", () => {
    const result = evaluateStoreAssignment({
      sessionTenantId: TENANT_A,
      storeId: STORE_B,
      store: { id: STORE_B, tenant_id: TENANT_B, active: true },
    });

    assert.deepEqual(result, { ok: false, code: "tenant_mismatch" });
  });

  it("rejects a missing store as if it were foreign", () => {
    const result = evaluateStoreAssignment({
      sessionTenantId: TENANT_A,
      storeId: STORE_B,
      store: null,
    });

    assert.deepEqual(result, { ok: false, code: "missing" });
  });

  it("rejects an inactive store when assigning to an order", () => {
    const result = evaluateStoreAssignment({
      sessionTenantId: TENANT_A,
      storeId: STORE_A,
      store: { id: STORE_A, tenant_id: TENANT_A, active: false },
    });

    assert.deepEqual(result, { ok: false, code: "inactive" });
  });

  it("allows an inactive store when filtering history", () => {
    const result = evaluateStoreAssignment({
      sessionTenantId: TENANT_A,
      storeId: STORE_A,
      store: { id: STORE_A, tenant_id: TENANT_A, active: false },
      requireActive: false,
    });

    assert.deepEqual(result, { ok: true });
  });
});

describe("parseStoreListFilter", () => {
  it("treats empty as all stores", () => {
    assert.deepEqual(parseStoreListFilter(null), { kind: "all" });
    assert.deepEqual(parseStoreListFilter(""), { kind: "all" });
    assert.deepEqual(parseStoreListFilter("all"), { kind: "all" });
  });

  it("parses Sin tienda and a concrete store", () => {
    assert.deepEqual(parseStoreListFilter("none"), { kind: "none" });
    assert.deepEqual(parseStoreListFilter(STORE_A), {
      kind: "id",
      id: STORE_A,
    });
    assert.equal(storeListFilterParam({ kind: "none" }), "none");
    assert.equal(storeListFilterParam({ kind: "id", id: STORE_A }), STORE_A);
    assert.equal(storeListFilterParam({ kind: "all" }), null);
  });

  it("rejects a non-uuid store filter", () => {
    assert.deepEqual(parseStoreListFilter("sur4"), { kind: "invalid" });
    assert.deepEqual(parseStoreListFilter("Principal"), { kind: "invalid" });
  });
});

describe("defaultActiveStoreId", () => {
  it("defaults when the form loads exactly one active store", () => {
    assert.equal(
      defaultActiveStoreId([{ id: STORE_A, active: true }]),
      STORE_A
    );
  });

  it("does not pick a store when the tenant has several", () => {
    assert.equal(
      defaultActiveStoreId([
        { id: STORE_A, active: true },
        { id: STORE_B, active: true },
      ]),
      null
    );
  });

  it("ignores inactive stores when choosing a default", () => {
    assert.equal(
      defaultActiveStoreId([
        { id: STORE_A, active: false },
        { id: STORE_B, active: true },
      ]),
      STORE_B
    );
  });
});

describe("parseOptionalStoreId", () => {
  it("accepts null, empty and a uuid", () => {
    assert.deepEqual(parseOptionalStoreId(null), { ok: true, storeId: null });
    assert.deepEqual(parseOptionalStoreId(""), { ok: true, storeId: null });
    assert.deepEqual(parseOptionalStoreId(STORE_A), {
      ok: true,
      storeId: STORE_A,
    });
  });

  it("rejects a store id that is not a uuid", () => {
    assert.equal(parseOptionalStoreId("tienda-1").ok, false);
    assert.equal(parseOptionalStoreId(1).ok, false);
  });
});

describe("canWriteStores", () => {
  it("allows owner, admin and manager, not staff or viewer", () => {
    assert.equal(canWriteStores("owner"), true);
    assert.equal(canWriteStores("admin"), true);
    assert.equal(canWriteStores("manager"), true);
    assert.equal(canWriteStores("staff"), false);
    assert.equal(canWriteStores("viewer"), false);
    assert.equal(canWriteStores(null), false);
  });
});
