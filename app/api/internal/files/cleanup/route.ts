import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { assertStorageKeyMatchesIds } from "@/lib/files/object-key";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteObject } from "@/lib/storage/r2";

const CLEANUP_LIMIT = 100;

function requireCronSecret(): string {
  const value = process.env.CRON_SECRET?.trim() ?? "";
  if (value.length < 32) {
    throw new Error("CRON_SECRET must contain at least 32 characters");
  }
  return value;
}

function authorized(request: NextRequest, secret: string): boolean {
  const expected = `Bearer ${secret}`;
  const actual = request.headers.get("authorization") ?? "";

  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");

  if (expectedBytes.length !== actualBytes.length) {
    return false;
  }

  return timingSafeEqual(expectedBytes, actualBytes);
}

export async function GET(request: NextRequest) {
  let cronSecret: string;
  try {
    cronSecret = requireCronSecret();
  } catch (error) {
    console.error("[GET /api/internal/files/cleanup] cron secret invalid", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Cleanup is not configured" },
      { status: 500 }
    );
  }

  if (!authorized(request, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const { data: rows, error: listError } = await supabase
    .from("order_files")
    .select("id, tenant_id, order_id, storage_key, upload_expires_at")
    .eq("status", "pending")
    .is("deleted_at", null)
    .lt("upload_expires_at", now)
    .order("upload_expires_at", { ascending: true })
    .limit(CLEANUP_LIMIT);

  if (listError) {
    console.error("[GET /api/internal/files/cleanup] list failed", {
      message: listError.message,
    });
    return NextResponse.json(
      { error: "Could not list expired uploads" },
      { status: 500 }
    );
  }

  let purged = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const fileId = String(row.id ?? "");
    const tenantId = String(row.tenant_id ?? "");
    const orderId = String(row.order_id ?? "");
    const storageKey = String(row.storage_key ?? "");

    try {
      if (
        !assertStorageKeyMatchesIds(storageKey, {
          tenantId,
          orderId,
          fileId,
        })
      ) {
        skipped += 1;
        console.error("[GET /api/internal/files/cleanup] storage key mismatch", {
          file_id: fileId,
        });
        continue;
      }

      // R2 first: if object deletion fails, keep metadata so a later run can retry.
      await deleteObject({ key: storageKey });

      const { data: removed, error: purgeError } = await supabase.rpc(
        "purge_expired_order_file",
        { p_file_id: fileId }
      );

      if (purgeError) {
        failed += 1;
        console.error("[GET /api/internal/files/cleanup] metadata purge failed", {
          message: purgeError.message,
          file_id: fileId,
        });
        continue;
      }

      if (removed === true) {
        purged += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      console.error("[GET /api/internal/files/cleanup] item failed", {
        message: error instanceof Error ? error.message : "unknown",
        file_id: fileId,
      });
    }
  }

  return NextResponse.json({
    ok: failed === 0,
    scanned: rows?.length ?? 0,
    purged,
    skipped,
    failed,
    limit: CLEANUP_LIMIT,
  });
}
