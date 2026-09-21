import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { canManageSettingsCatalogs } from "@/lib/auth/membership-roles";
import {
  BYTES_PER_GIB,
  BYTES_PER_MIB,
  PLATFORM_MAX_FILE_BYTES,
  canManageFilesSettings,
  formatBinaryStorage,
  mergeFilesV1MaxFileBytes,
  parseMaxFileBytes,
  resolveMaxFileBytesFromPreferences,
  storageUsagePercent,
} from "./files";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("files settings helpers", () => {
  it("allows owner/admin/manager and denies staff/viewer", () => {
    assert.equal(canManageFilesSettings("owner"), true);
    assert.equal(canManageFilesSettings("admin"), true);
    assert.equal(canManageFilesSettings("manager"), true);
    assert.equal(canManageFilesSettings("staff"), false);
    assert.equal(canManageFilesSettings("viewer"), false);
    assert.equal(
      canManageFilesSettings("manager"),
      canManageSettingsCatalogs("manager")
    );
  });

  it("validates max_file_bytes against platform ceiling", () => {
    assert.equal(parseMaxFileBytes(10 * BYTES_PER_MIB), 10 * BYTES_PER_MIB);
    assert.equal(parseMaxFileBytes(PLATFORM_MAX_FILE_BYTES), PLATFORM_MAX_FILE_BYTES);
    assert.equal(parseMaxFileBytes(0), null);
    assert.equal(parseMaxFileBytes(-1), null);
    assert.equal(parseMaxFileBytes(PLATFORM_MAX_FILE_BYTES + 1), null);
    assert.equal(parseMaxFileBytes(1.5), null);
  });

  it("falls back to 100 MiB without preference", () => {
    assert.equal(resolveMaxFileBytesFromPreferences(null), PLATFORM_MAX_FILE_BYTES);
    assert.equal(resolveMaxFileBytesFromPreferences({}), PLATFORM_MAX_FILE_BYTES);
    assert.equal(
      resolveMaxFileBytesFromPreferences({ other: true }),
      PLATFORM_MAX_FILE_BYTES
    );
  });

  it("merges files_v1 without wiping neighboring preferences", () => {
    const merged = mergeFilesV1MaxFileBytes(
      {
        quick_order_layout_v1: { version: 1, fields: [] },
        files_v1: { version: 1, max_file_bytes: 10 * BYTES_PER_MIB },
      },
      50 * BYTES_PER_MIB
    );
    assert.deepEqual(merged.quick_order_layout_v1, {
      version: 1,
      fields: [],
    });
    assert.deepEqual(merged.files_v1, {
      version: 1,
      max_file_bytes: 50 * BYTES_PER_MIB,
    });
  });

  it("formats binary storage with MiB/GiB", () => {
    assert.equal(formatBinaryStorage(BYTES_PER_MIB), "1 MiB");
    assert.match(formatBinaryStorage(BYTES_PER_GIB), /GiB/);
  });

  it("computes usage percent only when quota exists", () => {
    assert.equal(storageUsagePercent(50, null), null);
    assert.equal(storageUsagePercent(50, 100), 50);
  });

  it("migration enforces advisory lock and nullable quota", () => {
    const migration = readSource(
      "supabase/migrations/20260921181000_tenant_file_limits_and_storage_quota_v1.sql"
    );
    assert.match(migration, /file-quota:/);
    assert.match(migration, /pg_advisory_xact_lock/);
    assert.match(migration, /storage_quota_exceeded/);
    assert.match(migration, /resolve_tenant_storage_limit_bytes/);
    assert.match(migration, /files_v1/);
    assert.match(migration, /legacy-unconfigured|not enforced/i);

    const feature = readSource(
      "supabase/migrations/20260921180000_storage_bytes_feature_v1.sql"
    );
    assert.match(feature, /storage_bytes/);
    assert.doesNotMatch(feature, /insert into public\.plan_features/i);
  });
});
