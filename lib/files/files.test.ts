import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  assertCanMutateOrderFiles,
  contentDispositionAttachment,
} from "./access";
import {
  toPublicOrderDto,
  toPublicOrderFileDto,
  PUBLIC_ORDER_SCALAR_KEYS,
} from "./dto";
import {
  assertStorageKeyMatchesIds,
  buildOrderFileStorageKey,
} from "./object-key";
import {
  GET_PRESIGN_TTL_SECONDS,
  MAX_ORDER_FILE_BYTES,
  PUT_PRESIGN_TTL_SECONDS,
  sanitizeOriginalFilename,
  validateOrderFileInit,
} from "./validation";

const root = path.join(import.meta.dirname, "../..");

function read(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

describe("sanitizeOriginalFilename", () => {
  it("strips paths, controls, and falls back", () => {
    assert.equal(sanitizeOriginalFilename("../../etc/passwd.pdf"), "passwd.pdf");
    assert.equal(sanitizeOriginalFilename("C:\\\\Windows\\\\x.pdf"), "x.pdf");
    assert.equal(sanitizeOriginalFilename("  hello.pdf  "), "hello.pdf");
    assert.equal(sanitizeOriginalFilename(""), "archivo");
    assert.equal(sanitizeOriginalFilename(null), "archivo");
    assert.equal(sanitizeOriginalFilename("."), "archivo");
    assert.equal(sanitizeOriginalFilename("a".repeat(300) + ".pdf").length, 255);
  });
});

describe("validateOrderFileInit", () => {
  it("accepts allowlisted extension and size", () => {
    const ok = validateOrderFileInit({
      filename: "brief.pdf",
      content_type: "application/pdf",
      size_bytes: 1024,
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.filename, "brief.pdf");
      assert.equal(ok.extension, "pdf");
      assert.equal(ok.sizeBytes, 1024);
    }
  });

  it("rejects oversized, blocked HTML/JS, and unknown extensions", () => {
    assert.equal(
      validateOrderFileInit({
        filename: "x.pdf",
        content_type: "application/pdf",
        size_bytes: MAX_ORDER_FILE_BYTES + 1,
      }).ok,
      false
    );
    assert.equal(
      validateOrderFileInit({
        filename: "page.html",
        content_type: "text/html",
        size_bytes: 10,
      }).ok,
      false
    );
    assert.equal(
      validateOrderFileInit({
        filename: "run.js",
        content_type: "application/javascript",
        size_bytes: 10,
      }).ok,
      false
    );
    assert.equal(
      validateOrderFileInit({
        filename: "virus.exe",
        content_type: "application/octet-stream",
        size_bytes: 10,
      }).ok,
      false
    );
  });

  it("does not trust MIME alone when extension is blocked", () => {
    assert.equal(
      validateOrderFileInit({
        filename: "evil.html",
        content_type: "application/pdf",
        size_bytes: 10,
      }).ok,
      false
    );
  });
});

describe("object key contract", () => {
  it("builds orders/{tenant}/{order}/{file} and rejects non-uuids", () => {
    const tenantId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const orderId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const fileId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const key = buildOrderFileStorageKey({ tenantId, orderId, fileId });
    assert.equal(key, `orders/${tenantId}/${orderId}/${fileId}`);
    assert.equal(
      assertStorageKeyMatchesIds(key, { tenantId, orderId, fileId }),
      true
    );
    assert.throws(() =>
      buildOrderFileStorageKey({
        tenantId: "not-a-uuid",
        orderId,
        fileId,
      })
    );
    assert.equal(key.includes("brief.pdf"), false);
  });
});

describe("DTO hardening", () => {
  it("strips metadata, requirements_override, created_by, row_version", () => {
    const dto = toPublicOrderDto({
      id: "o1",
      title: "T",
      reference: "R-1",
      external_folder_url: "https://drive.example/folder",
      row_version: 3,
      metadata: { kiosk: { source: "kiosk", secret: "leak" } },
      requirements_override: { anything: true },
      created_by: "user-secret",
      storage_key: "should-not-appear",
    });
    assert.equal(dto.version, "3");
    assert.equal(dto.external_folder_url, "https://drive.example/folder");
    assert.equal("row_version" in dto, false);
    assert.equal("metadata" in dto, false);
    assert.equal("requirements_override" in dto, false);
    assert.equal("created_by" in dto, false);
    assert.equal("storage_key" in dto, false);
    assert.ok(PUBLIC_ORDER_SCALAR_KEYS.includes("external_folder_url"));
  });

  it("fails closed if Kiosk metadata would leak via spread", () => {
    const dto = toPublicOrderDto({
      id: "o1",
      row_version: 0,
      metadata: { kiosk_client_key: "ck_live_xxx" },
    });
    const serialized = JSON.stringify(dto);
    assert.equal(serialized.includes("kiosk_client_key"), false);
    assert.equal(serialized.includes("ck_live"), false);
    assert.equal(serialized.includes("metadata"), false);
  });

  it("order file DTO never exposes storage_key or etag", () => {
    const dto = toPublicOrderFileDto({
      id: "f1",
      original_name: "a.pdf",
      content_type: "application/pdf",
      size_bytes: 10,
      status: "ready",
      created_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:01:00Z",
      uploaded_by: "u1",
      storage_key: "orders/t/o/f",
      etag: '"x"',
      tenant_id: "t1",
    });
    const serialized = JSON.stringify(dto);
    assert.equal(serialized.includes("storage_key"), false);
    assert.equal(serialized.includes("etag"), false);
    assert.equal(serialized.includes("tenant_id"), false);
    assert.equal(dto.uploader_name, null);
  });
});

describe("access helpers", () => {
  it("blocks viewer mutate and archived orders", () => {
    assert.equal(
      assertCanMutateOrderFiles({ role: "viewer", archivedAt: null }).ok,
      false
    );
    const archived = assertCanMutateOrderFiles({
      role: "staff",
      archivedAt: "2026-01-01T00:00:00Z",
    });
    assert.equal(archived.ok, false);
    if (!archived.ok) {
      assert.equal(archived.status, 409);
      assert.equal(archived.body.code, "ORDER_ARCHIVED");
    }
    assert.equal(
      assertCanMutateOrderFiles({ role: "staff", archivedAt: null }).ok,
      true
    );
  });

  it("builds Content-Disposition attachment", () => {
    assert.match(
      contentDispositionAttachment('informe "final".pdf'),
      /attachment;/
    );
  });
});

describe("API contracts (source)", () => {
  it("init uses create_order_file_upload RPC with capability args", () => {
    const source = read("app", "api", "orders", "[id]", "files", "route.ts");
    assert.match(source, /create_order_file_upload/);
    assert.match(source, /createFilesCapability/);
    assert.match(source, /p_issued_at/);
    assert.match(source, /p_signature/);
    assert.match(source, /p_size_bytes/);
    assert.match(source, /p_upload_expires_at/);
    assert.equal(/\.from\(\s*["']order_files["']\s*\)\s*\.insert/.test(source), false);
    assert.equal(source.includes("Content-Length"), false);
    const successPayload = source.match(
      /return NextResponse\.json\(\s*\{([^}]+)\}\s*,\s*\{\s*status:\s*201/
    );
    assert.ok(successPayload, "expected 201 JSON response payload");
    assert.equal(successPayload[1].includes("storage_key"), false);
    assert.equal(successPayload[1].includes("signature"), false);
    assert.equal(PUT_PRESIGN_TTL_SECONDS, 15 * 60);
  });

  it("complete verifies HEAD then capability then complete RPC", () => {
    const source = read(
      "app",
      "api",
      "orders",
      "[id]",
      "files",
      "[fileId]",
      "complete",
      "route.ts"
    );
    assert.match(source, /headObject/);
    assert.match(source, /createFilesCapability/);
    assert.match(source, /complete_order_file_upload/);
    assert.match(source, /p_etag/);
    assert.match(source, /p_issued_at/);
    assert.match(source, /p_signature/);
    assert.equal(source.includes("p_size_bytes"), false);
    assert.equal(/\.from\(\s*["']order_files["']\s*\)\s*\.update/.test(source), false);
    // Runtime order inside POST: await headObject(...) before createFilesCapability(...)
    const headCall = source.search(/await\s+headObject\s*\(/);
    const capCall = source.search(/createFilesCapability\s*\(/);
    assert.ok(headCall >= 0 && capCall > headCall, "HEAD must precede capability");
  });

  it("delete removes R2 object before soft_delete_order_file", () => {
    const source = read(
      "app",
      "api",
      "orders",
      "[id]",
      "files",
      "[fileId]",
      "route.ts"
    );
    assert.match(source, /soft_delete_order_file/);
    assert.match(source, /createFilesCapability/);
    assert.match(source, /p_issued_at/);
    assert.match(source, /p_signature/);
    assert.equal(/\.from\(\s*["']order_files["']\s*\)\s*\.update/.test(source), false);
    assert.match(source, /deleteObject/);
    assert.match(source, /metadata preserved/);

    const r2DeleteCall = source.search(/await\s+deleteObject\s*\(/);
    const softDeleteCall = source.search(/soft_delete_order_file/);
    assert.ok(
      r2DeleteCall >= 0 && softDeleteCall > r2DeleteCall,
      "R2 delete must happen before metadata soft-delete"
    );

    assert.match(source, /status:\s*502/);
  });

  it("download uses GET presign with attachment disposition", () => {
    const source = read(
      "app",
      "api",
      "orders",
      "[id]",
      "files",
      "[fileId]",
      "download",
      "route.ts"
    );
    assert.match(source, /presignGet/);
    assert.match(source, /contentDispositionAttachment/);
    assert.equal(GET_PRESIGN_TTL_SECONDS, 5 * 60);
    assert.equal(source.includes("arrayBuffer"), false);
  });

  it("migration pins files_private HMAC + SELECT-only grants", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260918220000_order_files_v1.sql"
    );
    assert.match(migration, /CREATE SCHEMA IF NOT EXISTS files_private/);
    assert.match(migration, /verify_files_capability/);
    assert.match(migration, /files_signing_secret/);
    assert.match(migration, /files-v1\|/);
    assert.match(migration, /p_issued_at bigint/);
    assert.match(migration, /p_signature text/);
    assert.match(migration, /tg_order_files_mutation_guard/);
    assert.match(migration, /REVOKE ALL ON TABLE public\.order_files FROM authenticated/);
    assert.match(migration, /GRANT SELECT ON TABLE public\.order_files TO authenticated/);
    assert.equal(/GRANT SELECT, INSERT, UPDATE/.test(migration), false);
    assert.equal(/\bTO service_role\b/.test(migration), false);

    const quota = read(
      "supabase",
      "migrations",
      "20260921181000_tenant_file_limits_and_storage_quota_v1.sql"
    );
    assert.match(quota, /file-quota:/);
    assert.match(quota, /storage_quota_exceeded/);
    assert.match(quota, /resolve_tenant_storage_limit_bytes/);

    const rollback = read(
      "supabase",
      "rollbacks",
      "20260918220000_order_files_v1.sql"
    );
    assert.match(rollback, /DROP SCHEMA IF EXISTS files_private/);
    assert.match(rollback, /DROP FUNCTION IF EXISTS public\.create_order_file_upload/);
  });
});

describe("expired upload cleanup", () => {
  it("purges only expired pending metadata after R2 deletion", () => {
    const migration = read(
      "supabase",
      "migrations",
      "20260919120000_order_files_cleanup.sql"
    );
    assert.match(migration, /purge_expired_order_file/);
    assert.match(migration, /status = 'pending'/);
    assert.match(migration, /upload_expires_at < pg_catalog\.now\(\)/);
    assert.match(
      migration,
      /REVOKE ALL ON FUNCTION public\.purge_expired_order_file/
    );
    assert.match(migration, /TO service_role, postgres/);

    const route = read(
      "app",
      "api",
      "internal",
      "files",
      "cleanup",
      "route.ts"
    );
    assert.match(route, /CRON_SECRET/);
    assert.match(route, /createAdminClient/);
    assert.match(route, /assertStorageKeyMatchesIds/);
    assert.match(route, /deleteObject/);
    assert.match(route, /purge_expired_order_file/);
    assert.match(route, /\.eq\("status", "pending"\)/);
    assert.match(route, /\.lt\("upload_expires_at", now\)/);

    const r2DeleteCall = route.search(/await\s+deleteObject\s*\(/);
    const purgeCall = route.search(/supabase\.rpc\(\s*"purge_expired_order_file"/);
    assert.ok(
      r2DeleteCall >= 0 && purgeCall > r2DeleteCall,
      "cleanup must delete R2 before purging metadata"
    );

    const vercel = read("vercel.json");
    assert.match(vercel, /api\/internal\/files\/cleanup/);
    assert.match(vercel, /15 3 \* \* \*/);

    const grantMigration = read(
      "supabase",
      "migrations",
      "20260919124000_order_files_cleanup_service_role_select.sql"
    );
    assert.match(
      grantMigration,
      /GRANT SELECT ON TABLE public\.order_files TO service_role/
    );
    assert.equal(/GRANT\s+(INSERT|UPDATE|DELETE)/.test(grantMigration), false);
  });
});

describe("API contracts (lists)", () => {
  it("GET /api/files is tenant-scoped and omits storage_key", () => {
    const source = read("app", "api", "files", "route.ts");
    assert.match(source, /eq\("tenant_id", context\.tenant\.id\)/);
    assert.match(source, /orders!inner/);
    assert.equal(source.includes("storage_key"), false);
    assert.equal(source.includes("etag"), false);
  });

  it("order detail GET does not select star and maps through whitelist DTO", () => {
    const source = read("app", "api", "orders", "[id]", "route.ts");
    assert.equal(source.includes("clients(*)"), false);
    assert.equal(source.includes("services(*)"), false);
    assert.match(source, /toPublicOrderDto/);
    assert.match(source, /external_folder_url/);
    assert.equal(/\brequirements_override\b/.test(source), false);
    assert.equal(/\bmetadata\b/.test(source), false);
  });

  it("R2 adapter is server-only and key-centric", () => {
    const source = read("lib", "storage", "r2.ts");
    assert.match(source, /import "server-only"/);
    assert.match(source, /presignPut/);
    assert.match(source, /presignGet/);
    assert.match(source, /headObject/);
    assert.match(source, /deleteObject/);
    assert.equal(source.includes("tenant"), false);
    assert.equal(source.includes("supabase"), false);
  });
});
