/**
 * Staging E2E safety interlock. Every entry point (seed, runner) calls
 * `resolveStagingTarget` before any network access and refuses to run
 * against Production or an ambiguous configuration.
 *
 * Supabase project refs are compared by SHA-256 so no ref is committed
 * outside docs/ (release gate rule, ci/release-gate/production-safety.ts).
 */
import { createHash } from "node:crypto";

const STAGING_SUPABASE_REF_SHA256 = "1ed7ef14691983eb74c525e6cd3aaf55da28d3a00fd65f9fb0a75d3790a15683";
const PRODUCTION_SUPABASE_REF_SHA256 = "fc465d69aa2021e82beadd00350a2ad1aae651a61d2e4ea94ccf3aa208e9ef35";

export const STAGING_R2_BUCKET = "gestcopy-files-staging";
const PRODUCTION_R2_BUCKETS = new Set(["gestcopy-files"]);

export const E2E_TENANT_SLUG = "e2e";
const PREVIEW_BASE_DOMAIN = "preview.app.gestcopy.com";
/** Staging tenants the suite must never touch. Production tenants are never under the preview base. */
const FOREIGN_SLUGS = new Set(["demo", "audit", "sur4", "www", "app"]);
const PRODUCTION_HOSTS = [/(^|\.)app\.gestcopy\.com$/, /(^|\.)gestcopy\.com$/, /(^|\.)copyflow\.com$/];

export type StagingTarget = {
  baseUrl: string;
  host: string;
  supabaseUrl: string;
  supabaseHost: string;
  r2Bucket: string;
  /**
   * SUR4 E10 `staging-branch` mode only: the tenant chosen with the Preview
   * override (`?tenant=` → cookie `gc_preview_tenant`) on the branch URL.
   */
  previewTenant?: string;
};

export class StagingGuardError extends Error {
  constructor(message: string) {
    super(`E2E staging guard: ${message}`);
    this.name = "StagingGuardError";
  }
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new StagingGuardError(`${name} is required`);
  return value;
}

function parseHttps(name: string, value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StagingGuardError(`${name} is not a valid URL`);
  }
  if (url.protocol !== "https:") throw new StagingGuardError(`${name} must use https`);
  if (url.username || url.password || url.port) throw new StagingGuardError(`${name} must not carry credentials or a port`);
  if (url.pathname !== "/" || url.search || url.hash) throw new StagingGuardError(`${name} must be an origin only`);
  return url;
}

/** `true` only for the Staging Supabase project; Production is rejected explicitly. */
export function classifySupabaseHost(host: string): "staging" | "production" | "unknown" {
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(host);
  if (!match) return "unknown";
  const digest = sha256(match[1]);
  if (digest === PRODUCTION_SUPABASE_REF_SHA256) return "production";
  if (digest === STAGING_SUPABASE_REF_SHA256) return "staging";
  return "unknown";
}

/** Path-style presigned R2 URL (`forcePathStyle: true` in lib/storage/r2.ts): first path segment is the bucket. */
export function r2BucketFromUrl(url: string): string | null {
  const parsed = new URL(url);
  if (!parsed.hostname.endsWith(".r2.cloudflarestorage.com")) return null;
  return decodeURIComponent(parsed.pathname.split("/")[1] ?? "") || null;
}

export function isProductionHost(host: string): boolean {
  if (host === `${E2E_TENANT_SLUG}.${PREVIEW_BASE_DOMAIN}`) return false;
  if (host.endsWith(`.${PREVIEW_BASE_DOMAIN}`)) return false;
  if (classifySupabaseHost(host) === "production") return true;
  return PRODUCTION_HOSTS.some((pattern) => pattern.test(host));
}

type Backend = { supabaseUrl: string; supabaseHost: string; r2Bucket: string };

