/**
 * Release gate: every API route authenticates before touching tenant data.
 *
 * A route passes when its own source calls a recognised guard. Routes that
 * are public by design, or that delegate to a guarded helper, must be listed
 * below with the reason; adding a route without a guard fails CI.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "../..");
const apiRoot = path.join(root, "app", "api");

/** Session- and tenant-bound guards (resolve user + active membership). */
const TENANT_GUARDS = [
  /\bgetCurrentContext\s*\(/,
  /\brequireQuotesAccess\s*\(/,
  /\brequireOrganizationEditor\s*\(/,
  // lib/tenant/access-response.ts: session + active tenant + active membership,
  // answering 401/403/503 instead of a single 403 (PR #94).
  /\brequireCurrentAccess\s*\(/,
];

/** Guards for routes that are not tenant-session bound. */
const OTHER_GUARDS: Record<string, RegExp> = {
  session: /\bauth\.getUser\s*\(/,
  cron: /\bCRON_SECRET\b[\s\S]*\btimingSafeEqual\b/,
  stripeSignature: /\bwebhooks\.constructEvent\s*\(/,
};

/**
 * Explicit exceptions. Key: route path relative to app/api.
 * `delegate`: module that must contain a tenant guard.
 * `public`: reason the route is intentionally unauthenticated.
 */
const EXCEPTIONS: Record<string, { delegate: string } | { public: string }> = {
  "quotes/[id]/accept/route.ts": { delegate: "lib/quotes/transitions.ts" },
  "quotes/[id]/reject/route.ts": { delegate: "lib/quotes/transitions.ts" },
  "quotes/[id]/send/route.ts": { delegate: "lib/quotes/transitions.ts" },
  "invitations/preview/route.ts": {
    public: "invitation token preview; anon RPC preview_tenant_invitation validates the token",
  },
  "invitations/signup/route.ts": {
    public: "signup from a pending invitation token; RPCs validate token and email",
  },
  "kiosk/orders/route.ts": {
    public: "public kiosk; trustedKioskRequestContext + HMAC admission in kiosk RPCs",
  },
};

/** Routes allowed to construct the service_role client. */
const ADMIN_CLIENT_ROUTES = new Set([
  "billing/subscription/route.ts",
  "internal/files/cleanup/route.ts",
  "invitations/signup/route.ts",
  "onboarding/status/route.ts",
]);

function listRoutes(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return listRoutes(full);
    return entry === "route.ts" ? [path.relative(apiRoot, full).split(path.sep).join("/")] : [];
  });
}

const routes = listRoutes(apiRoot).sort();
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const hasTenantGuard = (source: string) => TENANT_GUARDS.some((g) => g.test(source));
const hasOtherGuard = (source: string) => Object.values(OTHER_GUARDS).some((g) => g.test(source));

describe("API route authentication contract", () => {
  it("discovers the API surface", () => {
    assert.ok(routes.length >= 80, `only ${routes.length} routes found`);
  });

  it("every route calls a guard or is an explicit, justified exception", () => {
    const unguarded = routes.filter((route) => {
      const source = read(path.join("app/api", route));
      if (hasTenantGuard(source) || hasOtherGuard(source)) return false;
      const exception = EXCEPTIONS[route];
      if (!exception) return true;
      if ("delegate" in exception) return !hasTenantGuard(read(exception.delegate));
      return exception.public.trim().length < 20;
    });
    assert.deepEqual(unguarded, [], "add a guard (getCurrentContext, requireQuotesAccess, ...) or a justified EXCEPTIONS entry");
  });

  it("delegating routes really call their guarded helper", () => {
    for (const [route, exception] of Object.entries(EXCEPTIONS)) {
      if (!("delegate" in exception)) continue;
      const source = read(path.join("app/api", route));
      const importPath = exception.delegate.replace(/^lib\//, "@/lib/").replace(/\.ts$/, "");
      assert.ok(source.includes(`"${importPath}"`), `${route} must import ${importPath}`);
    }
  });

  it("exceptions do not go stale", () => {
    for (const route of Object.keys(EXCEPTIONS)) {
      assert.ok(routes.includes(route), `stale exception ${route}`);
    }
    for (const route of ADMIN_CLIENT_ROUTES) {
      assert.ok(routes.includes(route), `stale admin-client entry ${route}`);
    }
  });

  it("only allowlisted routes use the service_role client", () => {
    const offenders = routes.filter((route) => {
      const source = read(path.join("app/api", route));
      return /\bcreateAdminClient\b/.test(source) && !ADMIN_CLIENT_ROUTES.has(route);
    });
    assert.deepEqual(offenders, []);
  });

  it("the service_role client is never imported by client components", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(tsx?|jsx?)$/.test(entry)) {
          const source = readFileSync(full, "utf8");
          if (/^\s*["']use client["']/m.test(source) && /lib\/supabase\/admin|lib\/storage\/r2/.test(source)) {
            offenders.push(path.relative(root, full));
          }
        }
      }
    };
    for (const dir of ["app", "components", "lib"]) walk(path.join(root, dir));
    assert.deepEqual(offenders, []);
  });
});
