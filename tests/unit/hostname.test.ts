import { afterEach, describe, expect, it, vi } from "vitest";
import { getSubdomainFromHostname } from "@/lib/tenant/hostname";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getSubdomainFromHostname", () => {
  it("returns null for localhost / apex", () => {
    expect(getSubdomainFromHostname("localhost")).toBeNull();
    expect(getSubdomainFromHostname("127.0.0.1")).toBeNull();
    expect(getSubdomainFromHostname("app.gestcopy.com")).toBeNull();
  });

  it("extracts the tenant slug from a production subdomain", () => {
    expect(getSubdomainFromHostname("prueba-final.app.gestcopy.com")).toBe(
      "prueba-final",
    );
  });

  it("accepts {slug}.localhost only outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(getSubdomainFromHostname("acme.localhost:3000")).toBe("acme");

    vi.stubEnv("NODE_ENV", "production");
    expect(getSubdomainFromHostname("acme.localhost")).toBeNull();
  });

  it("ignores unrelated legacy domains", () => {
    expect(getSubdomainFromHostname("sur4.copyflow.com")).toBeNull();
  });
});
