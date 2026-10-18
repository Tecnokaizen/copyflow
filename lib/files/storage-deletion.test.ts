import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mapOrderFileRpcError } from "./rpc-error";
import {
  type ClaimedStorageDeletion,
  type FinishOutcome,
  type FinishResult,
  type StorageDeletionKind,
  claimStorageKeyMatchesIds,
  parseClaimedStorageDeletions,
  parseFinishResult,
  processStorageDeletionBatch,
  runInlineStorageDeletion,
  storageDeletionIdFromRpc,
} from "./storage-deletion";

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER = "22222222-2222-4222-8222-222222222222";
const QUOTE = "33333333-3333-4333-8333-333333333333";

type Task = {
  id: string;
  kind: StorageDeletionKind;
  parent: string;
  file: string;
  key: string;
  status: "pending" | "processing" | "completed" | "failed";
  attempts: number;
  maxAttempts: number;
  leaseToken: string | null;
  leaseUntil: number;
  nextAttemptAt: number;
  lastError: string | null;
};

/** In-memory model of files_private.storage_deletions (same transitions as the SQL RPCs). */
class FakeOutbox {
  now = 0;
  tasks = new Map<string, Task>();
  private seq = 0;

  enqueue(kind: StorageDeletionKind, fileId: string, key?: string): string {
    const parent = kind === "order" ? ORDER : QUOTE;
    const id = `task-${++this.seq}`;
    this.tasks.set(id, {
      id,
      kind,
      parent,
      file: fileId,
      key: key ?? `${kind}s/${TENANT}/${parent}/${fileId}`,
      status: "pending",
      attempts: 0,
      maxAttempts: 3,
      leaseToken: null,
      leaseUntil: 0,
      nextAttemptAt: this.now,
      lastError: null,
    });
    return id;
  }

  claim(id: string | null, limit: number, leaseMs: number): ClaimedStorageDeletion[] {
    const claimed: ClaimedStorageDeletion[] = [];
    for (const task of this.tasks.values()) {
      if (claimed.length >= limit) break;
      if (id && task.id !== id) continue;
      if (
        task.status === "processing" &&
        task.leaseUntil < this.now &&
        task.attempts >= task.maxAttempts
      ) {
        task.status = "failed";
        task.leaseToken = null;
        continue;
      }
      const due =
        (task.status === "pending" && task.nextAttemptAt <= this.now) ||
        (task.status === "processing" && task.leaseUntil < this.now);
      if (!due) continue;
      task.status = "processing";
      task.attempts += 1;
      task.leaseToken = `lease-${task.id}-${task.attempts}`;
      task.leaseUntil = this.now + leaseMs;
      claimed.push({
        id: task.id,
        file_kind: task.kind,
        tenant_id: TENANT,
        parent_id: task.parent,
        file_id: task.file,
        storage_key: task.key,
        attempts: task.attempts,
        lease_token: task.leaseToken,
      });
    }
    return claimed;
  }

  finish(input: {
    id: string;
    leaseToken: string;
    outcome: FinishOutcome;
    error: string | null;
  }): FinishResult {
    const task = this.tasks.get(input.id);
    if (!task) throw new Error("storage deletion not found");
    if (task.status === "completed") return "already_completed";
    if (task.status !== "processing" || task.leaseToken !== input.leaseToken) {
      return "stale";
    }
    task.leaseToken = null;
    if (input.outcome === "deleted") {
      task.status = "completed";
      return "completed";
    }
    task.lastError = input.error;
    if (input.outcome === "abort" || task.attempts >= task.maxAttempts) {
      task.status = "failed";
      return "failed";
    }
    task.status = "pending";
    task.nextAttemptAt = this.now + 60_000 * 2 ** task.attempts;
    return "retry_scheduled";
  }
}

class FakeR2 {
  objects = new Set<string>();
  deletes: string[] = [];
  failuresLeft = 0;

  async remove(key: string) {
    this.deletes.push(key);
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("R2 503 Service Unavailable");
    }
    // R2 DeleteObject is idempotent: a missing key is success.
    this.objects.delete(key);
  }
}

function setup() {
  const outbox = new FakeOutbox();
  const r2 = new FakeR2();
  const logs: string[] = [];
  let finishFailures = 0;
  const deps = {
    removeObject: (key: string) => r2.remove(key),
    finish: async (input: Parameters<FakeOutbox["finish"]>[0]) => {
      if (finishFailures > 0) {
        finishFailures -= 1;
        throw new Error("supabase unavailable");
      }
      return outbox.finish(input);
    },
    log: (message: string) => {
      logs.push(message);
    },
  };
  const inline = (id: string) =>
    runInlineStorageDeletion(id, {
      ...deps,
      claimOne: async (taskId) => outbox.claim(taskId, 1, 60_000),
    });
  const worker = () =>
    processStorageDeletionBatch(outbox.claim(null, 100, 300_000), deps);
  return {
    outbox,
    r2,
    logs,
    deps,
    inline,
    worker,
    failFinish(times: number) {
      finishFailures = times;
    },
  };
}