/** Staging Supabase project and R2 bucket, and nothing in the environment that disagrees. */
function stagingBackend(env: Env): Backend {
  const supabase = parseHttps("E2E_SUPABASE_URL", required(env, "E2E_SUPABASE_URL"));
  const kind = classifySupabaseHost(supabase.hostname);
  if (kind === "production") throw new StagingGuardError("E2E_SUPABASE_URL points to Production");
  if (kind !== "staging") throw new StagingGuardError("E2E_SUPABASE_URL is not the Staging project");

  const bucket = required(env, "E2E_R2_BUCKET");
  if (PRODUCTION_R2_BUCKETS.has(bucket)) throw new StagingGuardError("E2E_R2_BUCKET is the Production bucket");
  if (bucket !== STAGING_R2_BUCKET) throw new StagingGuardError(`E2E_R2_BUCKET must be ${STAGING_R2_BUCKET}`);

  refuseAmbiguity(env, supabase.origin);
  if (env.VERCEL_ENV === "production") throw new StagingGuardError("refusing to run with VERCEL_ENV=production");
  return { supabaseUrl: supabase.origin, supabaseHost: supabase.hostname, r2Bucket: bucket };
}

/** A Production Supabase key or URL in the same environment makes the run ambiguous. */
function refuseAmbiguity(env: Env, supabaseOrigin: string) {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]) {
    const value = env[name]?.trim();
    if (value && value.replace(/\/$/, "") !== supabaseOrigin) {
      throw new StagingGuardError(`${name} disagrees with E2E_SUPABASE_URL`);
    }
  }
}

export function resolveStagingTarget(env: Env = process.env): StagingTarget {
  const base = parseHttps("E2E_BASE_URL", required(env, "E2E_BASE_URL"));
  const expectedHost = `${E2E_TENANT_SLUG}.${PREVIEW_BASE_DOMAIN}`;
  const slug = base.hostname.endsWith(`.${PREVIEW_BASE_DOMAIN}`)
    ? base.hostname.slice(0, -(PREVIEW_BASE_DOMAIN.length + 1))
    : null;
  if (slug && FOREIGN_SLUGS.has(slug)) throw new StagingGuardError(`tenant ${slug} is not the e2e tenant`);
  if (base.hostname !== expectedHost) {
    throw new StagingGuardError(`E2E_BASE_URL must be https://${expectedHost}`);
  }

  return { baseUrl: base.origin, host: base.hostname, ...stagingBackend(env) };
}

/**
 * SUR4 E10 (contract §11): the four synthetic tenants of the feature matrix.
 * Their hosts are derived here, never read from the environment, so a run can
 * only reach these tenants (and `demo`, `audit`, `sur4`, `e2e` never).
 */
export const SUR4_TENANT_SLUGS = [
  "e2e-sur4-base",
  "e2e-sur4-postits",
  "e2e-sur4-secuencia",
  "e2e-sur4-completo",
] as const;
export type Sur4TenantSlug = (typeof SUR4_TENANT_SLUGS)[number];

export type Sur4Mode = "staging" | "staging-branch" | "local";

export type Sur4Targets = {
  /**
   * `staging`: one Preview host per tenant (`{slug}.preview.app.gestcopy.com`).
   * `staging-branch`: the `gestcopy-staging` branch URL (`*.vercel.app`) for
   * every tenant, each chosen with the Preview override `?tenant=`. It needs no
   * tenant host; E10 uses it to test isolation when the tenant switches.
   * `local`: `{slug}.localhost` + a local Supabase stack.
   */
  mode: Sur4Mode;
  supabaseUrl: string;
  supabaseHost: string;
  tenants: Record<Sur4TenantSlug, StagingTarget>;
};

