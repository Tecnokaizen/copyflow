export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const name = "name" in error ? error.name : null;
  return name === "AbortError";
}

export function nextLoadSignal(
  previous: AbortController | null,
  external?: AbortSignal
): { controller: AbortController; signal: AbortSignal } {
  previous?.abort();
  const controller = new AbortController();
  const signal = external
    ? AbortSignal.any([external, controller.signal])
    : controller.signal;
  return { controller, signal };
}