function objectKey(kind: StorageDeletionKind, fileId: string) {
  return `${kind}s/${TENANT}/${kind === "order" ? ORDER : QUOTE}/${fileId}`;
}

const FILE_A = "44444444-4444-4444-8444-444444444444";
const FILE_B = "55555555-5555-4555-8555-555555555555";

describe("storage deletion protocol", () => {
  it("normal delete: inline deletes the object and completes the task", async () => {
    const t = setup();
    t.r2.objects.add(objectKey("order", FILE_A));
    const id = t.outbox.enqueue("order", FILE_A);

    assert.equal(await t.inline(id), "completed");
    assert.equal(t.outbox.tasks.get(id)?.status, "completed");
    assert.equal(t.r2.objects.has(objectKey("order", FILE_A)), false);
  });

  it("repeated delete is idempotent and does not re-open the task", async () => {
    const t = setup();
    const id = t.outbox.enqueue("order", FILE_A);
    assert.equal(await t.inline(id), "completed");
    assert.equal(await t.inline(id), "not_claimed");
    assert.equal(t.outbox.tasks.get(id)?.attempts, 1);
    assert.equal(t.outbox.tasks.get(id)?.status, "completed");
  });

  it("R2 failure keeps the task pending and a later run completes it", async () => {
    const t = setup();
    t.r2.objects.add(objectKey("order", FILE_A));
    t.r2.failuresLeft = 1;
    const id = t.outbox.enqueue("order", FILE_A);

    assert.equal(await t.inline(id), "retry_scheduled");
    const task = t.outbox.tasks.get(id);
    assert.equal(task?.status, "pending");
    assert.match(task?.lastError ?? "", /503/);
    assert.equal(t.r2.objects.has(objectKey("order", FILE_A)), true);

    // Not due yet: worker does nothing.
    assert.equal((await t.worker()).claimed, 0);

    t.outbox.now += 10 * 60_000;
    const summary = await t.worker();
    assert.equal(summary.completed, 1);
    assert.equal(task?.status, "completed");
    assert.equal(t.r2.objects.has(objectKey("order", FILE_A)), false);
  });

  it("Supabase failure after R2 deletion is recovered after the lease expires", async () => {
    const t = setup();
    t.r2.objects.add(objectKey("order", FILE_A));
    const id = t.outbox.enqueue("order", FILE_A);
    t.failFinish(1);

    assert.equal(await t.inline(id), "finish_error");
    assert.equal(t.outbox.tasks.get(id)?.status, "processing");
    assert.equal(t.r2.objects.has(objectKey("order", FILE_A)), false);

    // Lease still valid: the worker does not steal it.
    assert.equal((await t.worker()).claimed, 0);

    t.outbox.now += 61_000;
    const summary = await t.worker();
    assert.equal(summary.completed, 1);
    assert.equal(t.outbox.tasks.get(id)?.status, "completed");
    assert.equal(t.outbox.tasks.get(id)?.attempts, 2);
  });

  it("crash between reservation and R2 deletion: the worker finishes it", async () => {
    const t = setup();
    t.r2.objects.add(objectKey("quote", FILE_A));
    const id = t.outbox.enqueue("quote", FILE_A);
    // No inline call (process died after commit).
    const summary = await t.worker();
    assert.equal(summary.completed, 1);
    assert.equal(t.outbox.tasks.get(id)?.status, "completed");
    assert.equal(t.r2.objects.has(objectKey("quote", FILE_A)), false);
  });

  it("inline confirmation never interferes with a worker that holds the lease", async () => {
    const t = setup();
    const id = t.outbox.enqueue("order", FILE_A);
    const workerClaims = t.outbox.claim(null, 10, 300_000);
    assert.equal(workerClaims.length, 1);

    assert.equal(await t.inline(id), "not_claimed");
    assert.equal(t.r2.deletes.length, 0);

    const summary = await processStorageDeletionBatch(workerClaims, t.deps);
    assert.equal(summary.completed, 1);
  });

  it("a delayed worker with an expired lease is ignored as stale", async () => {
    const t = setup();
    const id = t.outbox.enqueue("order", FILE_A);
    const slow = t.outbox.claim(null, 10, 300_000);

    t.outbox.now += 301_000;
    const fast = await t.worker();
    assert.equal(fast.completed, 1);

    const late = await processStorageDeletionBatch(slow, t.deps);
    assert.equal(late.stale, 0);
    assert.equal(late.completed, 1, "already_completed counts as completed");
    assert.equal(t.outbox.tasks.get(id)?.status, "completed");
  });

  it("a delayed worker cannot overwrite a re-leased task", async () => {
    const t = setup();
    const id = t.outbox.enqueue("order", FILE_A);
    const slow = t.outbox.claim(null, 10, 300_000);
    t.outbox.now += 301_000;
    const current = t.outbox.claim(null, 10, 300_000);

    t.r2.failuresLeft = 1;
    const late = await processStorageDeletionBatch(slow, t.deps);
    assert.equal(late.stale, 1);
    assert.equal(t.outbox.tasks.get(id)?.status, "processing");
    assert.equal(t.outbox.tasks.get(id)?.leaseToken, current[0]?.lease_token);

    const finished = await processStorageDeletionBatch(current, t.deps);
    assert.equal(finished.completed, 1);
  });

  it("two workers never lease the same task concurrently", async () => {
    const t = setup();
    t.outbox.enqueue("order", FILE_A);
    t.outbox.enqueue("quote", FILE_B);
    const a = t.outbox.claim(null, 100, 300_000);
    const b = t.outbox.claim(null, 100, 300_000);
    assert.equal(a.length, 2);
    assert.equal(b.length, 0);
  });

  it("stops retrying at max attempts and keeps the failed task", async () => {
    const t = setup();
    t.r2.failuresLeft = 99;
    const id = t.outbox.enqueue("order", FILE_A);
    const results: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      t.outbox.now += 24 * 60 * 60_000;
      const s = await t.worker();
      results.push(`${s.claimed}:${s.retry_scheduled}:${s.failed}`);
    }
    assert.deepEqual(results, ["1:1:0", "1:1:0", "1:0:1", "0:0:0", "0:0:0", "0:0:0"]);
    const task = t.outbox.tasks.get(id);
    assert.equal(task?.status, "failed");
    assert.equal(task?.attempts, 3);
    assert.match(task?.lastError ?? "", /503/);
    assert.equal(t.r2.deletes.length, 3);
  });

  it("deleting an object that no longer exists completes", async () => {
    const t = setup();
    const id = t.outbox.enqueue("order", FILE_A);
    assert.equal(t.r2.objects.size, 0);
    assert.equal(await t.inline(id), "completed");
  });

  it("a manipulated storage key is never sent to R2", async () => {
    const t = setup();
    const victim = `orders/${TENANT}/${ORDER}/${FILE_B}`;
    t.r2.objects.add(victim);
    const id = t.outbox.enqueue("order", FILE_A, victim);

    assert.equal(await t.inline(id), "failed");
    assert.equal(t.r2.deletes.length, 0);
    assert.equal(t.r2.objects.has(victim), true);
    assert.equal(t.outbox.tasks.get(id)?.status, "failed");
    assert.match(t.outbox.tasks.get(id)?.lastError ?? "", /storage key/);
  });

  it("quote and cross-kind keys are validated by kind", () => {
    const claim = (kind: StorageDeletionKind, key: string): ClaimedStorageDeletion => ({
      id: "t",
      file_kind: kind,
      tenant_id: TENANT,
      parent_id: kind === "order" ? ORDER : QUOTE,
      file_id: FILE_A,
      storage_key: key,
      attempts: 1,
      lease_token: "l",
    });
    assert.equal(claimStorageKeyMatchesIds(claim("quote", objectKey("quote", FILE_A))), true);
    assert.equal(
      claimStorageKeyMatchesIds(claim("quote", `orders/${TENANT}/${QUOTE}/${FILE_A}`)),
      false
    );
    assert.equal(claimStorageKeyMatchesIds(claim("order", "orders/x/y/z")), false);
  });

  it("claim errors never throw from the inline path", async () => {
    const t = setup();
    const result = await runInlineStorageDeletion("task-x", {
      ...t.deps,
      claimOne: async () => {
        throw new Error("service role unavailable");
      },
    });
    assert.equal(result, "claim_error");
    assert.equal(t.r2.deletes.length, 0);
  });
});

