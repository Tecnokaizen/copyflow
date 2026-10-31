import { isAbortError } from "./abort";

/**
 * One in-flight request per list. Starting a new one aborts the previous and
 * makes it stale, so a slow older response (for example an unfiltered refresh
 * after a create) can never overwrite the result of a newer search or filter.
 */
export function createLatestRequest() {
  let current: AbortController | null = null;

  return {
    start() {
      current?.abort();
      const controller = new AbortController();
      current = controller;
      return {
        signal: controller.signal,
        isCurrent: () => current === controller && !controller.signal.aborted,
      };
    },
    /** On unmount or when the filters change: nothing in flight may apply. */
    abort() {
      current?.abort();
      current = null;
    },
  };
}

export type LatestRequest = ReturnType<typeof createLatestRequest>;
export type LatestTicket = ReturnType<LatestRequest["start"]>;

/**
 * fetch + JSON for one ticket. Returns null when the ticket was superseded or
 * aborted (the caller must not touch its state); other errors are rethrown.
 */
export async function fetchLatestJson(
  ticket: LatestTicket,
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ response: Response; body: unknown } | null> {
  try {
    const response = await fetchImpl(url, { signal: ticket.signal });
    const body: unknown = await response.json();
    return ticket.isCurrent() ? { response, body } : null;
  } catch (error) {
    if (isAbortError(error) || !ticket.isCurrent()) {
      return null;
    }
    throw error;
  }
}
