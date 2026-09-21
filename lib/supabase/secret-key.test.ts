import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { resolveSupabaseSecretKey } from "./secret-key";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

const originalEnv = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) {
      delete process.env[key];
    }
  }
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  restoreEnv();
});

describe("supabase secret key resolution", () => {
  it("prefers SUPABASE_SECRET_KEY over legacy service role", () => {
    process.env.SUPABASE_SECRET_KEY = "sb_secret_primary";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy_service_role";
    assert.equal(resolveSupabaseSecretKey(), "sb_secret_primary");
  });

  it("falls back to SUPABASE_SERVICE_ROLE_KEY", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "legacy_service_role";
    assert.equal(resolveSupabaseSecretKey(), "legacy_service_role");
  });

  it("returns null when neither key is set", () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    assert.equal(resolveSupabaseSecretKey(), null);
  });

  it("admin helper is server-only and never uses NEXT_PUBLIC secret", () => {
    const admin = readSource("lib/supabase/admin.ts");
    const resolver = readSource("lib/supabase/secret-key.ts");
    assert.match(admin, /import "server-only"/);
    assert.match(admin, /resolveSupabaseSecretKey/);
    assert.match(resolver, /SUPABASE_SECRET_KEY/);
    assert.match(resolver, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.doesNotMatch(admin, /NEXT_PUBLIC_SUPABASE_SECRET|NEXT_PUBLIC_SUPABASE_SERVICE/);
    assert.doesNotMatch(resolver, /NEXT_PUBLIC_/);
  });

  it("env example documents SUPABASE_SECRET_KEY as primary", () => {
    const envExample = readSource(".env.example");
    assert.match(envExample, /SUPABASE_SECRET_KEY=/);
    assert.match(envExample, /SUPABASE_SERVICE_ROLE_KEY=/);
    const secretIdx = envExample.indexOf("SUPABASE_SECRET_KEY=");
    const legacyIdx = envExample.indexOf("SUPABASE_SERVICE_ROLE_KEY=");
    assert.ok(secretIdx >= 0 && legacyIdx >= 0);
    assert.ok(
      secretIdx < legacyIdx,
      "SUPABASE_SECRET_KEY should be documented before legacy key"
    );
    assert.doesNotMatch(envExample, /NEXT_PUBLIC_SUPABASE_SECRET/);
    assert.doesNotMatch(envExample, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE/);
  });
});
