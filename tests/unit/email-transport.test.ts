import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEmailTransport } from "@/lib/email/env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveEmailTransport", () => {
  it("uses console/fail only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_TRANSPORT", "console");
    expect(resolveEmailTransport()).toBe("console");

    vi.stubEnv("EMAIL_TRANSPORT", "fail");
    expect(resolveEmailTransport()).toBe("fail");
  });

  it("never fakes email in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_TRANSPORT", "console");
    expect(resolveEmailTransport()).toBe("resend");
  });

  it("defaults to resend when unset", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_TRANSPORT", "");
    expect(resolveEmailTransport()).toBe("resend");
  });
});
