/**
 * Bounded concurrency gate (max N tasks in flight).
 * Waiters start as soon as a slot frees — no serial Promise chain.
 */
export function createConcurrencyGate(limit: number) {
  const max = Math.max(1, limit);
  let active = 0;
  const waiters: Array<() => void> = [];

  async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    }
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      const next = waiters.shift();
      if (next) next();
    }
  }

  return {
    run,
    activeCount: () => active,
    pendingWaiters: () => waiters.length,
  };
}

export const ORDER_UPLOAD_CONCURRENCY = 2;

/**
 * Claim a local upload id so double-retry cannot enqueue twice.
 * Returns false if already claimed (in flight / queued).
 */
export function claimUploadLocalId(
  claimed: Set<string>,
  localId: string,
): boolean {
  if (claimed.has(localId)) return false;
  claimed.add(localId);
  return true;
}

export function releaseUploadLocalId(
  claimed: Set<string>,
  localId: string,
): void {
  claimed.delete(localId);
}

/** Whether an async UI update may still touch this Files section instance. */
export function canApplyFilesUiUpdate(input: {
  mounted: boolean;
  instanceOrderId: string;
  callbackOrderId: string;
}): boolean {
  return (
    input.mounted &&
    input.instanceOrderId === input.callbackOrderId &&
    Boolean(input.instanceOrderId)
  );
}

/**
 * Silent post-upload LIST failure must not wipe a usable list with ErrorState.
 */
export function listRefreshFailureMode(opts: {
  silent: boolean;
}): "full_error" | "keep_list_notice" {
  return opts.silent ? "keep_list_notice" : "full_error";
}

export const SILENT_LIST_REFRESH_NOTICE =
  "Archivo subido. No se ha podido actualizar el listado. Reintenta la carga.";

/**
 * Next actionError after a LIST refresh attempt.
 * - success → clear notice/errors from list refresh
 * - silent failure → non-destructive notice
 * - full failure → leave actionError alone (listError owns UX)
 */
export function resolveActionErrorOnListResult(opts: {
  ok: boolean;
  silent: boolean;
}): string | null | undefined {
  if (opts.ok) return null;
  if (listRefreshFailureMode({ silent: opts.silent }) === "keep_list_notice") {
    return SILENT_LIST_REFRESH_NOTICE;
  }
  return undefined;
}
