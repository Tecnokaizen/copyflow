import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CLEANUP_LIMIT } from "@/lib/files/cleanup";
import {
  type ClaimedStorageDeletion,
  STORAGE_DELETION_BATCH_LIMIT,
  STORAGE_DELETION_WORKER_LEASE_SECONDS,
  processStorageDeletionBatch,
} from "@/lib/files/storage-deletion";
import {
  claimStorageDeletions,
  storageDeletionRpcDeps,
} from "@/lib/files/storage-deletion-server";
import { createAdminClient } from "@/lib/supabase/admin";

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

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
  const log = (message: string, details: Record<string, unknown>) => {
    console.error(`[GET /api/internal/files/cleanup] ${message}`, details);
  };

  // 1. Expired pending uploads: metadata removal and R2 task enqueue happen
  //    atomically in PostgreSQL under row locks. No R2 call happens here.
  const { data: expired, error: expiredError } = await supabase.rpc(
    "claim_expired_file_uploads",
    { p_limit: CLEANUP_LIMIT }
  );

  if (expiredError) {
    log("expired upload claim failed", { message: expiredError.message });
    return NextResponse.json(
      { error: "Could not reserve expired uploads" },
      { status: 500 }
    );
  }

  const expiredSummary = (expired ?? {}) as Record<string, unknown>;

  // 2. Leased R2 deletions (user deletions + expired uploads + retries).
  let claims: ClaimedStorageDeletion[];
  try {
    claims = await claimStorageDeletions(
      supabase,
      STORAGE_DELETION_BATCH_LIMIT,
      STORAGE_DELETION_WORKER_LEASE_SECONDS
    );
  } catch (error) {
    log("storage deletion claim failed", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Could not claim storage deletions" },
      { status: 500 }
    );
  }

  const deletions = await processStorageDeletionBatch(
    claims,
    storageDeletionRpcDeps(supabase, log)
  );

  const { data: backlog, error: backlogError } = await supabase.rpc(
    "storage_deletion_backlog"
  );
  if (backlogError) {
    log("storage deletion backlog failed", { message: backlogError.message });
  }

  const backlogSummary = (backlog ?? {}) as Record<string, unknown>;
  if (count(backlogSummary.failed) > 0) {
    log("storage deletions require recovery", {
      failed: count(backlogSummary.failed),
    });
  }

  // 3. Client import rows older than 30 days (Migration V1). Independent of
  //    Files: a failure is logged and never blocks the storage cleanup.
  const { data: importPurge, error: importPurgeError } = await supabase.rpc(
    "client_import_purge_expired",
    { p_limit: 50 }
  );
  if (importPurgeError) {
    log("client import purge failed", { message: importPurgeError.message });
  }

  const purged = count(expiredSummary.orders) + count(expiredSummary.quotes);
  const skipped = count(expiredSummary.skipped);
  const failed =
    count(expiredSummary.errors) +
    deletions.retry_scheduled +
    deletions.failed +
    deletions.finish_errors;

  return NextResponse.json({
    ok: failed === 0,
    scanned: purged + skipped + count(expiredSummary.errors),
    purged,
    skipped,
    failed,
    limit: CLEANUP_LIMIT,
    deletions,
    backlog: backlogError ? null : backlogSummary,
    client_import_purge: importPurgeError ? null : importPurge,
  });
}
