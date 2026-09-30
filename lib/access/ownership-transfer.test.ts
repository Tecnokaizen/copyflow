import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INVITABLE_ROLES } from "@/lib/auth/membership-roles";
import {
  parseAccessPatchPayload,
  parseOwnershipTransferPayload,
} from "./payload";
import {
  OWNERSHIP_TRANSFER_CONFIRMATION,
  canTransferTenantOwnership,
  ownershipTransferTargetLabel,
} from "./ownership-transfer";

const TARGET_USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("ownership transfer payload", () => {
  it("accepts only one valid destination membership user id", () => {
    assert.deepEqual(
      parseOwnershipTransferPayload({
        new_owner_user_id: TARGET_USER_ID,
      }),
      { ok: true, newOwnerUserId: TARGET_USER_ID }
    );

    assert.equal(
      parseOwnershipTransferPayload({
        new_owner_user_id: TARGET_USER_ID,
        tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }).ok,
      false
    );
    assert.equal(
      parseOwnershipTransferPayload({ new_owner_user_id: "Tamara" }).ok,
      false
    );
  });
});
describe("ownership transfer UI gate", () => {
  it("shows the dedicated action only to an owner for an active non-owner", () => {
    assert.equal(
      canTransferTenantOwnership("owner", { role: "staff", active: true }),
      true
    );
    assert.equal(
      canTransferTenantOwnership("admin", { role: "staff", active: true }),
      false
    );
    assert.equal(
      canTransferTenantOwnership("owner", { role: "staff", active: false }),
      false
    );
    assert.equal(
      canTransferTenantOwnership("owner", { role: "owner", active: true }),
      false
    );
  });

  it("keeps owner out of normal invitations and requires strong confirmation", () => {
    assert.equal(INVITABLE_ROLES.includes("owner" as never), false);
    assert.equal(
      parseAccessPatchPayload({ action: "change_role", role: "owner" }).ok,
      false
    );
    assert.equal(OWNERSHIP_TRANSFER_CONFIRMATION, "TRANSFERIR");
  });

  it("uses the member name before email in the confirmation", () => {
    assert.equal(
      ownershipTransferTargetLabel({
        full_name: "Tamara",
        email: "tamara@example.com",
      }),
      "Tamara"
    );
    assert.equal(
      ownershipTransferTargetLabel({
        full_name: null,
        email: "tamara@example.com",
      }),
      "tamara@example.com"
    );
  });
});
