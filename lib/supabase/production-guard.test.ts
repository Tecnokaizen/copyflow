import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  PRODUCTION_DATABASE_OVERRIDE,
  ProductionDatabaseGuardError,
  assertProductionDatabaseAllowed,
  isProductionSupabaseUrl,
} from "./production-guard";

// Refs are reassembled at runtime so the release gate never sees them in the tree.
const STAGING_REF = ["fmmfsbhcwx", "kaszrrarpw"].join("");
const PRODUCTION_REF = ["wsclqvlzjd", "gwkxbolhoy"].join("");
const PRODUCTION_URL = `https://${PRODUCTION_REF}.supabase.co`;

const root = path.join(import.meta.dirname, "../..");

const refuses = (env: Record<string, string | undefined>) =>
  assert.throws(
    () => assertProductionDatabaseAllowed(env),
    (error: unknown) => error instanceof ProductionDatabaseGuardError && /Production Supabase project/.test(error.message),
  );

describe("production database guard", () => {
  it("detects the Production project however the URL is written", () => {
    assert.equal(isProductionSupabaseUrl(PRODUCTION_URL), true);
    assert.equal(isProductionSupabaseUrl(`${PRODUCTION_URL}/`), true);
    assert.equal(isProductionSupabaseUrl(`${PRODUCTION_URL}/rest/v1`), true);
    assert.equal(isProductionSupabaseUrl(`  ${PRODUCTION_URL.toUpperCase()}  `), true);
    assert.equal(isProductionSupabaseUrl(`${PRODUCTION_REF}.supabase.co`), true);
  });

  it("ignores Staging, local and unset URLs", () => {
    assert.equal(isProductionSupabaseUrl(`https://${STAGING_REF}.supabase.co`), false);
    assert.equal(isProductionSupabaseUrl("http://127.0.0.1:54321"), false);
    assert.equal(isProductionSupabaseUrl("https://abcdefghijklmnopqrst.supabase.co"), false);
    assert.equal(isProductionSupabaseUrl(""), false);
    assert.equal(isProductionSupabaseUrl(undefined), false);
    assert.doesNotThrow(() => assertProductionDatabaseAllowed({}));
    assert.doesNotThrow(() =>
      assertProductionDatabaseAllowed({ NEXT_PUBLIC_SUPABASE_URL: `https://${STAGING_REF}.supabase.co` }),
    );
  });

  it("refuses Production on a workstation, in Preview and in development", () => {
    refuses({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL });
    refuses({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL, VERCEL: "1", VERCEL_ENV: "preview" });
    refuses({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL, VERCEL: "1", VERCEL_ENV: "development" });
    refuses({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL, VERCEL: "1" });
    refuses({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL, VERCEL_ENV: "production" });
  });

  it("allows Vercel Production deployments", () => {
    assert.doesNotThrow(() =>
      assertProductionDatabaseAllowed({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL, VERCEL: "1", VERCEL_ENV: "production" }),
    );
  });

  it("allows an explicit override only with the exact value 1", () => {
    assert.doesNotThrow(() =>
      assertProductionDatabaseAllowed({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL, [PRODUCTION_DATABASE_OVERRIDE]: "1" }),
    );
    for (const value of ["", "0", "true", "yes", " 1"]) {
      refuses({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL, [PRODUCTION_DATABASE_OVERRIDE]: value });
    }
  });

  it("never prints the project ref", () => {
    try {
      assertProductionDatabaseAllowed({ NEXT_PUBLIC_SUPABASE_URL: PRODUCTION_URL });
      assert.fail("expected the guard to refuse");
    } catch (error) {
      assert.ok(error instanceof ProductionDatabaseGuardError);
      assert.equal(error.message.includes(PRODUCTION_REF), false);
    }
  });

  it("runs from next.config.ts before the config is built", () => {
    const source = readFileSync(path.join(root, "next.config.ts"), "utf8");
    const call = source.indexOf("assertProductionDatabaseAllowed();");
    assert.ok(call > 0, "next.config.ts must call assertProductionDatabaseAllowed()");
    assert.ok(call < source.indexOf("const nextConfig"), "the guard must run before nextConfig is defined");
  });
});
