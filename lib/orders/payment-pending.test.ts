import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { paymentPendingStorageKey } from "./payment-pending";

const tenant = "11111111-1111-4111-8111-111111111111";
const otherTenant = "22222222-2222-4222-8222-222222222222";
const user = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherUser = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const order = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("pending payment confirmation scope", () => {
  it("isolates the same order by user and tenant", () => {
    const first = paymentPendingStorageKey(tenant, user, order);
    const switchedUser = paymentPendingStorageKey(tenant, otherUser, order);
    const switchedTenant = paymentPendingStorageKey(otherTenant, user, order);
    assert.equal(typeof first, "string");
    assert.notEqual(first, switchedUser);
    assert.notEqual(first, switchedTenant);
    assert.equal(first?.includes(user), true);
    assert.equal(first?.includes(tenant), true);
    assert.equal(first?.includes(order), true);
    assert.equal(first?.startsWith("gestcopy:payment:"), false);
  });

  it("refuses an incomplete identity", () => {
    assert.equal(paymentPendingStorageKey("", user, order), null);
    assert.equal(paymentPendingStorageKey(tenant, "", order), null);
    assert.equal(paymentPendingStorageKey(tenant, user, ""), null);
  });
});
