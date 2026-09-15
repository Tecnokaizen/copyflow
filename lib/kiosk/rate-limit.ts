type RateLimitOptions = {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
};

export function createKioskRateLimiter(options: RateLimitOptions) {
  const now = options.now ?? Date.now;
  const entries = new Map<string, { count: number; resetAt: number }>();

  return {
    allow(key: string) {
      const currentTime = now();
      const current = entries.get(key);
      if (!current || current.resetAt <= currentTime) {
        if (!current && entries.size >= (options.maxKeys ?? 10_000)) {
          for (const [entryKey, entry] of entries) {
            if (entry.resetAt <= currentTime) {
              entries.delete(entryKey);
            }
          }
          if (entries.size >= (options.maxKeys ?? 10_000)) {
            return false;
          }
        }
        entries.set(key, {
          count: 1,
          resetAt: currentTime + options.windowMs,
        });
        return true;
      }
      if (current.count >= options.limit) {
        return false;
      }
      current.count += 1;
      return true;
    },
  };
}

export function kioskClientKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const firstForwarded = forwarded?.split(",", 1)[0]?.trim();
  const candidate =
    firstForwarded || request.headers.get("x-real-ip")?.trim() || "";
  return candidate.length <= 64 && /^[0-9a-f:.]+$/i.test(candidate)
    ? candidate
    : "unknown";
}
