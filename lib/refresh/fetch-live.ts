export type SilentLoadOptions = {
  silent?: boolean;
  signal?: AbortSignal;
};

export function fetchLive(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  return fetch(input, {
    ...init,
    cache: "no-store",
  });
}