describe("storage deletion RPC parsing", () => {
  it("drops malformed claim rows", () => {
    const good = {
      id: "a",
      file_kind: "order",
      tenant_id: TENANT,
      parent_id: ORDER,
      file_id: FILE_A,
      storage_key: objectKey("order", FILE_A),
      attempts: 1,
      lease_token: "lease",
    };
    const parsed = parseClaimedStorageDeletions([
      good,
      { ...good, file_kind: "logo" },
      { ...good, lease_token: null },
      null,
      "x",
    ]);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.id, "a");
    assert.deepEqual(parseClaimedStorageDeletions(null), []);
  });

  it("parses finish results and deletion ids strictly", () => {
    assert.equal(parseFinishResult("completed"), "completed");
    assert.equal(parseFinishResult("deleted"), null);
    assert.equal(storageDeletionIdFromRpc({ storage_deletion_id: "abc" }), "abc");
    assert.equal(storageDeletionIdFromRpc({ id: "file" }), null);
    assert.equal(storageDeletionIdFromRpc(null), null);
  });
});

describe("official PDF protection response", () => {
  it("maps official_pdf_protected to a controlled 409", () => {
    const mapped = mapOrderFileRpcError(
      { code: "55000", message: "official_pdf_protected" },
      "Could not delete file"
    );
    assert.equal(mapped.status, 409);
    assert.equal(mapped.body.code, "OFFICIAL_PDF_PROTECTED");
  });
});