const LOCAL_SUPABASE = /^http:\/\/127\.0\.0\.1:(\d{2,5})$/;
/** Vercel branch alias of `gestcopy-staging` in project `copyflow`: `copyflow-git-gestcopy-staging-<team>.vercel.app`. */
const STAGING_BRANCH_HOST = /^copyflow-git-gestcopy-staging-[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app$/;

/**
 * Staging by default. `E2E_SUR4_MODE=local` targets only loopback: the app on
 * `http://{slug}.localhost:{E2E_SUR4_LOCAL_PORT}` and Supabase on
 * `http://127.0.0.1:{port}`, with no R2 bucket (every R2 request is blocked).
 */
export function resolveSur4Targets(env: Env = process.env): Sur4Targets {
  const mode = env.E2E_SUR4_MODE?.trim() || "staging";
  if (mode !== "staging" && mode !== "staging-branch" && mode !== "local") {
    throw new StagingGuardError("E2E_SUR4_MODE must be staging, staging-branch or local");
  }

  let backend: Backend;
  let baseFor: (slug: Sur4TenantSlug) => string;
  if (mode === "staging") {
    backend = stagingBackend(env);
    baseFor = (slug) => `https://${slug}.${PREVIEW_BASE_DOMAIN}`;
  } else if (mode === "staging-branch") {
    backend = stagingBackend(env);
    const branch = parseHttps("E2E_SUR4_BRANCH_URL", required(env, "E2E_SUR4_BRANCH_URL"));
    if (!STAGING_BRANCH_HOST.test(branch.hostname)) {
      throw new StagingGuardError("E2E_SUR4_BRANCH_URL must be the gestcopy-staging branch URL (copyflow-git-gestcopy-staging-<team>.vercel.app)");
    }
    baseFor = () => branch.origin;
  } else {
    if (env.VERCEL_ENV) throw new StagingGuardError("local mode refuses to run with VERCEL_ENV set");
    const supabaseUrl = required(env, "E2E_SUPABASE_URL").replace(/\/$/, "");
    if (!LOCAL_SUPABASE.test(supabaseUrl)) {
      throw new StagingGuardError("local mode needs E2E_SUPABASE_URL=http://127.0.0.1:<port>");
    }
    refuseAmbiguity(env, supabaseUrl);
    const port = required(env, "E2E_SUR4_LOCAL_PORT");
    if (!/^\d{2,5}$/.test(port)) throw new StagingGuardError("E2E_SUR4_LOCAL_PORT must be a port number");
    backend = { supabaseUrl, supabaseHost: "127.0.0.1", r2Bucket: "" };
    baseFor = (slug) => `http://${slug}.localhost:${port}`;
  }

  const tenants = Object.fromEntries(
    SUR4_TENANT_SLUGS.map((slug) => {
      const name: string = slug;
      if (FOREIGN_SLUGS.has(name) || name === E2E_TENANT_SLUG) throw new StagingGuardError(`tenant ${slug} is reserved`);
      const base = new URL(baseFor(slug));
      const target: StagingTarget = { baseUrl: base.origin, host: base.hostname, ...backend };
      if (mode === "staging-branch") target.previewTenant = slug;
      return [slug, target];
    }),
  ) as Record<Sur4TenantSlug, StagingTarget>;
  return { mode, supabaseUrl: backend.supabaseUrl, supabaseHost: backend.supabaseHost, tenants };
}

/**
 * Browser egress policy: the e2e tenant host, the Staging Supabase project and
 * the Staging R2 bucket. Anything recognisably Production is a hard failure.
 */
export function classifyRequest(target: StagingTarget, url: string): "allow" | "production" | "foreign" {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "foreign";
  }
  if (parsed.protocol === "data:" || parsed.protocol === "blob:") return "allow";
  const host = parsed.hostname;
  if (host === target.host) return "allow";
  if (host === target.supabaseHost) return "allow";
  const bucket = r2BucketFromUrl(url);
  if (bucket !== null) {
    if (PRODUCTION_R2_BUCKETS.has(bucket)) return "production";
    return bucket === target.r2Bucket ? "allow" : "foreign";
  }
  if (isProductionHost(host)) return "production";
  return "foreign";
}
