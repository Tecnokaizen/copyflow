import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canManageSettingsCatalogs,
  canWriteStores,
} from "@/lib/auth/membership-roles";

describe("settings catalog access", () => {
  it("allows management roles to manage tenant catalogs", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      assert.equal(canManageSettingsCatalogs(role), true);
      assert.equal(canWriteStores(role), true);
    }
  });

  it("keeps staff and viewer out of catalog settings", () => {
    for (const role of ["staff", "viewer"] as const) {
      assert.equal(canManageSettingsCatalogs(role), false);
      assert.equal(canWriteStores(role), false);
    }

    assert.equal(canManageSettingsCatalogs(null), false);
  });
});
