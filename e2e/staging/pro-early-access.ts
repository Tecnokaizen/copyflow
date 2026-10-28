/**
 * Gestcopy Pro · Acceso anticipado V1 walkthrough against the real Staging
 * deployment (docs/PRO-EARLY-ACCESS-V1.md). Read-only: creates no records.
 *
 * The operator sets `pro_early_access` for tenant e2e BEFORE launching (see
 * the doc); the runner never receives service_role and never changes flags.
 *
 *   E2E_PRO_EXPECT=on|off PLAYWRIGHT_MODULE=… E2E_BASE_URL=… E2E_SUPABASE_URL=… \
 *   E2E_R2_BUCKET=… E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
 *   [E2E_VIEWER_EMAIL=… E2E_VIEWER_PASSWORD=…] [VERCEL_AUTOMATION_BYPASS_SECRET=…] \
 *   npx tsx e2e/staging/pro-early-access.ts
 *
 * Per account (owner, optional viewer): /api/context contract and cache policy,
 * header label and direct /pro access at 1440 px and 375 px, light and dark,
 * and no microphone access. Same guard, egress interlock and redaction as run.ts.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { resolveStagingTarget } from "./guard";
import { Harness, type Page } from "./harness";
import { Redactor } from "./redact";
import { requireSyntheticEmail, runId } from "./synthetic";

type Account = { name: "owner" | "viewer"; role: string; email: string; password: string };
type Result = { account: string; status: "passed" | "failed"; ms: number; quotes?: boolean; error?: string };

const LABEL = "Pro · Acceso anticipado";
const SHORT_LABEL = "Pro · Anticipado";
const VARIANTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 375, height: 812 },
] as const;
const SCHEMES = ["light", "dark"] as const;

function refuse(error: unknown): never {
  console.error(`[e2e-pro] REFUSED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

let target: ReturnType<typeof resolveStagingTarget>;
let expectOn: boolean;
const accounts: Account[] = [];
try {
  target = resolveStagingTarget();
  const expected = process.env.E2E_PRO_EXPECT;
  if (expected !== "on" && expected !== "off") throw new Error("E2E_PRO_EXPECT must be on or off");
  expectOn = expected === "on";
  if (!process.env.E2E_USER_PASSWORD) throw new Error("E2E_USER_PASSWORD is required");
  accounts.push({
    name: "owner",
    role: "owner",
    email: requireSyntheticEmail(process.env.E2E_USER_EMAIL),
    password: process.env.E2E_USER_PASSWORD,
  });
  if (process.env.E2E_VIEWER_EMAIL || process.env.E2E_VIEWER_PASSWORD) {
    if (!process.env.E2E_VIEWER_PASSWORD) throw new Error("E2E_VIEWER_PASSWORD is required with E2E_VIEWER_EMAIL");
    accounts.push({
      name: "viewer",
      role: "viewer",
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
const artifactsDir = process.env.E2E_ARTIFACTS_DIR ?? path.join(process.cwd(), "e2e-artifacts", `pro-${id}`);

async function login(h: Harness, account: Account) {
  const page = h.page;
  await h.step(`${account.name}: login`, async () => {
    await page.goto(`${target.baseUrl}/auth/login`);
    await page.locator("#email").fill(account.email);
    await page.locator("#password").fill(account.password);
    await Promise.all([
      page.waitForURL((url: URL) => url.origin === target.baseUrl && !url.pathname.startsWith("/auth/")),
      page.getByRole("button", { name: /^(Login|Iniciar sesión)$/ }).click(),
    ]);
  });
}

async function contextContract(h: Harness, account: Account) {
  return h.step(`${account.name}: /api/context`, async () => {
    const response = await h.page.request.get(`${target.baseUrl}/api/context`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["cache-control"] ?? "", /\bprivate\b.*\bno-store\b/);
    const body = (await response.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(body.membership?.role, account.role);
    assert.deepEqual(
      body.early_access,
      expectOn ? { pro: true, voice_orders: { status: "planned" } } : { pro: false }
    );
    assert.equal(typeof body.features?.quotes, "boolean");
    return body.features.quotes as boolean;
  });
}

/** Counts getUserMedia calls on every document; V1 must never ask for the microphone. */
async function watchMicrophone(page: Page) {
  await page.addInitScript(() => {
    const scope = window as unknown as { __gcMicrophoneCalls: number };
    scope.__gcMicrophoneCalls = 0;
    const devices = navigator.mediaDevices;
    if (devices?.getUserMedia) {
      const original = devices.getUserMedia.bind(devices);
      devices.getUserMedia = (constraints?: MediaStreamConstraints) => {
        scope.__gcMicrophoneCalls += 1;
        return original(constraints);
      };
    }
  });
}

async function assertNoMicrophone(page: Page) {
  const calls = await page.evaluate(() => (window as unknown as { __gcMicrophoneCalls?: number }).__gcMicrophoneCalls ?? 0);
  assert.equal(calls, 0, "getUserMedia must never be called");
}

