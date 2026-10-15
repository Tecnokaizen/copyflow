/**
 * Browser harness for the Staging E2E: real network, no API mocks.
 *
 * - Egress interlock: every browser request is classified by guard.ts.
 *   Allowed requests continue untouched (no response is ever fabricated);
 *   Production or foreign hosts are aborted and fail the run.
 * - Vercel Deployment Protection: the bypass secret is exchanged once for the
 *   host-only `_vercel_jwt` cookie, so it never travels on page requests.
 * - Artifacts: redacted step log, network summary (method, path, status; no
 *   query strings, headers or bodies), console errors and failure screenshots.
 *   Playwright traces are deliberately not recorded: they embed session
 *   cookies, bearer tokens and request bodies.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyRequest, type StagingTarget } from "./guard";
import { Redactor } from "./redact";

/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded at runtime, outside package.json. */
export type Page = any;
type Browser = any;
type BrowserContext = any;

export type NetworkEntry = { method: string; url: string; status: number | null; ms: number | null; failure?: string };

export class Harness {
  readonly steps: string[] = [];
  readonly network: NetworkEntry[] = [];
  readonly consoleErrors: string[] = [];
  readonly blocked: { url: string; kind: string }[] = [];
  page!: Page;
  private browser!: Browser;
  private context!: BrowserContext;
  private readonly started = Date.now();

  constructor(
    readonly target: StagingTarget,
    readonly redactor: Redactor,
    readonly artifactsDir: string,
    private readonly bypassSecret: string | undefined,
  ) {}

  log(message: string) {
    const line = this.redactor.text(`[${((Date.now() - this.started) / 1000).toFixed(1)}s] ${message}`);
    this.steps.push(line);
    console.log(line);
  }

  async start(playwrightModule: string) {
    await mkdir(this.artifactsDir, { recursive: true });
    const { chromium } = await import(playwrightModule);
    this.browser = await chromium.launch({ headless: process.env.E2E_HEADED !== "1" });
    this.context = await this.browser.newContext({
      viewport: { width: 1440, height: 1000 },
      locale: "es-ES",
      timezoneId: "Europe/Madrid",
      acceptDownloads: true,
    });

    await this.context.route("**/*", async (route: any) => {
      const url = route.request().url();
      const kind = classifyRequest(this.target, url);
      if (kind === "allow") return route.continue();
      this.blocked.push({ url: this.redactor.url(url), kind });
      return route.abort("blockedbyclient");
    });

    const timings = new WeakMap<object, number>();
    this.context.on("request", (request: any) => timings.set(request, Date.now()));
    this.context.on("requestfinished", async (request: any) => {
      const response = await request.response().catch(() => null);
      this.record(request, response?.status() ?? null, timings.get(request));
    });
    this.context.on("requestfailed", (request: any) => {
      this.record(request, null, timings.get(request), request.failure()?.errorText ?? "failed");
    });

    await this.preflight();

    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(20_000);
    this.page.setDefaultNavigationTimeout(45_000);
    this.page.on("console", (message: any) => {
      if (message.type() === "error") this.consoleErrors.push(this.redactor.text(message.text()).slice(0, 500));
    });
    this.page.on("pageerror", (error: Error) => this.consoleErrors.push(this.redactor.text(`pageerror: ${error.message}`)));
  }

  /**
   * Distinguishes infrastructure blockers from app failures before logging in:
   * host not served by Vercel (TLS), Deployment Protection, unexpected host.
   * Also exchanges the automation bypass for the host-only `_vercel_jwt` cookie.
   */
  private async preflight() {
    const url = `${this.target.baseUrl}/auth/login`;
    let response: any;
    try {
      response = await this.context.request.get(url, {
        headers: this.bypassSecret
          ? { "x-vercel-protection-bypass": this.bypassSecret, "x-vercel-set-bypass-cookie": "true" }
          : {},
        maxRedirects: 0,
        timeout: 20_000,
      });
    } catch (error) {
      throw new Error(
        `preflight: ${this.target.host} is not reachable over HTTPS (${error instanceof Error ? error.message.split("\n")[0] : error}). ` +
          "Wildcard DNS resolves to Vercel, so the domain is most likely not assigned to the Vercel project/branch.",
      );
    }
    const status = response.status();
    const location = response.headers()["location"] ?? "";
    this.log(`preflight: GET /auth/login → HTTP ${status}${location ? ` → ${this.redactor.url(location)}` : ""}`);
    if (status >= 300 && status < 400 && /vercel\.com\/sso|_vercel_sso/.test(location)) {
      throw new Error("preflight: Vercel Deployment Protection is active; set VERCEL_AUTOMATION_BYPASS_SECRET");
    }
    if (status === 401 || status === 403) {
      throw new Error(`preflight: HTTP ${status} from Vercel; the bypass secret is missing or invalid`);
    }
    if (status >= 400) throw new Error(`preflight: HTTP ${status} on /auth/login`);
  }

  private record(request: any, status: number | null, startedAt: number | undefined, failure?: string) {
    const type = request.resourceType();
    if (["image", "font", "stylesheet", "media"].includes(type)) return;
    this.network.push({
      method: request.method(),
      url: this.redactor.url(request.url()),
      status,
      ms: startedAt ? Date.now() - startedAt : null,
      ...(failure ? { failure } : {}),
    });
  }

  async step<T>(name: string, fn: () => Promise<T>, timeoutMs = 120_000): Promise<T> {
    this.log(`▶ ${name}`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`step exceeded ${timeoutMs / 1000} s`)), timeoutMs);
        }),
      ]);
      this.log(`✔ ${name}`);
      return result;
    } catch (error) {
      this.log(`✖ ${name}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
      await this.screenshot(name).catch(() => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async screenshot(name: string) {
    const file = path.join(this.artifactsDir, `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
    await this.page.screenshot({ path: file, fullPage: true });
    this.log(`screenshot: ${path.basename(file)} (url ${this.redactor.url(this.page.url())})`);
  }

  /** Fails when any Production request was attempted, even if the flow passed. */
  assertNoProductionEgress() {
    const production = this.blocked.filter((entry) => entry.kind === "production");
    if (production.length > 0) {
      throw new Error(`Production egress attempted: ${production.map((entry) => entry.url).join(", ")}`);
    }
  }

  async finish(report: Record<string, unknown>) {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    const files: Record<string, string> = {
      "steps.log": this.steps.join("\n") + "\n",
      "network.json": JSON.stringify(this.network, null, 2),
      "console-errors.json": JSON.stringify(this.consoleErrors, null, 2),
      "blocked-requests.json": JSON.stringify(this.blocked, null, 2),
      "report.json": JSON.stringify(report, null, 2),
    };
    for (const [name, content] of Object.entries(files)) {
      const clean = this.redactor.text(content);
      this.redactor.assertClean(name, clean);
      await writeFile(path.join(this.artifactsDir, name), clean);
    }
    // Self-check every artifact written by the run, screenshots included (raw bytes).
    for (const name of await readdir(this.artifactsDir)) {
      const raw = await readFile(path.join(this.artifactsDir, name));
      this.redactor.assertClean(name, raw.toString("latin1"));
    }
  }
}
