import { describe, expect, it } from "vitest";
import { getConfig } from "./helpers/config";
import { fetchAnon } from "./helpers/app";
import { serviceClient } from "./helpers/supabase";

const CORE_TABLES = [
  "tenants",
  "memberships",
  "profiles",
  "orders",
  "clients",
  "order_statuses",
  "activity_log",
] as const;

describe("A. Infrastructure", () => {
  it("Supabase REST is reachable", async () => {
    const c = getConfig();
    const res = await fetch(new URL("/rest/v1/", c.supabaseUrl), {
      headers: { apikey: c.clientKey },
    });
    expect(res.status).toBe(200);
  });

  it("Supabase Auth health responds", async () => {
    const c = getConfig();
    const res = await fetch(new URL("/auth/v1/health", c.supabaseUrl));
    expect(res.ok).toBe(true);
  });

  it("Next.js app is reachable and / responds", async () => {
    const res = await fetchAnon("/");
    expect(res.status).toBe(200);
  });

  it("/auth/login responds", async () => {
    const res = await fetchAnon("/auth/login");
    expect(res.status).toBe(200);
  });

  it("guarded API routes reject anonymous access", async () => {
    const res = await fetchAnon("/api/dashboard");
    expect(res.status).toBe(403);
  });

  it("migrations are applied (core tables exist)", async () => {
    const svc = serviceClient();
    for (const table of CORE_TABLES) {
      const { error } = await svc
        .from(table)
        .select("*", { count: "exact", head: true });
      expect(error, `table ${table} should exist`).toBeNull();
    }
  });
});