async function headerAndPage(h: Harness, account: Account, variant: (typeof VARIANTS)[number], scheme: (typeof SCHEMES)[number]) {
  const page = h.page;
  const label = `${account.name}: ${variant.name} ${scheme}`;
  await h.step(`${label} header`, async () => {
    await page.setViewportSize({ width: variant.width, height: variant.height });
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(`${target.baseUrl}/`);
    await page.getByRole("heading", { level: 1, name: "GESTCOPY · Panel diario" }).waitFor();
    // The session button renders once /api/context has loaded: the label state is final.
    await page.getByRole("button", { name: /Menú de sesión/ }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains("dark")), scheme === "dark");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "horizontal overflow");

    const badge = page.locator("header").getByRole("link", { name: LABEL, exact: true });
    if (expectOn) {
      await badge.waitFor();
      assert.equal(await badge.getAttribute("href"), "/pro");
      const short = badge.locator('span[aria-hidden="true"]');
      assert.equal(await short.textContent(), SHORT_LABEL);
      assert.equal(await short.isVisible(), variant.name === "mobile");
    } else {
      assert.equal(await page.locator('header a[href="/pro"]:visible').count(), 0, "label must be hidden");
    }
    await assertNoMicrophone(page);
    await h.screenshot(`${label} header`);
  });

  await h.step(`${label} /pro`, async () => {
    const response = await page.goto(`${target.baseUrl}/pro`);
    if (expectOn) {
      assert.equal(response?.status(), 200);
      await page.getByRole("heading", { level: 1, name: "Gestcopy Pro · Acceso anticipado" }).waitFor();
      const voice = page.locator('section[aria-labelledby="pro-voice-orders-title"]');
      await voice.getByRole("heading", { level: 2, name: "Gestcopy AI — Pedidos por voz" }).waitFor();
      await voice.getByText("En preparación", { exact: true }).waitFor();
      assert.equal(await voice.locator("button, a, input, [role=button]").count(), 0, "voice block has no actions");
      await page.getByText("Tu plan y tu cuota no cambian. Este acceso no genera cargos adicionales.").waitFor();
      await page.getByRole("button", { name: /Menú de sesión/ }).waitFor();
      const badge = page.locator("header").getByRole("link", { name: LABEL, exact: true });
      assert.equal(await badge.getAttribute("aria-current"), "page");
    } else {
      // Cache Components streams the static shell first, so notFound() is a
      // soft 404: HTTP 200 + noindex (next/dist/docs …/functions/not-found.md).
      assert.ok([200, 404].includes(response?.status() ?? 0), `unexpected HTTP ${response?.status()}`);
      await page.getByText("This page could not be found.").waitFor();
      assert.ok((await page.locator('meta[name="robots"][content*="noindex"]').count()) > 0, "missing noindex");
      const text = await page.locator("body").innerText();
      assert.equal(/Acceso anticipado|Pedidos por voz/.test(text), false, "404 must not reveal the program");
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "horizontal overflow");
    await assertNoMicrophone(page);
    await h.screenshot(`${label} pro`);
  });
}

async function walkAccount(account: Account): Promise<Result> {
  const started = Date.now();
  const h = new Harness(target, redactor, path.join(artifactsDir, account.name), bypass);
  let result: Result = { account: account.name, status: "passed", ms: 0 };
  try {
    await h.start(process.env.PLAYWRIGHT_MODULE || "playwright");
    await watchMicrophone(h.page);
    await login(h, account);
    result.quotes = await contextContract(h, account);
    for (const variant of VARIANTS) {
      for (const scheme of SCHEMES) await headerAndPage(h, account, variant, scheme);
    }
    h.assertNoProductionEgress();
  } catch (error) {
    result = {
      ...result,
      status: "failed",
      error: redactor.text(error instanceof Error ? error.message : String(error)).slice(0, 1000),
    };
  } finally {
    result.ms = Date.now() - started;
    h.log(`${result.status.toUpperCase()} ${account.name} (${result.ms} ms)${result.error ? ` — ${result.error}` : ""}`);
    await h
      .finish({
        run: id,
        expect: expectOn ? "on" : "off",
        account: account.name,
        target: { baseUrl: target.baseUrl },
        result,
        blockedRequests: h.blocked,
        apiErrors: h.network.filter((entry) => entry.status === null || entry.status >= 400),
      })
      .catch((error: unknown) => {
        result = { ...result, status: "failed", error: `artifact check failed: ${String(error)}` };
      });
  }
  return result;
}

async function main() {
  console.log(`[e2e-pro] run ${id} expect=${expectOn ? "on" : "off"} → ${target.baseUrl} (${accounts.map((a) => a.name).join(", ")})`);
  const results: Result[] = [];
  for (const account of accounts) results.push(await walkAccount(account));
  console.log(JSON.stringify({ run: id, expect: expectOn ? "on" : "off", results }, null, 2));
  console.log(redactor.text(`artifacts: ${artifactsDir}`));
  process.exit(results.every((result) => result.status === "passed") ? 0 : 1);
}

void main();
