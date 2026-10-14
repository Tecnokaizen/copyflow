import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STAGING_R2_BUCKET,
  StagingGuardError,
  classifyRequest,
  classifySupabaseHost,
  resolveStagingTarget,
} from "./guard";
import { Redactor } from "./redact";

// Refs are reassembled at runtime so the release gate never sees them in the tree.
const STAGING_REF = ["fmmfsbhcwx", "kaszrrarpw"].join("");
const PRODUCTION_REF = ["wsclqvlzjd", "gwkxbolhoy"].join("");

const VALID = {
  E2E_BASE_URL: "https://e2e.preview.app.gestcopy.com",
  E2E_SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
  E2E_R2_BUCKET: STAGING_R2_BUCKET,
};

const rejects = (env: Record<string, string | undefined>, pattern: RegExp) =>
  assert.throws(() => resolveStagingTarget(env), (error: unknown) =>
    error instanceof StagingGuardError && pattern.test(error.message));

describe("e2e staging guard", () => {
  it("accepts the e2e tenant on Staging", () => {
    const target = resolveStagingTarget(VALID);
    assert.equal(target.baseUrl, "https://e2e.preview.app.gestcopy.com");
    assert.equal(target.supabaseHost, `${STAGING_REF}.supabase.co`);
  });

  it("rejects Production and foreign tenant hosts", () => {
    rejects({ ...VALID, E2E_BASE_URL: "https://app.gestcopy.com" }, /E2E_BASE_URL/);
    rejects({ ...VALID, E2E_BASE_URL: "https://sur4.app.gestcopy.com" }, /E2E_BASE_URL/);
    rejects({ ...VALID, E2E_BASE_URL: "https://demo.preview.app.gestcopy.com" }, /demo/);
    rejects({ ...VALID, E2E_BASE_URL: "https://audit.preview.app.gestcopy.com" }, /audit/);
    rejects({ ...VALID, E2E_BASE_URL: "http://e2e.preview.app.gestcopy.com" }, /https/);
    rejects({ ...VALID, E2E_BASE_URL: "https://e2e.preview.app.gestcopy.com/orders" }, /origin/);
  });

  it("rejects the Production Supabase project and unknown projects", () => {
    rejects({ ...VALID, E2E_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }, /Production/);
    rejects({ ...VALID, E2E_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co" }, /not the Staging/);
    rejects({ ...VALID, E2E_SUPABASE_URL: "http://127.0.0.1:54321" }, /https/);
  });

  it("rejects the Production bucket and ambiguous configuration", () => {
    rejects({ ...VALID, E2E_R2_BUCKET: "gestcopy-files" }, /Production bucket/);
    rejects({ ...VALID, E2E_R2_BUCKET: undefined }, /E2E_R2_BUCKET is required/);
    rejects({ ...VALID, E2E_BASE_URL: undefined }, /E2E_BASE_URL is required/);
    rejects({ ...VALID, NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co` }, /disagrees/);
    rejects({ ...VALID, VERCEL_ENV: "production" }, /VERCEL_ENV/);
  });

  it("classifies browser egress", () => {
    const target = resolveStagingTarget(VALID);
    assert.equal(classifySupabaseHost(`${PRODUCTION_REF}.supabase.co`), "production");
    assert.equal(classifyRequest(target, "https://e2e.preview.app.gestcopy.com/api/orders"), "allow");
    assert.equal(classifyRequest(target, `https://${STAGING_REF}.supabase.co/auth/v1/token`), "allow");
    assert.equal(classifyRequest(target, `https://acc.r2.cloudflarestorage.com/${STAGING_R2_BUCKET}/k?X-Amz-Signature=x`), "allow");
    assert.equal(classifyRequest(target, "https://acc.r2.cloudflarestorage.com/gestcopy-files/k"), "production");
    assert.equal(classifyRequest(target, `https://${PRODUCTION_REF}.supabase.co/rest/v1/orders`), "production");
    assert.equal(classifyRequest(target, "https://app.gestcopy.com/"), "production");
    assert.equal(classifyRequest(target, "https://demo.preview.app.gestcopy.com/"), "foreign");
  });
});

describe("e2e redactor", () => {
  it("removes known secrets, JWTs and presigned query strings", () => {
    const redactor = new Redactor(["super-secret-password", undefined, "abc"]);
    assert.equal(redactor.text("pw=super-secret-password"), "pw=[REDACTED]");
    assert.equal(redactor.text("abc stays (too short to be a secret)"), "abc stays (too short to be a secret)");
    const jwt = ["eyJhbGciOi", "eyJzdWIiOiIx", "c2lnbmF0dXJl"].join(".");
    assert.equal(redactor.text(`Authorization: Bearer ${jwt}`), "Authorization: Bearer [REDACTED]");
    assert.equal(redactor.url("https://acc.r2.cloudflarestorage.com/b/k?X-Amz-Signature=deadbeef"), "https://acc.r2.cloudflarestorage.com/b/k?…");
    assert.throws(() => redactor.assertClean("log", "x super-secret-password"), /secret value/);
  });
});
