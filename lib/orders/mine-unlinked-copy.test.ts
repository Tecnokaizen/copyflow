import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveMineQueryScope } from "./mine";
import {
  UNLINKED_MINE_DESCRIPTION,
  UNLINKED_MINE_TITLE,
  unlinkedMineOrdersCopy,
} from "./mine-unlinked-copy";

describe("Mis pedidos depends only on the operative profile", () => {
  it("uses the session team_members.user_id, ignoring client IDs", () => {
    const scope = resolveMineQueryScope({
      tenantId: "tenant-a",
      sessionTeamMemberId: null,
      requestedAssigneeId: "other-member",
      requestedTenantId: "tenant-b",
    });
    assert.deepEqual(scope, {
      tenantId: "tenant-a",
      assignedTeamMemberId: null,
    });
  });

  it("explains that Gestcopy still works without an operative profile", () => {
    const accessCopy = unlinkedMineOrdersCopy({
      canWriteTeam: true,
      canManageTenantAccess: true,
    });
    assert.equal(accessCopy.title, UNLINKED_MINE_TITLE);
    assert.equal(accessCopy.description, UNLINKED_MINE_DESCRIPTION);
    assert.equal(accessCopy.assignCtaHref, "/team/access");
    assert.equal(
      unlinkedMineOrdersCopy({
        canWriteTeam: true,
        canManageTenantAccess: false,
      }).assignCtaHref,
      "/team"
    );
    assert.equal(
      unlinkedMineOrdersCopy({
        canWriteTeam: false,
        canManageTenantAccess: false,
      }).assignCtaHref,
      null
    );
  });
});
