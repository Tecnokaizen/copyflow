import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { INVITABLE_ROLES } from "@/lib/auth/membership-roles";
import { parseAccessPatchPayload } from "./payload";
import {
  OWNERSHIP_TRANSFER_CONFIRMATION,
  canOfferOwnershipTransfer,
  ownershipTransferDescription,
  parseOwnershipTransferPayload,
} from "./ownership-transfer";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

const actor = "a3800000-0000-4000-8000-000000000001";
const target = "a3800000-0000-4000-8000-000000000002";

describe("ownership transfer offer", () => {
  it("shows the action only to the owner, for another active non-owner", () => {
    assert.equal(
      canOfferOwnershipTransfer({
        actorRole: "owner",
        actorUserId: actor,
        targetUserId: target,
        targetRole: "admin",
        targetActive: true,
      }),
      true
    );
    for (const role of ["admin", "manager", "staff", "viewer"] as const) {
      assert.equal(
        canOfferOwnershipTransfer({
          actorRole: role,
          actorUserId: actor,
          targetUserId: target,
          targetRole: "admin",
          targetActive: true,
        }),
        false
      );
    }
    assert.equal(
      canOfferOwnershipTransfer({
        actorRole: "owner",
        actorUserId: actor,
        targetUserId: actor,
        targetRole: "admin",
        targetActive: true,
      }),
      false
    );
    assert.equal(
      canOfferOwnershipTransfer({
        actorRole: "owner",
        actorUserId: actor,
        targetUserId: target,
        targetRole: "owner",
        targetActive: true,
      }),
      false
    );
    assert.equal(
      canOfferOwnershipTransfer({
        actorRole: "owner",
        actorUserId: actor,
        targetUserId: target,
        targetRole: "admin",
        targetActive: false,
      }),
      false
    );
  });

  it("keeps owner out of the normal role selector and invitations", () => {
    assert.equal(INVITABLE_ROLES.includes("owner" as never), false);
    assert.equal(
      parseAccessPatchPayload({ action: "change_role", role: "owner" }).ok,
      false
    );
    const panel = readSource("components/access/access-permissions-panel.tsx");
    const selectStart = panel.indexOf('id="change-role"');
    const selectEnd = panel.indexOf("</select>", selectStart);
    const select = panel.slice(selectStart, selectEnd);
    assert.match(select, /assignableRoles/);
    assert.doesNotMatch(select, /Propietario/);
    assert.match(panel, /Transferir propiedad/);
    assert.match(panel, /OWNERSHIP_TRANSFER_CONFIRMATION/);
    assert.match(panel, /onActorRoleChange/);
    assert.match(panel, /window\.location\.reload\(\)/);
    assert.doesNotMatch(panel, /router\.refresh\(\)/);
  });

  it("requires the confirmation phrase and names the billing consequence", () => {
    assert.equal(OWNERSHIP_TRANSFER_CONFIRMATION, "TRANSFERIR");
    const copy = ownershipTransferDescription({
      targetName: "Tamara",
      organizationName: "SUR4",
    });
    assert.match(copy, /Tamara pasará a ser la propietaria o el propietario de SUR4/);
    assert.match(copy, /pasarás a ser Administrador/);
    assert.match(copy, /facturación/);
    assert.match(copy, /transferencia de propiedad/);
  });

  it("accepts only a target user id", () => {
    assert.deepEqual(parseOwnershipTransferPayload({ target_user_id: target }), {
      ok: true,
      targetUserId: target,
    });
    assert.equal(parseOwnershipTransferPayload({ target_user_id: "nope" }).ok, false);
    assert.equal(
      parseOwnershipTransferPayload({ target_user_id: target, role: "owner" }).ok,
      false
    );
    assert.equal(parseOwnershipTransferPayload({}).ok, false);
  });

  it("calls the dedicated RPC and still rejects owner on the role route", () => {
    const route = readSource("app/api/team/access/transfer-ownership/route.ts");
    const handler = readSource("lib/access/ownership-transfer-handler.ts");
    assert.match(route, /transfer_tenant_ownership/);
    assert.match(handler, /role !== "owner"/);
    assert.doesNotMatch(route, /\.from\("memberships"\)/);
    assert.doesNotMatch(route, /update_tenant_membership_role/);
    const roleRoute = readSource("app/api/team/access/[userId]/route.ts");
    assert.match(roleRoute, /update_tenant_membership_role/);
    assert.doesNotMatch(roleRoute, /transfer_tenant_ownership/);
    const migration = readSource(
      "supabase/migrations/20260929121704_membership_mutation_lock_v1.sql"
    );
    assert.equal(
      migration.match(/gestcopy\.membership\.tenant:/g)?.length,
      4
    );
    assert.doesNotMatch(migration, /gestcopy\.ownership\.tenant:/);
    assert.doesNotMatch(migration, /memberships_one_active_owner_per_user_idx/);
    assert.match(migration, /hashtextextended\(p_target_user_id::text, 0\)/);
    assert.match(migration, /previous_owner_role', 'owner'/);
    assert.doesNotMatch(
      readSource(
        "supabase/migrations/20260914190000_team_roles_operative_coherence.sql"
      ),
      /transfer_tenant_ownership/
    );
  });
});
