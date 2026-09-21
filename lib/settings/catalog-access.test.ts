import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canManageSettingsCatalogs,
  canWriteStores,
} from "@/lib/auth/membership-roles";
import { canAccessOrderStatusSettingsApi } from "@/lib/settings/order-statuses";

describe("settings catalog access", () => {
  it("allows management roles to manage tenant catalogs", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      assert.equal(canManageSettingsCatalogs(role), true);
      assert.equal(canWriteStores(role), true);
      assert.equal(canAccessOrderStatusSettingsApi(role, true), true);
    }
  });

  it("keeps staff and viewer out of catalog settings", () => {
    for (const role of ["staff", "viewer"] as const) {
      assert.equal(canManageSettingsCatalogs(role), false);
      assert.equal(canWriteStores(role), false);
      assert.equal(canAccessOrderStatusSettingsApi(role, true), false);
    }

    assert.equal(canManageSettingsCatalogs(null), false);
    assert.equal(canAccessOrderStatusSettingsApi("owner", false), false);
  });
});
