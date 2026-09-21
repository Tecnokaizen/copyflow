import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import {
  SETTINGS_CATALOG_KEYS,
  isSettingsCatalogKey,
  nextAvailableCatalogCode,
  parseSettingsCatalogPayload,
  settingsCatalogDomainError,
  settingsCatalogWriteHttpStatus,
} from "./catalogs";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("settings catalog helpers", () => {
  it("accepts only the explicit catalog allowlist of eight keys", () => {
    assert.deepEqual([...SETTINGS_CATALOG_KEYS], [
      "customer_types",
      "entry_channels",
      "order_contexts",
      "file_statuses",
      "quote_statuses",
      "payment_statuses",
      "delivery_methods",
      "service_categories",
    ]);
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

    assert.equal(
      parseSettingsCatalogPayload({
        name: "Forged",
        active: true,
        sort_order: 1,
        color: "#fff",
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

  it("maps domain errors for identity and kiosk guards", () => {
    assert.equal(
      settingsCatalogDomainError("42501", "catalog_code_immutable"),
      "catalog_code_immutable"
    );
    assert.equal(
      settingsCatalogDomainError("42501", "kiosk_channel_reserved"),
      "kiosk_channel_reserved"
    );
    assert.equal(
      settingsCatalogWriteHttpStatus("kiosk_channel_active_immutable"),
      409
    );
    assert.equal(settingsCatalogWriteHttpStatus("duplicate_catalog_item"), 409);
  });
});

describe("settings catalog authorization and routes", () => {
  const listRoute = readSource(
    "app/api/settings/catalogs/[catalog]/route.ts"
  );
  const patchRoute = readSource(
    "app/api/settings/catalogs/[catalog]/[id]/route.ts"
  );
  const page = readSource("app/settings/catalogs/page.tsx");
  const migration = readSource(
    "supabase/migrations/20260921150000_settings_catalogs_harden_v1.sql"
  );
  const servicesCategories = readSource(
    "app/api/services/categories/route.ts"
  );

  it("allows owner/admin/manager and rejects staff/viewer for writes", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      assert.equal(canManageSettingsCatalogs(role), true);
    }
    for (const role of ["staff", "viewer"] as const) {
      assert.equal(canManageSettingsCatalogs(role), false);
    }
  });

  it("POST/PATCH gate writes with canManageSettingsCatalogs and server tenant", () => {
    assert.match(listRoute, /canManageSettingsCatalogs/);
    assert.match(listRoute, /getCurrentContext/);
    assert.match(listRoute, /context\.tenant\.id/);
    assert.match(listRoute, /nextAvailableCatalogCode/);
    assert.equal(listRoute.includes("body.tenant_id"), false);
    assert.equal(/export async function DELETE/.test(listRoute), false);

    assert.match(patchRoute, /canManageSettingsCatalogs/);
    assert.match(patchRoute, /context\.tenant\.id/);
    assert.match(patchRoute, /kiosk_channel_active_immutable/);
    assert.match(
      patchRoute,
      /\.update\(\{\s*name: parsed\.data\.name,\s*active: parsed\.data\.active,\s*sort_order: parsed\.data\.sort_order,\s*\}\)/
    );
    assert.equal(/export async function DELETE/.test(patchRoute), false);
  });

  it("Settings page uses the same catalog access gate", () => {
    assert.match(page, /canManageSettingsCatalogs/);
    assert.match(page, /CatalogSettings/);
  });

  it("migration hardens identity and kiosk at PostgreSQL level", () => {
    assert.match(migration, /tg_settings_catalog_immutable_identity/);
    assert.match(migration, /catalog_tenant_immutable/);
    assert.match(migration, /catalog_code_immutable/);
    assert.match(migration, /tg_entry_channels_kiosk_guard/);
    assert.match(migration, /kiosk_channel_reserved/);
    assert.match(migration, /kiosk_channel_active_immutable/);
    assert.match(migration, /app\.allow_kiosk_channel_mutation/);
    for (const table of [
      "customer_types",
      "entry_channels",
      "order_contexts",
      "file_statuses",
      "quote_statuses",
      "payment_statuses",
      "delivery_methods",
      "service_categories",
    ]) {
      assert.match(
        migration,
        new RegExp(`trg_${table}_immutable_identity`)
      );
    }
  });

  it("Services only reads active service_categories; Settings owns writes", () => {
    assert.match(servicesCategories, /service_categories/);
    assert.match(servicesCategories, /eq\("active", true\)/);
    assert.equal(servicesCategories.includes(".insert("), false);
    assert.equal(servicesCategories.includes(".update("), false);
    assert.equal(servicesCategories.includes("export async function POST"), false);
  });
});
