import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import ts from "typescript";
import * as operationalCache from "../http/operational-cache";
import * as accessHttp from "../tenant/access-http";
import { sessionExpiredFailure } from "../tenant/access";
import * as quotesAccess from "../quotes/access";
import * as branding from "../tenant/branding";
import * as earlyAccess from "./early-access";
import * as earlyAccessServer from "./early-access-server";
import * as tenantHasFeature from "./tenant-has-feature";

type FeatureAnswer = boolean | "error" | "throw";

const CONTEXT = {
  user: { id: "user-a", email: "owner@example.test" },
  tenant: { id: "tenant-a", name: "Copistería A", slug: "a" },
  membership: { role: "viewer", active: true },
};

function harness(options: {
  context?: typeof CONTEXT | null;
  quotes?: FeatureAnswer;
  pro?: FeatureAnswer;
}) {
  const calls: Array<Record<string, unknown>> = [];
  const answer = (value: FeatureAnswer) => {
    if (value === "throw") throw new Error("network down");
    if (value === "error") return { data: null, error: { code: "42501", message: "denied" } };
    return { data: value, error: null };
  };
  const supabase = {
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ name, ...args });
      if (args.p_code === "quotes") return answer(options.quotes ?? false);
      if (args.p_code === "pro_early_access") return answer(options.pro ?? false);
      return answer(true);
    },
  };
  const dependencies: Record<string, unknown> = {
    "@/lib/features/early-access": earlyAccess,
    "@/lib/features/early-access-server": earlyAccessServer,
    "@/lib/features/tenant-has-feature": tenantHasFeature,
    "@/lib/http/operational-cache": operationalCache,
    "@/lib/quotes/access": quotesAccess,
    "@/lib/supabase/server": { createClient: async () => supabase },
    "@/lib/team/current-member": { resolveCurrentTeamMember: async () => null },
    "@/lib/tenant/branding": branding,
    "@/lib/tenant/organization": { loadOrganizationSettings: async () => null },
    // PR #94: session/tenant/membership guard with 401/403/503 responses.
    "@/lib/tenant/access-response": {
      requireCurrentAccess: async (route: string) => {
        const context = options.context === undefined ? CONTEXT : options.context;
        return context
          ? { ok: true, context }
          : { ok: false, response: accessHttp.accessFailureResponse(sessionExpiredFailure(), route) };
      },
    },
  };
  const filename = new URL("../../app/api/context/route.ts", import.meta.url);
  const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const routeModule = { exports: {} as Record<string, () => Promise<Response>> };
  const nativeRequire = createRequire(import.meta.url);
  new Function("require", "module", "exports", compiled)(
    (name: string) => {
      if (name.startsWith("@/") && !(name in dependencies)) {
        throw new Error(`unexpected dependency ${name}`);
      }
      return dependencies[name] ?? nativeRequire(name);
    },
    routeModule,
    routeModule.exports
  );
  return { calls, get: () => routeModule.exports.GET() };
}

function assertPrivate(response: Response) {
  assert.equal(
    response.headers.get("Cache-Control"),
    "private, no-store, max-age=0, must-revalidate"
  );
}

describe("GET /api/context · early access", () => {
  it("denies without session, active tenant or membership before any feature RPC", async () => {
    const h = harness({ context: null, pro: true, quotes: true });
    const response = await h.get();
    assert.equal(response.status, 401);
    assert.match(response.headers.get("Cache-Control") ?? "", /\bprivate\b.*\bno-store\b/);
    const body = await response.json();
    assert.equal("early_access" in body, false);
    assert.equal(h.calls.length, 0);
  });

  it("reports the program and voice as planned for an enrolled tenant", async () => {
    const h = harness({ pro: true, quotes: false });
    const response = await h.get();
    assert.equal(response.status, 200);
    assertPrivate(response);
    const body = await response.json();
    assert.deepEqual(body.early_access, {
      pro: true,
      voice_orders: { status: "planned" },
    });
    assert.deepEqual(body.features, { quotes: false });
  });

  it("hides the program for a tenant that is not enrolled, without voice details", async () => {
    const response = await harness({ pro: false, quotes: true }).get();
    const body = await response.json();
    assert.deepEqual(body.early_access, { pro: false });
    assert.deepEqual(body.features, { quotes: true });
  });

  it("fails closed on RPC errors or exceptions and keeps quotes independent", async () => {
    for (const pro of ["error", "throw"] as const) {
      for (const quotes of [true, false]) {
        const response = await harness({ pro, quotes }).get();
        assert.equal(response.status, 200);
        assertPrivate(response);
        const body = await response.json();
        assert.deepEqual(body.early_access, { pro: false });
        assert.deepEqual(body.features, { quotes });
      }
    }
  });

  it("resolves only the session tenant and never the voice flag or billing", async () => {
    const h = harness({ pro: true, quotes: true });
    const body = await (await h.get()).json();
    assert.deepEqual(
      h.calls.map((call) => [call.name, call.p_tenant_id, call.p_code]).sort(),
      [
        ["tenant_has_feature", "tenant-a", "pro_early_access"],
        ["tenant_has_feature", "tenant-a", "quotes"],
      ]
    );
    assert.deepEqual(Object.keys(body).sort(), [
      "early_access",
      "features",
      "membership",
      "team_member",
      "tenant",
      "user",
    ]);
  });
});
