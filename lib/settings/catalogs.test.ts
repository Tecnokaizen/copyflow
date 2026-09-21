import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSettingsCatalogKey,
  nextAvailableCatalogCode,
  parseSettingsCatalogPayload,
} from "./catalogs";

describe("settings catalog helpers", () => {
  it("accepts only the explicit catalog allowlist", () => {
    assert.equal(isSettingsCatalogKey("customer_types"), true);
    assert.equal(isSettingsCatalogKey("payment_statuses"), true);
    assert.equal(isSettingsCatalogKey("tenants"), false);
    assert.equal(isSettingsCatalogKey("memberships"), false);
  });

  it("parses the common editable fields and rejects tenant/code injection", () => {
    assert.deepEqual(
      parseSettingsCatalogPayload({
        name: "WhatsApp",
        active: true,
        sort_order: 4,
      }),
      {
        ok: true,
        data: {
          name: "WhatsApp",
          active: true,
          sort_order: 4,
        },
      }
    );

    assert.equal(
      parseSettingsCatalogPayload({
        name: "Forged",
        active: true,
        sort_order: 1,
        tenant_id: "other",
      }).ok,
      false
    );

    assert.equal(
      parseSettingsCatalogPayload({
        name: "Forged",
        active: true,
        sort_order: 1,
        code: "kiosk",
      }).ok,
      false
    );
  });

  it("reserves the kiosk entry-channel code for the dedicated Kiosk feature", () => {
    assert.equal(
      nextAvailableCatalogCode({
        catalog: "entry_channels",
        name: "Kiosk",
        existingCodes: [],
      }),
      "kiosk_2"
    );

    assert.equal(
      nextAvailableCatalogCode({
        catalog: "order_contexts",
        name: "Kiosk",
        existingCodes: [],
      }),
      "kiosk"
    );
  });
});
