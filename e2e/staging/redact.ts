/**
 * Everything the E2E suite writes (console, step log, network log, report)
 * goes through `Redactor`. Query strings are dropped from URLs because
 * presigned R2 URLs carry signatures and access key ids.
 */
export class Redactor {
  private readonly secrets: string[];

  constructor(secrets: Array<string | undefined>) {
    this.secrets = secrets
      .filter((value): value is string => typeof value === "string" && value.length >= 6)
      .sort((a, b) => b.length - a.length);
  }

  text(value: string): string {
    let out = value;
    for (const secret of this.secrets) out = out.split(secret).join("[REDACTED]");
    // Bearer tokens, JWTs and AWS signatures, whatever their source.
    out = out.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[REDACTED_JWT]");
    out = out.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[REDACTED]");
    out = out.replace(/(X-Amz-(?:Signature|Credential|Security-Token)=)[^&\s"']+/gi, "$1[REDACTED]");
    // Any URL query (presigned or not) is dropped from free text too.
    out = out.replace(/(https?:\/\/[^\s'"?]+)\?[^\s'"]*/g, "$1?…");
    return out;
  }

  url(value: string): string {
    try {
      const parsed = new URL(value);
      if (parsed.origin === "null") return this.text(value);
      return this.text(`${parsed.origin}${parsed.pathname}${parsed.search ? "?…" : ""}`);
    } catch {
      return this.text(value);
    }
  }

  /** Throws when a known secret survives in `content` (artifact self-check). */
  assertClean(label: string, content: string): void {
    for (const secret of this.secrets) {
      if (content.includes(secret)) throw new Error(`secret value found in artifact ${label}`);
    }
  }
}
