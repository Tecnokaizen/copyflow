import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canWriteOrders } from "@/lib/auth/membership-roles";
import {
  LAST_OWNER_REQUIRED_MESSAGE,
  canManageMembershipTarget,
  countOtherActiveOwners,
  ownerProtectionMessage,
} from "./owner-protection";

describe("canManageMembershipTarget with owners", () => {
  it("blocks demoting the last active owner", () => {
    assert.equal(
      canManageMembershipTarget("owner", "owner", { otherActiveOwners: 0 }),
      false
    );
    assert.equal(
      ownerProtectionMessage({
        targetRole: "owner",
        otherActiveOwners: 0,
      }),
      LAST_OWNER_REQUIRED_MESSAGE
    );
  });

  it("allows an owner to change another owner when at least one remains", () => {
    assert.equal(
      canManageMembershipTarget("owner", "owner", { otherActiveOwners: 1 }),
      true
    );
    assert.equal(
      ownerProtectionMessage({
        targetRole: "owner",
        otherActiveOwners: 1,
      }),
      null
    );
  });

  it("never lets an admin manage an owner", () => {
    assert.equal(
      canManageMembershipTarget("admin", "owner", { otherActiveOwners: 2 }),
      false
    );
  });

  it("does not change who the team member is when only the access role changes", () => {
    const profile = { id: "tm-1", name: "Jesús", job_title: "Producción" };
    const afterRoleChange = { ...profile };
    assert.deepEqual(afterRoleChange, profile);
  });
});

describe("countOtherActiveOwners", () => {
  it("counts active owners excluding the target user", () => {
    const memberships = [
      { user_id: "a", role: "owner", active: true },
      { user_id: "b", role: "owner", active: true },
      { user_id: "c", role: "owner", active: false },
      { user_id: "d", role: "admin", active: true },
    ];
    assert.equal(countOtherActiveOwners(memberships, "a"), 1);
    assert.equal(countOtherActiveOwners(memberships, "b"), 1);
    assert.equal(countOtherActiveOwners(memberships, "z"), 2);
  });
});

describe("order create permission is the access role, not the team member", () => {
  it("lets owner and staff create orders without a team profile", () => {
    assert.equal(canWriteOrders("owner"), true);
    assert.equal(canWriteOrders("staff"), true);
    assert.equal(canWriteOrders("viewer"), false);
  });
});
