/**
 * Gestcopy AI · Pedidos por voz (#90) against the real Staging deployment
 * (Preview, tenant e2e), provider `fake` only. Same guard, egress interlock
 * and redaction as run.ts. The runner never receives service_role and never
 * changes flags or limits: the operator prepares each state BEFORE launching
 * (docs/VOICE-ORDERS-AI-V1.md, «E2E en Preview»).
 *
 *   E2E_VOICE_EXPECT=on|off|kill_switch|budget_exhausted PLAYWRIGHT_MODULE=… \
 *   E2E_BASE_URL=… E2E_SUPABASE_URL=… E2E_R2_BUCKET=… \
 *   E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
 *   [E2E_VIEWER_EMAIL=… E2E_VIEWER_PASSWORD=…] [VERCEL_AUTOMATION_BYPASS_SECRET=…] \
 *   npx tsx e2e/staging/voice-orders.ts
 *
 * on: API contracts; typed draft + «Descartar» at 1440 px and on a 390 px
 * touch device; a typed field kept, «Reemplazar» and «Descartar» back to it;
 * recorded draft with a synthetic microphone stream and one order
 * created by the user's own click; viewer denied. Every flow asserts that no
 * request writes /api/orders before that click.
 */
import path from "node:path";
import { resolveStagingTarget, E2E_TENANT_SLUG } from "./guard";
import { Harness } from "./harness";
import { Redactor } from "./redact";
import { requireSyntheticEmail, runId } from "./synthetic";
import {
  MOBILE_CONTEXT,
  apiContracts,
  budgetExhausted,
  closedModule,
  login,
  parseVoiceExpectation,
  recordedDraftThenHumanCreate,
  touchedFieldReplaceAndDiscard,
  typedDraftAndDiscard,
  viewerDenied,
  watchMicrophone,
  type VoiceExpectation,
} from "./voice-flows";

type Account = { name: "owner" | "viewer"; email: string; password: string };
type Result = { run: string; status: "passed" | "failed"; ms: number; error?: string };

function refuse(error: unknown): never {
  console.error(`[e2e-voice] REFUSED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

let target: ReturnType<typeof resolveStagingTarget>;
let expect: VoiceExpectation;
const accounts: Account[] = [];
try {
  target = resolveStagingTarget();
  expect = parseVoiceExpectation(process.env.E2E_VOICE_EXPECT);
  if (!process.env.E2E_USER_PASSWORD) throw new Error("E2E_USER_PASSWORD is required");
  accounts.push({
    name: "owner",
    email: requireSyntheticEmail(process.env.E2E_USER_EMAIL),
    password: process.env.E2E_USER_PASSWORD,
  });
  if (process.env.E2E_VIEWER_EMAIL || process.env.E2E_VIEWER_PASSWORD) {
    if (!process.env.E2E_VIEWER_PASSWORD) throw new Error("E2E_VIEWER_PASSWORD is required with E2E_VIEWER_EMAIL");
    accounts.push({
      name: "viewer",
      email: requireSyntheticEmail(process.env.E2E_VIEWER_EMAIL),
      password: process.env.E2E_VIEWER_PASSWORD,
    });
  }
} catch (error) {
  refuse(error);
}

const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined;
const redactor = new Redactor([...accounts.map((account) => account.password), bypass]);
const id = runId();
const artifactsDir = process.env.E2E_ARTIFACTS_DIR ?? path.join(process.cwd(), "e2e-artifacts", `voice-${id}`);
const playwright = process.env.PLAYWRIGHT_MODULE || "playwright";

async function session(
  name: string,
  account: Account,
  options: Parameters<Harness["start"]>[1],
  flow: (h: Harness) => Promise<void>
): Promise<Result> {
  const started = Date.now();
  const h = new Harness(target, redactor, path.join(artifactsDir, name), bypass);
  let result: Result = { run: name, status: "passed", ms: 0 };
  try {
    await h.start(playwright, options);
    await watchMicrophone(h.page);
    await login(h, target.baseUrl, name, account.email, account.password);
    await flow(h);
    h.assertNoProductionEgress();
  } catch (error) {
    result = {
      ...result,
      status: "failed",
      error: redactor.text(error instanceof Error ? error.message : String(error)).slice(0, 1000),
    };
  } finally {
    result.ms = Date.now() - started;
    h.log(`${result.status.toUpperCase()} ${name} (${result.ms} ms)${result.error ? ` — ${result.error}` : ""}`);
    await h.finish({ runId: id, expect, ...result }).catch((error: unknown) => {
      result = { ...result, status: "failed", error: `artifacts: ${String(error)}` };
    });
  }
  return result;
}

const owner = accounts[0];
const viewer = accounts.find((account) => account.name === "viewer");
const desktop = {};
const mobile = { context: MOBILE_CONTEXT };
const results: Result[] = [];

if (expect === "on") {
  results.push(
    await session("owner-desktop", owner, desktop, async (h) => {
      await apiContracts(h, target.baseUrl, E2E_TENANT_SLUG, "owner desktop");
      await typedDraftAndDiscard(h, target.baseUrl, id, "owner desktop");
      await touchedFieldReplaceAndDiscard(h, target.baseUrl, id, "owner desktop");
      await recordedDraftThenHumanCreate(h, target.baseUrl, id, "owner desktop");
    })
  );
  results.push(
    await session("owner-mobile", owner, mobile, async (h) => {
      await typedDraftAndDiscard(h, target.baseUrl, `${id}-m`, "owner mobile");
    })
  );
  if (viewer) {
    results.push(await session("viewer", viewer, desktop, (h) => viewerDenied(h, target.baseUrl, "viewer")));
  }
} else if (expect === "budget_exhausted") {
  results.push(await session("owner-budget", owner, desktop, (h) => budgetExhausted(h, target.baseUrl, "owner")));
} else {
  results.push(await session(`owner-${expect}`, owner, desktop, (h) => closedModule(h, target.baseUrl, expect as "off" | "kill_switch", "owner")));
}

const failed = results.filter((result) => result.status === "failed");
console.log(`[e2e-voice] ${expect}: ${results.length - failed.length}/${results.length} passed · artifacts ${artifactsDir}`);
process.exit(failed.length > 0 ? 1 : 0);
