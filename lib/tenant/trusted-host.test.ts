import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { trustedKioskRequestContext } from "@/lib/kiosk/trusted-request";
import {
  HOST_GATE_EXEMPT_PATHS,
  classifyRequestHost,
  isHostGateExemptPath,
  isTrustedAppHost,
  resolveTrustedTenantSlug,
  type HostClassification,
  type TrustedHostEnv,
} from "./trusted-host";
import { untrustedHostResponse } from "./untrusted-host-response";

const root = path.join(import.meta.dirname, "../..");

function readSource(...parts: string[]) {
  return readFileSync(path.join(root, ...parts), "utf8");
}

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(path.join(root, dir))) {
    if (["node_modules", ".next", ".git"].includes(entry)) continue;
    const rel = path.posix.join(dir, entry);
    const stat = statSync(path.join(root, rel));
    if (stat.isDirectory()) {
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

const PROD: TrustedHostEnv = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  NODE_ENV: "production",
};

const PREVIEW: TrustedHostEnv = {
  VERCEL: "1",
  VERCEL_ENV: "preview",
  NODE_ENV: "production",
  TENANT_PREVIEW_BASE_DOMAIN: "preview.app.gestcopy.com",
  VERCEL_URL: "copyflow-abc123-team.vercel.app",
  VERCEL_BRANCH_URL: "copyflow-git-feat-team.vercel.app",
};

const DEV: TrustedHostEnv = { NODE_ENV: "development" };

/** Next.js server (`next start`) outside Vercel. */
const SELF_HOSTED: TrustedHostEnv = { NODE_ENV: "production" };

function h(values: Record<string, string>) {
  return new Headers(values);
}

function both(hostname: string) {
  return h({ host: hostname, "x-forwarded-host": hostname });
}

function reason(result: HostClassification) {
  assert.equal(result.status, "untrusted");
  return result.status === "untrusted" ? result.reason : null;
}

describe("classifyRequestHost — trusted hosts", () => {
  it("accepts a tenant subdomain with and without X-Forwarded-Host", () => {
    for (const headers of [
      h({ host: "sur4.app.gestcopy.com" }),
      both("sur4.app.gestcopy.com"),
      h({
        host: "sur4.app.gestcopy.com:443",
        "x-forwarded-host": "sur4.app.gestcopy.com",
      }),
      both("SUR4.App.Gestcopy.com"),
    ]) {
      assert.deepEqual(classifyRequestHost(headers, PROD), {
        status: "tenant",
        hostname: "sur4.app.gestcopy.com",
        slug: "sur4",
      });
    }
  });

  it("accepts the app host as app, never as tenant", () => {
    assert.deepEqual(classifyRequestHost(both("app.gestcopy.com"), PROD), {
      status: "app",
      hostname: "app.gestcopy.com",
    });
    assert.deepEqual(
      classifyRequestHost(h({ host: "app.gestcopy.com" }), PROD),
      { status: "app", hostname: "app.gestcopy.com" }
    );
  });

  it("works when only Host is present (no assumption about proxy headers)", () => {
    for (const env of [PROD, PREVIEW, SELF_HOSTED, DEV]) {
      assert.equal(
        classifyRequestHost(
          h({ host: env === DEV ? "sur4.localhost:3000" : "sur4.app.gestcopy.com" }),
          env
        ).status,
        "tenant"
      );
    }
  });

  it("leaves tenant existence to the database (slug is only syntactically valid)", () => {
    // An unknown-but-well-formed tenant is classified `tenant`; the lookup in
    // getCurrentTenant (slug + active=true) returns null and callers deny.
    const result = classifyRequestHost(both("does-not-exist.app.gestcopy.com"), PROD);
    assert.equal(result.status, "tenant");
    const source = readSource("lib/tenant/current-tenant.ts");
    assert.match(source, /\.eq\("slug", slug\)/);
    assert.match(source, /\.eq\("active", true\)/);
    assert.match(source, /if \(error \|\| !tenant\) \{\s*return null;/);
  });
});

describe("classifyRequestHost — arbitrary and unauthorized hosts", () => {
  it("rejects arbitrary hosts even when Host and X-Forwarded-Host agree", () => {
    for (const hostname of [
      "evil.test",
      "evil.example",
      "sur4.evil.test",
      "sur4.app.gestcopy.com.evil.test",
      "evilapp.gestcopy.com",
      "evil-app.gestcopy.com",
      "gestcopy.com",
      "www.gestcopy.com",
      "localhost",
      "sur4.localhost",
      "127.0.0.1",
      "203.0.113.8",
    ]) {
      assert.equal(
        reason(classifyRequestHost(both(hostname), PROD)),
        "unauthorized_host",
        hostname
      );
    }
  });

  it("rejects coherent but unauthorized Vercel aliases in Production", () => {
    for (const hostname of [
      "copyflow.vercel.app",
      "copyflow-git-main-team.vercel.app",
      PREVIEW.VERCEL_URL!,
    ]) {
      assert.equal(
        reason(classifyRequestHost(both(hostname), PROD)),
        "unauthorized_host",
        hostname
      );
    }
  });

  it("rejects nested, reserved and malformed-slug hosts under the base domain", () => {
    for (const hostname of [
      "deep.sur4.app.gestcopy.com",
      "app.app.gestcopy.com",
      "sur4.preview.app.gestcopy.com",
      "a--b.app.gestcopy.com",
    ]) {
      assert.equal(
        reason(classifyRequestHost(both(hostname), PROD)),
        "unauthorized_host",
        hostname
      );
    }
  });

  it("classifies unrecognized custom domains as untrusted, never as app or tenant", () => {
    for (const hostname of [
      "app.sur4.es",
      "gestion.copisteriapepe.es",
      "pedidos.imprentarioja.es",
    ]) {
      for (const env of [PROD, PREVIEW, SELF_HOSTED, DEV]) {
        const result = classifyRequestHost(both(hostname), env);
        assert.equal(result.status, "untrusted", `${hostname}`);
        assert.equal(isTrustedAppHost(both(hostname), env), false);
        assert.equal(resolveTrustedTenantSlug(both(hostname), env), null);
      }
    }
  });
});

describe("classifyRequestHost — inconsistent or malformed headers", () => {
  it("rejects a spoofed X-Forwarded-Host that differs from Host", () => {
    // Attacker reaches an authorized host and forges the forwarded header.
    assert.equal(
      reason(
        classifyRequestHost(
          h({
            host: "app.gestcopy.com",
            "x-forwarded-host": "sur4.app.gestcopy.com",
          }),
          PROD
        )
      ),
      "forwarded_host_mismatch"
    );
    // Attacker reaches an unauthorized alias and forges a tenant host.
    assert.equal(
      reason(
        classifyRequestHost(
          h({
            host: "copyflow.vercel.app",
            "x-forwarded-host": "sur4.app.gestcopy.com",
          }),
          PROD
        )
      ),
      "forwarded_host_mismatch"
    );
  });

  it("rejects a forged Host paired with an authorized forwarded host", () => {
    assert.equal(
      reason(
        classifyRequestHost(
          h({
            host: "evil.test",
            "x-forwarded-host": "sur4.app.gestcopy.com",
          }),
          PROD
        )
      ),
      "forwarded_host_mismatch"
    );
  });

  it("rejects malformed, multi-valued and empty headers", () => {
    const cases: Array<[Record<string, string>, string]> = [
      [{ host: "sur4.app.gestcopy.com", "x-forwarded-host": "" }, "malformed_forwarded_host"],
      [
        {
          host: "sur4.app.gestcopy.com",
          "x-forwarded-host": "sur4.app.gestcopy.com,evil.test",
        },
        "malformed_forwarded_host",
      ],
      [
        {
          host: "sur4.app.gestcopy.com",
          "x-forwarded-host": "sur4.app.gestcopy.com@evil.test",
        },
        "malformed_forwarded_host",
      ],
      [
        { host: "sur4.app.gestcopy.com", "x-forwarded-host": "sur4.app.gestcopy.com/x" },
        "malformed_forwarded_host",
      ],
      [{ host: "sur4.app.gestcopy.com@evil.test" }, "malformed_host"],
      [{ host: "sur4.app.gestcopy.com,evil.test" }, "malformed_host"],
      [{ host: "sur4.app.gestcopy.com/path" }, "malformed_host"],
      [{ host: "sur4.app.gestcopy.com evil" }, "malformed_host"],
      [{ host: "[::1]" }, "malformed_host"],
      [{ host: "" }, "missing_host"],
      [{}, "missing_host"],
    ];
    for (const [headers, expected] of cases) {
      assert.equal(
        reason(classifyRequestHost(h(headers), PROD)),
        expected,
        JSON.stringify(headers)
      );
    }
  });

  it("rejects non-default ports outside local development", () => {
    assert.equal(
      reason(classifyRequestHost(h({ host: "sur4.app.gestcopy.com:8443" }), PROD)),
      "unexpected_port"
    );
    assert.equal(
      reason(
        classifyRequestHost(
          h({
            host: "sur4.app.gestcopy.com",
            "x-forwarded-host": "sur4.app.gestcopy.com:8443",
          }),
          PROD
        )
      ),
      "forwarded_host_mismatch"
    );
  });

  it("applies the same consistency rule on self-hosted production", () => {
    assert.equal(
      classifyRequestHost(both("sur4.app.gestcopy.com"), SELF_HOSTED).status,
      "tenant"
    );
    assert.equal(
      reason(
        classifyRequestHost(
          h({
            host: "app.gestcopy.com",
            "x-forwarded-host": "sur4.app.gestcopy.com",
          }),
          SELF_HOSTED
        )
      ),
      "forwarded_host_mismatch"
    );
  });
});

describe("classifyRequestHost — Vercel Preview", () => {
  it("accepts tenants and the app host under the Preview base domain", () => {
    assert.deepEqual(
      classifyRequestHost(both("e2e.preview.app.gestcopy.com"), PREVIEW),
      {
        status: "tenant",
        hostname: "e2e.preview.app.gestcopy.com",
        slug: "e2e",
      }
    );
    assert.deepEqual(
      classifyRequestHost(both("preview.app.gestcopy.com"), PREVIEW),
      { status: "app", hostname: "preview.app.gestcopy.com" }
    );
    assert.equal(
      classifyRequestHost(both("sur4.app.gestcopy.com"), PREVIEW).status,
      "tenant"
    );
  });

  it("accepts only the Vercel-provided deployment URLs as app hosts in Preview", () => {
    for (const hostname of [PREVIEW.VERCEL_URL!, PREVIEW.VERCEL_BRANCH_URL!]) {
      assert.deepEqual(classifyRequestHost(both(hostname), PREVIEW), {
        status: "app",
        hostname,
      });
    }
    assert.equal(
      reason(classifyRequestHost(both("someone-else.vercel.app"), PREVIEW)),
      "unauthorized_host"
    );
  });

  it("rejects a forged forwarded host on a legitimate Preview URL", () => {
    assert.equal(
      reason(
        classifyRequestHost(
          h({
            host: PREVIEW.VERCEL_URL!,
            "x-forwarded-host": "sur4.app.gestcopy.com",
          }),
          PREVIEW
        )
      ),
      "forwarded_host_mismatch"
    );
  });

  it("does not honor Preview domains outside Preview", () => {
    const productionWithPreviewVars: TrustedHostEnv = {
      ...PREVIEW,
      VERCEL_ENV: "production",
    };
    for (const hostname of [
      "e2e.preview.app.gestcopy.com",
      PREVIEW.VERCEL_URL!,
      PREVIEW.VERCEL_BRANCH_URL!,
    ]) {
      assert.equal(
        reason(classifyRequestHost(both(hostname), productionWithPreviewVars)),
        "unauthorized_host",
        hostname
      );
    }
    // Vercel system URL variables are ignored when not running on Vercel.
    assert.equal(
      reason(
        classifyRequestHost(both(PREVIEW.VERCEL_URL!), {
          ...PREVIEW,
          VERCEL: undefined,
        })
      ),
      "unauthorized_host"
    );
  });

  it("does not trust Preview URLs when the platform variables are missing or empty", () => {
    assert.equal(
      reason(
        classifyRequestHost(both("copyflow-abc123-team.vercel.app"), {
          ...PREVIEW,
          VERCEL_URL: undefined,
          VERCEL_BRANCH_URL: "",
        })
      ),
      "unauthorized_host"
    );
  });
});

describe("classifyRequestHost — local development", () => {
  it("allows localhost, 127.0.0.1 and {slug}.localhost with ports", () => {
    assert.deepEqual(classifyRequestHost(h({ host: "localhost:3000" }), DEV), {
      status: "app",
      hostname: "localhost",
    });
    assert.deepEqual(classifyRequestHost(h({ host: "127.0.0.1:3000" }), DEV), {
      status: "app",
      hostname: "127.0.0.1",
    });
    assert.deepEqual(
      classifyRequestHost(h({ host: "sur4.localhost:3000" }), DEV),
      { status: "tenant", hostname: "sur4.localhost", slug: "sur4" }
    );
    assert.equal(
      classifyRequestHost(h({ host: "sur4.app.gestcopy.com" }), DEV).status,
      "tenant"
    );
  });

  it("ignores X-Forwarded-Host in development (Host is the only input)", () => {
    assert.equal(
      resolveTrustedTenantSlug(
        h({
          host: "demo.localhost:3000",
          "x-forwarded-host": "sur4.localhost:3000",
        }),
        DEV
      ),
      "demo"
    );
    assert.equal(
      classifyRequestHost(
        h({ host: "localhost:3000", "x-forwarded-host": "evil.test" }),
        DEV
      ).status,
      "app"
    );
  });

  it("still rejects unknown hosts in development", () => {
    for (const hostname of ["evil.test", "192.168.1.20:3000", "app.sur4.es"]) {
      assert.equal(
        classifyRequestHost(h({ host: hostname }), DEV).status,
        "untrusted",
        hostname
      );
    }
  });

  it("never treats localhost as trusted outside local development", () => {
    for (const env of [
      PROD,
      PREVIEW,
      SELF_HOSTED,
      { NODE_ENV: "test" },
      { NODE_ENV: "development", VERCEL_ENV: "production" },
      { NODE_ENV: "development", VERCEL: "1" },
    ] as TrustedHostEnv[]) {
      for (const host of ["localhost:3000", "sur4.localhost:3000", "127.0.0.1"]) {
        assert.equal(
          classifyRequestHost(h({ host }), env).status,
          "untrusted",
          `${host} ${JSON.stringify(env)}`
        );
      }
    }
  });
});

describe("tenant separation", () => {
  it("resolves the tenant from Host only, and only when headers agree", () => {
    const a = "sur4.app.gestcopy.com";
    const b = "pepe.app.gestcopy.com";

    assert.equal(resolveTrustedTenantSlug(both(a), PROD), "sur4");
    assert.equal(resolveTrustedTenantSlug(both(b), PROD), "pepe");

    // Tenant A's host with tenant B's forwarded host (and vice versa) never
    // resolves to either tenant.
    assert.equal(
      resolveTrustedTenantSlug(h({ host: a, "x-forwarded-host": b }), PROD),
      null
    );
    assert.equal(
      resolveTrustedTenantSlug(h({ host: b, "x-forwarded-host": a }), PROD),
      null
    );
    assert.equal(
      classifyRequestHost(h({ host: a, "x-forwarded-host": b }), PROD).status,
      "untrusted"
    );
  });

  it("does not let an app host or an untrusted host act as a tenant", () => {
    assert.equal(resolveTrustedTenantSlug(both("app.gestcopy.com"), PROD), null);
    assert.equal(resolveTrustedTenantSlug(both("evil.test"), PROD), null);
  });
});

describe("onboarding fail-closed", () => {
  it("is enabled only for a trusted app host", () => {
    assert.equal(isTrustedAppHost(both("app.gestcopy.com"), PROD), true);
    assert.equal(isTrustedAppHost(h({ host: "app.gestcopy.com" }), PROD), true);
    assert.equal(isTrustedAppHost(both("preview.app.gestcopy.com"), PREVIEW), true);
    assert.equal(isTrustedAppHost(both(PREVIEW.VERCEL_URL!), PREVIEW), true);
    assert.equal(isTrustedAppHost(h({ host: "localhost:3000" }), DEV), true);
  });

  it("is refused on tenant hosts", () => {
    assert.equal(isTrustedAppHost(both("sur4.app.gestcopy.com"), PROD), false);
    assert.equal(isTrustedAppHost(both("e2e.preview.app.gestcopy.com"), PREVIEW), false);
    assert.equal(isTrustedAppHost(h({ host: "sur4.localhost:3000" }), DEV), false);
  });

  it("is refused for EVERY untrusted host, including those with no tenant slug", () => {
    // These all resolve to "no slug" in the legacy resolver, which used to be
    // read as "app host" and would have enabled onboarding.
    const untrusted: Array<Record<string, string>> = [
      { host: "evil.test" },
      { host: "app.sur4.es", "x-forwarded-host": "app.sur4.es" },
      { host: "copyflow.vercel.app", "x-forwarded-host": "copyflow.vercel.app" },
      { host: "app.gestcopy.com", "x-forwarded-host": "sur4.app.gestcopy.com" },
      { host: "sur4.app.gestcopy.com", "x-forwarded-host": "app.gestcopy.com" },
      { host: "app.gestcopy.com", "x-forwarded-host": "" },
      { host: "app.gestcopy.com", "x-forwarded-host": "app.gestcopy.com,evil.test" },
      { host: "app.gestcopy.com:8443" },
      { host: "deep.demo.app.gestcopy.com" },
      { host: "app.app.gestcopy.com" },
      { host: "gestcopy.com" },
      { host: "" },
      {},
    ];
    for (const headers of untrusted) {
      assert.equal(
        isTrustedAppHost(h(headers), PROD),
        false,
        JSON.stringify(headers)
      );
    }
  });

  it("is wired into every onboarding entry point", () => {
    for (const file of [
      "app/api/onboarding/route.ts",
      "app/api/onboarding/status/route.ts",
    ]) {
      const source = readSource(file);
      assert.match(source, /isTrustedAppHost\(request\.headers, process\.env\)/, file);
      assert.doesNotMatch(source, /getSubdomainFromHostname/, file);
      assert.doesNotMatch(source, /x-forwarded-host/i, file);
      assert.match(source, /if \(isNotAppHostRequest\(request\)\)/, file);
    }
    for (const file of [
      "app/onboarding/page.tsx",
      "app/onboarding/success/page.tsx",
    ]) {
      const source = readSource(file);
      assert.match(source, /if \(!\(await isOnboardingHostRequest\(\)\)\)/, file);
      assert.doesNotMatch(source, /isTenantHostRequest/, file);
    }
    const host = readSource("lib/tenant/request-host.ts");
    assert.match(host, /result\.status !== "app"/);
  });
});

describe("Preview tenant override", () => {
  it("is reachable only from a trusted app host", () => {
    const source = readSource("lib/tenant/request-host.ts");
    assert.match(
      source,
      /if \(result\.status !== "app" \|\| !isTenantOverrideAllowed\(\)\) \{\s*return null;/
    );
    assert.doesNotMatch(source, /x-forwarded-host/i);
  });
});

describe("proxy host gate", () => {
  it("exempts only an explicit list of exact paths (no prefixes or wildcards)", () => {
    assert.deepEqual([...HOST_GATE_EXEMPT_PATHS].sort(), [
      "/api/internal/files/cleanup",
      "/api/kiosk/orders",
      "/api/webhooks/stripe",
      "/kiosk",
      "/kiosk/",
    ]);
    for (const pathname of HOST_GATE_EXEMPT_PATHS) {
      assert.equal(isHostGateExemptPath(pathname), true, pathname);
    }
    for (const pathname of [
      "/",
      "/orders",
      "/onboarding",
      "/auth/login",
      "/api/orders",
      "/api/onboarding",
      "/api/onboarding/status",
      "/api/billing/checkout-session",
      "/api/tenant",
      "/api/webhooks/stripe/extra",
      "/api/webhooks/stripe/",
      "/api/webhooks",
      "/api/webhooks/other",
      "/api/internal",
      "/api/internal/",
      "/api/internal/files/cleanup/extra",
      "/api/internal/other/job",
      "/api/internalx/y",
      "/kiosk/confirmation",
      "/kioskx",
      "/api/kiosk",
      "/api/kiosk/other",
      "/api/kioskx",
    ]) {
      assert.equal(isHostGateExemptPath(pathname), false, pathname);
    }
  });

  it("a new route under an exempt area is gated until reviewed (list matches the code)", () => {
    function routePaths(dir: string) {
      const out: string[] = [];
      const base = path.join(root, dir);
      for (const entry of readdirSync(base, { recursive: true }) as string[]) {
        if (path.basename(entry) === "route.ts") {
          out.push(
            "/" +
              path.posix.join(
                dir.replace(/^app\//, ""),
                path.dirname(entry).split(path.sep).join("/")
              )
          );
        }
      }
      return out.sort();
    }
    const present = [
      ...routePaths("app/api/internal"),
      ...routePaths("app/api/kiosk"),
      ...routePaths("app/api/webhooks"),
    ];
    assert.deepEqual(present, [
      "/api/internal/files/cleanup",
      "/api/kiosk/orders",
      "/api/webhooks/stripe",
    ]);
    for (const route of present) {
      assert.equal(isHostGateExemptPath(route), true, route);
    }
    // Every exempt API path still has a route file (no dead exemptions).
    for (const route of HOST_GATE_EXEMPT_PATHS.filter((p) => p.startsWith("/api/"))) {
      assert.ok(present.includes(route), route);
    }
    // Kiosk page exemption maps to the real page.
    assert.ok(statSync(path.join(root, "app/kiosk/page.tsx")).isFile());
  });

  it("exempt routes never read the request host", () => {
    for (const file of [
      "app/api/webhooks/stripe/route.ts",
      "app/api/internal/files/cleanup/route.ts",
      "lib/billing/webhook.ts",
    ]) {
      const source = readSource(file);
      assert.doesNotMatch(source, /x-forwarded-host/i, file);
      assert.doesNotMatch(source, /headers\.get\(["']host["']\)/i, file);
      assert.doesNotMatch(source, /tenant\/request-host|tenant\/hostname/, file);
    }
  });

  it("cron endpoint authenticates (timing-safe CRON_SECRET) before any privileged access", () => {
    const source = readSource("app/api/internal/files/cleanup/route.ts");
    const secret = source.indexOf("requireCronSecret()");
    const reject = source.indexOf('{ error: "Unauthorized" }, { status: 401 }');
    const admin = source.indexOf("createAdminClient()");
    assert.match(source, /timingSafeEqual/);
    assert.match(source, /value\.length < 32/);
    assert.match(source, /if \(!authorized\(request, cronSecret\)\)/);
    assert.ok(secret > -1 && reject > secret && admin > reject);
    // Fail closed when the secret is not configured.
    assert.match(source, /Cleanup is not configured/);
    // GET only: no other verb is exported.
    assert.deepEqual(source.match(/export async function (\w+)/g), [
      "export async function GET",
    ]);
  });

  it("Stripe webhook verifies the signature before claiming or processing events", () => {
    const source = readSource("app/api/webhooks/stripe/route.ts");
    const missing = source.indexOf('"Missing stripe-signature"');
    const verify = source.indexOf("constructEvent(");
    const invalid = source.indexOf('"Invalid signature"');
    const claim = source.indexOf("claimWebhookEvent(");
    const process_ = source.indexOf("processStripeEvent(");
    assert.ok(missing > -1 && verify > missing);
    assert.ok(invalid > verify && claim > invalid && process_ > claim);
    assert.deepEqual(source.match(/export async function (\w+)/g), [
      "export async function POST",
    ]);
  });

  it("Kiosk keeps its independent validator and never uses the service role", () => {
    const route = readSource("app/api/kiosk/orders/route.ts");
    assert.match(
      route,
      /trustedKioskRequestContext\(request\.headers, process\.env\)/
    );
    assert.match(route, /if \(!admission\.ok\) \{\s*return admission\.response;/);
    const http = readSource("lib/kiosk/http.ts");
    assert.match(http, /if \(!context\) \{\s*return \{\s*ok: false,\s*response: kioskJson\(\{ error: "Kiosk no disponible" \}, 404\)/);
    assert.match(http, /sec-fetch-site/);
    const page = readSource("proxy.ts");
    assert.match(page, /trustedKioskRequestContext\(request\.headers, process\.env\)/);
    assert.match(page, /return kioskUnavailableResponse\(\)/);
    for (const file of walk("lib/kiosk")) {
      assert.doesNotMatch(readSource(file), /createAdminClient|SERVICE_ROLE|SECRET_KEY/, file);
    }
    assert.doesNotMatch(route, /createAdminClient/);
  });

  it("keeps the updateSession contract intact (response/getAll/setAll/applyTo)", () => {
    const source = readSource("proxy.ts");
    assert.match(source, /const session = await updateSession\(request\)/);
    assert.match(source, /session\.response\.status >= 200/);
    assert.match(source, /return session\.getAll\(\)/);
    assert.match(source, /session\.setAll\(cookiesToSet, headers\)/);
    assert.match(source, /session\.applyTo\(redirect\)/);
    assert.match(source, /return session\.response;/);
    assert.match(source, /resolveInactiveTenantState\(supabase, slug\)/);
    assert.match(source, /reason=/);
  });

  it("rejects untrusted hosts with HTTP 400 before any session work", () => {
    const source = readSource("proxy.ts");
    const gate = source.indexOf("classifyRequestHost(request.headers, process.env)");
    const reject = source.indexOf("return untrustedHostResponse();");
    const session = source.indexOf("await updateSession(request)");
    const kiosk = source.indexOf("loadKioskBootstrap(context)");
    assert.ok(kiosk > -1 && gate > kiosk, "Kiosk block runs first and is unchanged");
    assert.ok(gate > -1 && reject > gate && session > reject);
    assert.match(
      source,
      /hostClassification\.status === "untrusted" &&\s*!isHostGateExemptPath/
    );
    assert.doesNotMatch(source, /x-forwarded-host/i);
    assert.doesNotMatch(source, /getSubdomainFromHostname/);

    const response = readSource("lib/tenant/untrusted-host-response.ts");
    assert.match(response, /status: 400/);
    // Static body: nothing from the request is reflected back.
    assert.match(response, /export function untrustedHostResponse\(\)/);
    assert.doesNotMatch(response, /headers\.get|nextUrl|\$\{/);
  });
});

describe("untrusted host response", () => {
  it("is a static HTTP 400 that reflects nothing and is never cached", async () => {
    const response = untrustedHostResponse();
    assert.equal(response.status, 400);
    assert.equal(await response.text(), "Bad Request");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  });
});

describe("single hostname implementation", () => {
  const allowed = new Set([
    "lib/tenant/trusted-host.ts",
    // Pre-existing, intentionally untouched / different purpose:
    "lib/kiosk/trusted-request.ts",
    "lib/tenant/request-origin.ts",
    "lib/tenant/trusted-origin.ts",
  ]);

  it("no other module reads X-Forwarded-Host", () => {
    const files = [...walk("app"), ...walk("lib"), ...walk("components"), "proxy.ts"];
    const offenders = files.filter(
      (file) =>
        !allowed.has(file) &&
        /x-forwarded-host/i.test(readSource(file))
    );
    assert.deepEqual(offenders, []);
  });

  it("no tenant resolution path calls the legacy slug-only resolver", () => {
    const files = [...walk("app"), ...walk("components"), "proxy.ts"];
    const offenders = files.filter((file) =>
      /getSubdomainFromHostname/.test(readSource(file))
    );
    assert.deepEqual(offenders, []);
  });
});

describe("Kiosk parity", () => {
  it("never accepts a host that the shared classifier rejects", () => {
    const env = { VERCEL: "1", NODE_ENV: "production" } as const;
    const cases: Array<Record<string, string>> = [
      {
        host: "demo.app.gestcopy.com",
        "x-forwarded-host": "demo.app.gestcopy.com",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
      {
        host: "demo.app.gestcopy.com",
        "x-forwarded-host": "sur4.app.gestcopy.com",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
      {
        host: "deep.demo.app.gestcopy.com",
        "x-forwarded-host": "deep.demo.app.gestcopy.com",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
      {
        host: "demo.app.gestcopy.com@evil.test",
        "x-forwarded-host": "demo.app.gestcopy.com@evil.test",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
      {
        host: "demo.evil.test",
        "x-forwarded-host": "demo.evil.test",
        "x-vercel-forwarded-for": "203.0.113.8",
      },
    ];
    for (const value of cases) {
      const headers = h(value);
      const kiosk = trustedKioskRequestContext(headers, env);
      const shared = classifyRequestHost(headers, PROD);
      if (kiosk) {
        assert.equal(shared.status, "tenant");
        assert.equal(shared.status === "tenant" ? shared.slug : null, kiosk.tenantSlug);
      }
    }
    // The legitimate Kiosk request is accepted by both.
    assert.equal(
      trustedKioskRequestContext(h(cases[0]), env)?.tenantSlug,
      "demo"
    );
    assert.equal(resolveTrustedTenantSlug(h(cases[0]), PROD), "demo");
  });
});
