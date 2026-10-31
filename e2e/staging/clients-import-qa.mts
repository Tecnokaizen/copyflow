/**
 * Migration V1 · client import QA in Supabase STAGING (synthetic tenants only).
 *
 *   OUT=/tmp/qa PREVIEW_URL=https://<preview>.vercel.app SUFFIX=-run1 \
 *   VIEWER_PW_FILE=… IMPORT_PW_FILE=… PLAYWRIGHT_MODULE=…/playwright/index.mjs \
 *   E2E_SUPABASE_URL=… E2E_SUPABASE_SECRET_KEY=… E2E_USER_EMAIL=… E2E_USER_PASSWORD=… \
 *   VERCEL_AUTOMATION_BYPASS_SECRET=… npx tsx e2e/staging/clients-import-qa.mts
 *
 * QA_TARGET=local runs the same steps against a local `next dev` and a local
 * Supabase stack (both on localhost; no bypass header): PREVIEW_URL=http://localhost:3100
 * E2E_SUPABASE_URL=http://127.0.0.1:<port>. Any other host is refused in either mode.
 *
 * Preconditions: the six Migration V1 migrations (20261016120000…20261016125500) applied; synthetic tenants
 * e2e (owner + viewer) and e2e-import (owner e2e-import-owner@example.com); files
 * from e2e/staging/clients-import-files.mts. Only those two tenants are touched:
 * the feature clients_import is switched for them and nothing else.
 * STUCK_BATCH_FILES (optional, comma-separated) name batches left "uploaded" by an
 * earlier run: each is resumed from the history, checked against the oracle and cancelled.
 * PURGE_ONLY=1 + PURGED_BATCH_FILE: only step 11. Step 10 leaves a half-committed
 * batch (api-orden.csv); once an operator moves its expires_at to the past in
 * Staging, this mode purges it and checks that it keeps its counters and accepts
 * no further change. With PURGED_REVIEW_FILE (the committed batch of step 12, also
 * expired by the operator) it checks that its excluded rows are still counted
 * apart from the skipped ones once its rows are gone.
 * Audit P1 checks (20261016124000): interrupted upload resumed from the history
 * (step 9), out-of-order ranges and incomplete staging through the API (step 10).
 * Full review (20261016125500): every page of every filter, reversible exclusions,
 * totals from the server, a concurrent change before confirming, commit of exactly
 * the plan without duplicates (step 12); same file again (step 13); versioned
 * template and hostile XLSX files (step 14).
 * Expected results come from an independent oracle (same engine + duplicate rules
 * + the tenant's existing clients read with the Staging service key).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright is loaded at runtime, outside package.json. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { parseImportFile } from "../../lib/imports/clients/parse-file";
import { suggestMapping } from "../../lib/imports/clients/headers";
import { mapRows } from "../../lib/imports/clients/mapping";
import { normalizeEmail, normalizePhone, normalizeTaxId, phoneCore, previewRowProblems } from "../../lib/imports/clients/normalize";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
const STAGING_HOST = `${["fmmfsbhcwx", "kaszrrarpw"].join("")}.supabase.co`;
const LOCAL = process.env.QA_TARGET === "local";
const BASE = process.env.PREVIEW_URL!.replace(/\/$/, "");
const PREVIEW_HOST = new URL(BASE).host;
const SUPABASE_HOST = new URL(process.env.E2E_SUPABASE_URL!).host;
if (LOCAL) {
  const localhost = (url: string) => ["localhost", "127.0.0.1"].includes(new URL(url).hostname);
  if (!localhost(BASE) || !localhost(process.env.E2E_SUPABASE_URL!)) throw new Error("refusing: QA_TARGET=local only runs against localhost");
} else {
  if (!PREVIEW_HOST.endsWith(".vercel.app")) throw new Error("refusing: not a preview deployment");
  if (SUPABASE_HOST !== STAGING_HOST) throw new Error("refusing: not Staging");
}
const bypass = LOCAL ? "" : process.env.VERCEL_AUTOMATION_BYPASS_SECRET!.trim();
const bypassHeaders: Record<string, string> = bypass ? { "x-vercel-protection-bypass": bypass } : {};
const OUT = process.env.OUT!;
const admin = createClient(process.env.E2E_SUPABASE_URL!, process.env.E2E_SUPABASE_SECRET_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const results: Record<string, unknown> = {};
const failures: string[] = [];
const check = (ok: boolean, label: string) => { if (!ok) failures.push(label); };
const consoleErrors: string[] = [];
/** Every finalize / commit / revert request the pages make: status and duration. */
const calls: { kind: string; status: number; ms: number }[] = [];

async function tenantId(slug: string) {
  const { data, error } = await admin.from("tenants").select("id").eq("slug", slug).single();
  if (error) throw error;
  return data.id as string;
}

async function existingClients(slug: string) {
  const id = await tenantId(slug);
  const all: { id: string; email: string | null; phone: string | null; tax_id: string | null; source_system: string | null; source_record_id: string | null }[] = [];
  for (let from = 0; ; from += 1000) {
    // Ordered: OFFSET pages without ORDER BY are not stable (synchronized seq scans
    // under concurrent load skipped 37 of 19 196 clients in round r7).
    const { data, error } = await admin.from("clients").select("id, email, phone, tax_id, source_system, source_record_id").eq("tenant_id", id).order("id").range(from, from + 999);
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) break;
  }
  return all;
}

/** Same rules as client_import_finalize, computed independently from the server. */
async function oracle(slug: string, sourceSystem: string, path: string) {
  const bytes = readFileSync(path);
  const parsed = await parseImportFile({ name: path, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer });
  const rows = mapRows(parsed.rows, suggestMapping(parsed.headers));
  const existing = await existingClients(slug);
  const exEmail = new Set(existing.map((c) => normalizeEmail(c.email)).filter(Boolean));
  const exPhone = new Set(existing.map((c) => normalizePhone(c.phone)).filter(Boolean));
  const exTax = new Set(existing.map((c) => normalizeTaxId(c.tax_id)).filter(Boolean));
  const exSource = new Set(existing.filter((c) => c.source_system === sourceSystem && c.source_record_id).map((c) => c.source_record_id));
  const exCore = new Set(existing.map((c) => phoneCore(normalizePhone(c.phone))).filter(Boolean));
  const seen = new Set<string>();
  const counts = { total: rows.length, valid: 0, error: 0, duplicate_existing: 0, duplicate_in_file: 0, possible_duplicate: 0 };
  for (const row of rows) {
    if (previewRowProblems(row).length) { counts.error++; continue; }
    const email = normalizeEmail(row.email), phone = normalizePhone(row.phone), tax = normalizeTaxId(row.tax_id);
    const keys = [email && `e:${email}`, phone && `p:${phone}`, tax && `t:${tax}`, row.source_record_id && `s:${row.source_record_id}`].filter(Boolean) as string[];
    if ((email && exEmail.has(email)) || (phone && exPhone.has(phone)) || (tax && exTax.has(tax)) || (row.source_record_id && exSource.has(row.source_record_id))) counts.duplicate_existing++;
    else if (keys.some((k) => seen.has(k))) counts.duplicate_in_file++;
    else if (phone && exCore.has(phoneCore(phone))) counts.possible_duplicate++;
    else counts.valid++;
    keys.forEach((k) => seen.add(k));
  }
  return counts;
}

const browser = await chromium.launch();
async function login(slug: string, email: string, password: string, viewport = { width: 1366, height: 900 }, colorScheme: "light" | "dark" = "light") {
  const context = await browser.newContext({ viewport, colorScheme, acceptDownloads: true });
  await context.route("**/*", (route: any) => {
    const url = new URL(route.request().url());
    if (url.host === PREVIEW_HOST) return route.continue({ headers: { ...route.request().headers(), ...bypassHeaders } });
    if (url.host === SUPABASE_HOST) return route.continue();
    return route.abort();
  });
  const page = await context.newPage();
  page.on("console", (msg: any) => { if (msg.type() === "error") consoleErrors.push(`${slug}: ${msg.text().slice(0, 160)}`); });
  page.on("requestfinished", async (request: any) => {
    const match = new URL(request.url()).pathname.match(/\/api\/imports\/clients\/batches\/[^/]+\/(finalize|commit|revert)$/);
    if (!match) return;
    const response = await request.response();
    calls.push({ kind: match[1], status: response?.status() ?? 0, ms: Math.round(request.timing().responseEnd) });
  });
  await page.goto(`${BASE}/auth/login?tenant=${slug}`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await Promise.all([
    page.waitForURL((url: URL) => !url.pathname.startsWith("/auth/"), { timeout: 60_000 }),
    page.getByRole("button", { name: /^(Login|Iniciar sesión)$/ }).click(),
  ]);
  return { context, page };
}

const api = (page: any, method: string, path: string, body?: unknown) =>
  page.evaluate(async ([m, p, b]: [string, string, unknown]) => {
    const r = await fetch(p, { method: m, headers: b ? { "content-type": "application/json" } : undefined, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [method, path, body]);

async function latestBatch(page: any, fileName: string) {
  const r = await api(page, "GET", "/api/imports/clients/batches");
  return (r.body?.batches ?? []).find((b: any) => b.file_name === fileName);
}

const REVIEW_HEADING = "4. Revisa las filas";
const num = (value: string) => Number(value.replace(/\./g, "").trim());
/** KPI cards by label (textContent keeps the case that CSS upper-cases). */
async function kpiMap(page: any): Promise<Record<string, number>> {
  const labels: string[] = await page.locator(".gc-kpi-label").allTextContents();
  const values: string[] = await page.locator(".gc-kpi-value").allTextContents();
  return Object.fromEntries(labels.map((label, i) => [label.trim(), num(values[i])]));
}
const FILTER_CLASSES: Record<string, keyof ReturnType<typeof emptyCounts>> = {
  Nuevas: "valid",
  "Ya existen": "duplicate_existing",
  "Posibles duplicados": "possible_duplicate",
  "Repetidas en el archivo": "duplicate_in_file",
  "Con errores": "error",
};
const emptyCounts = () => ({ valid: 0, duplicate_existing: 0, possible_duplicate: 0, duplicate_in_file: 0, error: 0 });
/** Classification counts from the review filters; a filter without rows is hidden (0). */
async function reviewCounts(page: any) {
  const counts = emptyCounts();
  for (const chip of await page.getByRole("group", { name: "Filtrar filas" }).getByRole("button").allTextContents() as string[]) {
    const match = chip.trim().match(/^(.*) \(([\d.]+)\)$/);
    if (match && FILTER_CLASSES[match[1]]) counts[FILTER_CLASSES[match[1]]] = num(match[2]);
  }
  return counts;
}
const oracleCounts = (e: Awaited<ReturnType<typeof oracle>>) => ({
  valid: e.valid, duplicate_existing: e.duplicate_existing, possible_duplicate: e.possible_duplicate, duplicate_in_file: e.duplicate_in_file, error: e.error,
});
/** The plan the review and the confirmation show (computed by the server from every row). */
async function planShown(page: any) {
  const k = await kpiMap(page);
  return { create: k["Se crearán"], fill_blanks: k["Se completarán"], skip: k["Se omiten (duplicados)"], excluded: k["Excluidas por ti"], not_importable: k["No se pueden importar"] };
}
/** Default plan of a freshly classified batch: valid rows created, duplicates skipped. */
const defaultPlan = (e: Awaited<ReturnType<typeof oracle>>) => ({
  create: e.valid, fill_blanks: 0, skip: e.duplicate_existing + e.possible_duplicate, excluded: 0, not_importable: e.error + e.duplicate_in_file,
});
/** Waits until the review is not busy (its filters are disabled while a request runs). */
const settle = (page: any) =>
  page.waitForFunction(() => !document.querySelector('[role="group"][aria-label="Filtrar filas"] button[disabled]'), null, { timeout: 120_000 });

async function uiToReview(page: any, file: string, source: string, shot: string) {
  await page.goto(`${BASE}/clients/import`);
  await page.getByRole("heading", { name: "1. Elige el archivo" }).waitFor({ timeout: 60_000 });
  await page.getByPlaceholder("Ej. Mi programa anterior").fill(source);
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.getByRole("heading", { name: "2. Relaciona las columnas" }).waitFor({ timeout: 120_000 });
  await page.screenshot({ path: `${OUT}/${shot}-map.png`, fullPage: true });
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await page.getByRole("heading", { name: "3. Vista previa" }).waitFor();
  const t0 = Date.now();
  await page.getByRole("button", { name: "Validar en Gestcopy" }).click();
  await page.getByRole("heading", { name: REVIEW_HEADING }).waitFor({ timeout: 600_000 });
  await settle(page);
  const validateMs = Date.now() - t0;
  await page.screenshot({ path: `${OUT}/${shot}-review.png`, fullPage: true });
  return { validateMs, review: await reviewCounts(page), plan: await planShown(page) };
}

async function uiCommit(page: any, shot: string, resume = false) {
  if (!resume) {
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await page.getByRole("heading", { name: "5. Confirma la importación" }).waitFor({ timeout: 60_000 });
  }
  const t0 = Date.now();
  await page.getByRole("button", { name: resume ? "Reanudar importación" : "Importar clientes" }).click();
  await page.getByRole("dialog").getByRole("button", { name: resume ? "Reanudar" : "Importar" }).click();
  await page.getByRole("heading", { name: "6. Importación completada" }).waitFor({ timeout: 900_000 });
  const commitMs = Date.now() - t0;
  const k = await kpiMap(page);
  await page.screenshot({ path: `${OUT}/${shot}-result.png`, fullPage: true });
  // «Omitidos» leaves out the rows the user excluded, shown apart when there are any.
  return { commitMs, result: { created: k["Creados"], filled: k["Completados"], skipped: k["Omitidos"], excluded: k["Excluidas por ti"] ?? 0, failed: k["Con error"] } };
}

const SUFFIX = process.env.SUFFIX ?? "";
// Each round imports "from another program": origin ids of earlier rounds do not count as duplicates.
const source = (name: string) => `${name}${SUFFIX}`;
const files = {
  f100: `${OUT}/clientes-100${SUFFIX}.csv`,
  f1000: `${OUT}/clientes-1000${SUFFIX}.xlsx`,
  f10000: `${OUT}/clientes-10000${SUFFIX}.csv`,
  partial: `${OUT}/clientes-incompleta${SUFFIX}.csv`,
};
const ownerE2E = { email: process.env.E2E_USER_EMAIL!, password: process.env.E2E_USER_PASSWORD! };
const viewerE2E = { email: "e2e-viewer@example.com", password: readFileSync(process.env.VIEWER_PW_FILE!, "utf8").trim() };
const ownerImport = { email: "e2e-import-owner@example.com", password: readFileSync(process.env.IMPORT_PW_FILE!, "utf8").trim() };

// 11. Audit P1: a half-committed batch whose rows are purged keeps its counters
//     and accepts no further change.
async function purgeCheck(page: any, purgedName: string) {
  const before = await latestBatch(page, purgedName);
  const { data: purge, error: purgeError } = await admin.rpc("client_import_purge_expired", { p_limit: 10 });
  if (purgeError) throw purgeError;
  const after = await latestBatch(page, purgedName);
  const commit = await api(page, "POST", `/api/imports/clients/batches/${after?.id}/commit`, { expected_version: after?.row_version });
  const revert = await api(page, "POST", `/api/imports/clients/batches/${after?.id}/revert`, {});
  await page.goto(`${BASE}/clients/import`);
  await page.getByRole("heading", { name: "Importaciones recientes" }).waitFor({ timeout: 60_000 });
  const row = page.locator("tr", { hasText: purgedName }).first();
  const statusText = await row.locator("td").nth(2).innerText();
  const actions = await row.getByRole("button").allInnerTexts();
  await page.screenshot({ path: `${OUT}/p1-purged-history.png`, fullPage: true });
  const still = await latestBatch(page, purgedName);
  results.p1Purged = {
    purge, before: { status: before?.status, created: before?.counts?.created, purged: before?.rows_purged },
    after: { status: after?.status, created: after?.counts?.created, purged: after?.rows_purged },
    commit: commit.status, revert: revert.status, statusText, actions, createdAtEnd: still?.counts?.created,
  };
  check(before?.status === "committing" && after?.rows_purged === true && after?.counts?.created === before?.counts?.created, "P1 purge: counters kept");
  check(commit.status === 409 && revert.status === 409 && still?.status === before?.status && still?.counts?.created === before?.counts?.created, "P1 purge: no change after purge");
  check(statusText.includes("Caducada a medias") && JSON.stringify(actions) === JSON.stringify(["Ver resumen"]), "P1 purge: history shows it as expired half-way");
}

// 11b. The committed review batch of step 12 keeps its excluded count after the purge.
async function purgedReviewCheck(page: any, name: string) {
  const { error: purgeError } = await admin.rpc("client_import_purge_expired", { p_limit: 10 });
  if (purgeError) throw purgeError;
  const batch = await latestBatch(page, name);
  const summary = await api(page, "GET", `/api/imports/clients/batches/${batch?.id}?limit=1`);
  await page.goto(`${BASE}/clients/import`);
  await page.getByRole("heading", { name: "Importaciones recientes" }).waitFor({ timeout: 60_000 });
  await page.locator("tr", { hasText: name }).first().getByRole("button", { name: "Ver resumen" }).click();
  await page.getByRole("heading", { name: "6. Importación completada" }).waitFor({ timeout: 60_000 });
  const k = await kpiMap(page);
  await page.screenshot({ path: `${OUT}/p1-purged-review.png`, fullPage: true });
  const counts = summary.body?.batch?.counts;
  results.purgedReview = { purged: batch?.rows_purged, plan: summary.body?.batch?.plan, counts, shown: k };
  check(batch?.rows_purged === true && summary.body?.batch?.plan === null && counts?.excluded > 0 && k["Excluidas por ti"] === counts?.excluded
    && k["Omitidos"] === counts?.skipped - counts?.excluded, "purge: excluded rows still apart from the skipped ones");
}

if (process.env.PURGE_ONLY) {
  const session = await login("e2e-import", ownerImport.email, ownerImport.password);
  if (process.env.PURGED_BATCH_FILE) await purgeCheck(session.page, process.env.PURGED_BATCH_FILE);
  if (process.env.PURGED_REVIEW_FILE) await purgedReviewCheck(session.page, process.env.PURGED_REVIEW_FILE);
  await browser.close();
  results.failures = failures;
  writeFileSync(`${OUT}/results-purge.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  process.exit(0);
}

// 1. Viewer: no access in API or UI.
{
  const { context, page } = await login("e2e", viewerE2E.email, viewerE2E.password);
  const access = await api(page, "GET", "/api/imports/clients/access");
  const create = await api(page, "POST", "/api/imports/clients/batches", { source_system: "X", file_name: "x.csv", file_size: 1, file_sha256: "a".repeat(64), mapping: {} });
  await page.goto(`${BASE}/clients`);
  await page.getByRole("heading", { name: "Clientes" }).waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1500);
  const importLinks = await page.getByRole("link", { name: "Importar", exact: true }).count();
  await page.goto(`${BASE}/clients/import`);
  await page.getByText("La importación de clientes no está disponible").waitFor({ timeout: 60_000 });
  results.viewer = { access: access.body, create: create.status, importLinks };
  check(access.body?.allowed === false && create.status === 403 && importLinks === 0, "viewer must be denied");
  await context.close();
}

// 2. Feature disabled for e2e-import, then enabled for the two synthetic tenants only.
{
  await admin.rpc("set_tenant_feature", { p_slug: "e2e-import", p_code: "clients_import", p_enabled: false, p_limit: null });
  const { context, page } = await login("e2e-import", ownerImport.email, ownerImport.password);
  const access = await api(page, "GET", "/api/imports/clients/access");
  const create = await api(page, "POST", "/api/imports/clients/batches", { source_system: "X", file_name: "x.csv", file_size: 1, file_sha256: "a".repeat(64), mapping: {} });
  results.featureOff = { access: access.body, create: create.status, code: create.body?.code };
  check(access.body?.allowed === false && create.status === 404 && create.body?.code === "feature_disabled", "feature off must be refused");
  await context.close();
  for (const slug of ["e2e", "e2e-import"]) {
    const { error } = await admin.rpc("set_tenant_feature", { p_slug: slug, p_code: "clients_import", p_enabled: true, p_limit: null });
    if (error) throw new Error(`set_tenant_feature ${slug}: ${error.message}`);
  }
}

// 3. e2e owner, desktop light: 100-row CSV (Windows-1252), report, revert.
let e2eBatch: string | null = null;
const e2eOwner = await login("e2e", ownerE2E.email, ownerE2E.password);
{
  const page = e2eOwner.page;
  const expected = await oracle("e2e", source("Programa anterior"), files.f100);
  const review = await uiToReview(page, files.f100, source("Programa anterior"), "e2e-100");
  const commit = await uiCommit(page, "e2e-100");
  e2eBatch = (await latestBatch(page, `clientes-100${SUFFIX}.csv`))?.id ?? null;
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Descargar informe" }).click()]);
  await download.saveAs(`${OUT}/informe-100.csv`);
  const reportLines = readFileSync(`${OUT}/informe-100.csv`, "utf8").trim().split("\r\n").length;
  await page.getByRole("button", { name: "Revertir importación" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revertir" }).click();
  await page.getByRole("heading", { name: "Importación revertida" }).waitFor({ timeout: 120_000 });
  const revertText = await page.locator("section", { hasText: "Importación revertida" }).innerText();
  results.e2e100 = { expected, review: review.review, plan: review.plan, validateMs: review.validateMs, ...commit, reportLines, revert: revertText.match(/\d+ clientes desactivados[^.]*/)?.[0] };
  check(JSON.stringify(review.review) === JSON.stringify(oracleCounts(expected)), "e2e 100 review == oracle");
  check(JSON.stringify(review.plan) === JSON.stringify(defaultPlan(expected)), "e2e 100 plan from the server == oracle");
  check(commit.result.created === expected.valid && commit.result.failed === 0, "e2e 100 created == oracle valid");
  check(reportLines === expected.total + 1, "e2e 100 report has every row");
}

// 4. e2e-import owner, mobile dark: 1 000-row XLSX; one chunk by API, concurrent commit, then resume in the UI.
const importOwner = await login("e2e-import", ownerImport.email, ownerImport.password, { width: 390, height: 844 }, "dark");
{
  const page = importOwner.page;
  const expected = await oracle("e2e-import", source("Hoja de cálculo"), files.f1000);
  const review = await uiToReview(page, files.f1000, source("Hoja de cálculo"), "import-1000-mobile");
  const batch = await latestBatch(page, `clientes-1000${SUFFIX}.xlsx`);
  const summary = await api(page, "GET", `/api/imports/clients/batches/${batch.id}?limit=1`);
  const first = await api(page, "POST", `/api/imports/clients/batches/${batch.id}/commit`, { expected_version: summary.body.batch.row_version, limit: 200 });
  const v = first.body.batch.row_version;
  const parallel = await page.evaluate(([id, version]: [string, number]) =>
    Promise.all([0, 1].map(() =>
      fetch(`/api/imports/clients/batches/${id}/commit`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_version: version, limit: 200 }) }).then((r) => r.status),
    )), [batch.id, v]);
  await page.goto(`${BASE}/clients/import`);
  await page.getByRole("heading", { name: "Importaciones recientes" }).waitFor({ timeout: 60_000 });
  await page.screenshot({ path: `${OUT}/import-1000-mobile-history.png`, fullPage: true });
  await page.locator("tr", { hasText: `clientes-1000${SUFFIX}.xlsx` }).getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("heading", { name: "5. Confirma la importación" }).waitFor({ timeout: 60_000 });
  const commit = await uiCommit(page, "import-1000-mobile", true);
  const { count: linked } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("import_batch_id", batch.id);
  results.import1000 = { expected, review: review.review, plan: review.plan, validateMs: review.validateMs, firstChunk: first.status, parallel: [...parallel].sort(), ...commit, linkedClients: linked };
  check(JSON.stringify(review.review) === JSON.stringify(oracleCounts(expected)), "1000 review == oracle");
  check(JSON.stringify(review.plan) === JSON.stringify(defaultPlan(expected)), "1000 plan from the server == oracle");
  check(first.status === 200 && JSON.stringify([...parallel].sort()) === JSON.stringify([200, 409]), "concurrent commits: one writer, one 409");
  check(commit.result.created === expected.valid && linked === expected.valid, "1000 resumed: created == oracle valid, no duplicates");
}

// 5. e2e-import owner, desktop: 10 000-row CSV with timings.
const importDesktop = await login("e2e-import", ownerImport.email, ownerImport.password);
let tenK: string | null = null;
let tenKCreated = 0;
{
  const page = importDesktop.page;
  const expected = await oracle("e2e-import", source("CRM anterior"), files.f10000);
  const review = await uiToReview(page, files.f10000, source("CRM anterior"), "import-10000");
  const commit = await uiCommit(page, "import-10000");
  tenK = (await latestBatch(page, `clientes-10000${SUFFIX}.csv`))?.id ?? null;
  tenKCreated = commit.result.created;
  const report = await page.request.get(`${BASE}/api/imports/clients/batches/${tenK}/report`, { headers: bypassHeaders });
  const reportLines = (await report.text()).trim().split("\r\n").length;
  const { count: linked } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("import_batch_id", tenK);
  results.import10000 = { expected, review: review.review, plan: review.plan, validateMs: review.validateMs, ...commit, reportLines, linkedClients: linked };
  check(JSON.stringify(review.review) === JSON.stringify(oracleCounts(expected)), "10000 review == oracle");
  check(JSON.stringify(review.plan) === JSON.stringify(defaultPlan(expected)), "10000 plan from the server == oracle");
  check(commit.result.created === expected.valid && linked === expected.valid && commit.result.failed === 0, "10000 created == oracle valid");
  check(reportLines === expected.total + 1, "10000 report has every row");
}

// 6. Tenant isolation through the API, both directions.
{
  const fromImport = importDesktop.page;
  const fromE2E = e2eOwner.page;
  const a = await api(fromImport, "GET", `/api/imports/clients/batches/${e2eBatch}`);
  const b = await api(fromImport, "POST", `/api/imports/clients/batches/${e2eBatch}/revert`);
  const c = await fromImport.request.get(`${BASE}/api/imports/clients/batches/${e2eBatch}/report`, { headers: bypassHeaders });
  const list = await api(fromImport, "GET", "/api/imports/clients/batches");
  const d = await api(fromE2E, "GET", `/api/imports/clients/batches/${tenK}`);
  const e = await api(fromE2E, "POST", `/api/imports/clients/batches/${tenK}/commit`, { expected_version: 1 });
  const f = await api(fromE2E, "GET", `/api/imports/clients/batches/${tenK}/rows?filter=all&limit=200`);
  const g = await api(fromE2E, "POST", `/api/imports/clients/batches/${tenK}/decisions`, { row_numbers: [1], decision: "exclude" });
  const h = await api(fromImport, "GET", `/api/imports/clients/batches/${e2eBatch}/rows?filter=all`);
  results.isolation = {
    importReadsE2E: a.status, importRevertsE2E: b.status, importReportE2E: c.status(), listLeaks: (list.body?.batches ?? []).some((x: any) => x.id === e2eBatch),
    e2eReadsImport: d.status, e2eCommitsImport: e.status, e2eReadsImportRows: f.status, e2eExcludesImportRows: g.status, importReadsE2ERows: h.status,
  };
  check(a.status === 404 && b.status === 404 && c.status() === 404 && d.status === 404 && e.status === 404 && !(results.isolation as any).listLeaks, "tenant isolation");
  check(f.status === 404 && g.status === 404 && h.status === 404, "tenant isolation: rows pages and decisions");
}

// 7. Revert of the 10 000-row import from the UI (chunks of 250 until nothing is left).
{
  const page = importDesktop.page;
  const before = calls.length;
  const t0 = Date.now();
  await page.getByRole("button", { name: "Revertir importación" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Revertir" }).click();
  await page.getByRole("heading", { name: "Importación revertida" }).waitFor({ timeout: 900_000 });
  const ms = Date.now() - t0;
  await page.screenshot({ path: `${OUT}/import-10000-reverted.png`, fullPage: true });
  const summary = await api(page, "GET", `/api/imports/clients/batches/${tenK}?limit=1`);
  const { count: activeLeft } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("import_batch_id", tenK).eq("active", true);
  const batch = summary.body?.batch;
  results.revert10000 = { ms, status: batch?.status, deactivated: batch?.counts?.deactivated, activeLeft, calls: calls.slice(before).filter((c) => c.kind === "revert").length };
  check(batch?.status === "reverted" && batch?.counts?.deactivated === tenKCreated && activeLeft === 0, "10000 revert: every created client deactivated");
}

// 8. Batches left "uploaded" (rows staged, never classified) resume from the history, then are cancelled.
const resumed: unknown[] = [];
for (const stuckName of (process.env.STUCK_BATCH_FILES ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
  const page = importDesktop.page;
  const stuck = await latestBatch(page, stuckName);
  if (stuck?.status === "uploaded") {
    const expected = await oracle("e2e-import", stuck.source_system, `${OUT}/${stuckName}`);
    await page.goto(`${BASE}/clients/import`);
    await page.getByRole("heading", { name: "Importaciones recientes" }).waitFor({ timeout: 60_000 });
    const t0 = Date.now();
    await page.locator("tr", { hasText: stuckName }).getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("heading", { name: REVIEW_HEADING }).waitFor({ timeout: 600_000 });
    await settle(page);
    const validateMs = Date.now() - t0;
    const review = await reviewCounts(page);
    const cancel = await api(page, "POST", `/api/imports/clients/batches/${stuck.id}/cancel`);
    resumed.push({ file: stuckName, expected, review, validateMs, cancel: cancel.status, status: cancel.body?.batch?.status });
    check(JSON.stringify(review) === JSON.stringify(oracleCounts(expected)), `resumed ${stuckName}: review == oracle`);
    check(cancel.status === 200 && cancel.body?.batch?.status === "cancelled", `resumed ${stuckName}: cancelled`);
  } else {
    resumed.push({ file: stuckName, skipped: stuck?.status ?? "missing" });
  }
}
results.resumeUploaded = resumed;

// 9. Audit P1: an upload interrupted half-way is never validated as is. The
//    second batch of rows is dropped on the way; after a reload the history says
//    how many rows are missing and "Continuar" asks for the file again.
{
  const page = importDesktop.page;
  const partialName = `clientes-incompleta${SUFFIX}.csv`;
  const expected = await oracle("e2e-import", source("Envío interrumpido"), files.partial);
  let stageCalls = 0;
  await page.route("**/api/imports/clients/batches/*/rows", (route: any) => {
    // Only the uploads (POST); the review reads its pages with GET on the same path.
    if (route.request().method() !== "POST") return route.fallback();
    stageCalls += 1;
    return stageCalls === 2 ? route.abort() : route.fallback();
  });
  await page.goto(`${BASE}/clients/import`);
  await page.getByRole("heading", { name: "1. Elige el archivo" }).waitFor({ timeout: 60_000 });
  await page.getByPlaceholder("Ej. Mi programa anterior").fill(source("Envío interrumpido"));
  await page.locator('input[type="file"]').setInputFiles(files.partial);
  await page.getByRole("heading", { name: "2. Relaciona las columnas" }).waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await page.getByRole("heading", { name: "3. Vista previa" }).waitFor();
  await page.getByRole("button", { name: "Validar en Gestcopy" }).click();
  await page.locator('p[role="alert"]').waitFor({ timeout: 120_000 });
  await page.unroute("**/api/imports/clients/batches/*/rows");
  const interrupted = await latestBatch(page, partialName);
  await page.goto(`${BASE}/clients/import`);
  await page.getByRole("heading", { name: "Importaciones recientes" }).waitFor({ timeout: 60_000 });
  const row = page.locator("tr", { hasText: partialName });
  const statusText = await row.locator("td").nth(2).innerText();
  await row.getByRole("button", { name: "Continuar" }).click();
  const notice = await page.locator('p[role="status"]').first().innerText({ timeout: 60_000 });
  const backToFile = await page.getByRole("heading", { name: "1. Elige el archivo" }).isVisible();
  await page.screenshot({ path: `${OUT}/p1-partial-resume.png`, fullPage: true });
  await page.locator('input[type="file"]').setInputFiles(files.partial);
  await page.getByRole("heading", { name: "2. Relaciona las columnas" }).waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await page.getByRole("heading", { name: "3. Vista previa" }).waitFor();
  await page.getByRole("button", { name: "Validar en Gestcopy" }).click();
  await page.getByRole("heading", { name: REVIEW_HEADING }).waitFor({ timeout: 600_000 });
  await settle(page);
  const review = await reviewCounts(page);
  const completed = await latestBatch(page, partialName);
  const cancel = await api(page, "POST", `/api/imports/clients/batches/${completed?.id}/cancel`);
  results.p1Partial = {
    interrupted: { status: interrupted?.status, total: interrupted?.counts?.total, expected: interrupted?.expected_rows },
    statusText, notice, backToFile, sameBatch: completed?.id === interrupted?.id,
    completed: { status: completed?.status, total: completed?.counts?.total }, expected, review, cancel: cancel.status,
  };
  check(interrupted?.status === "uploaded" && interrupted?.counts?.total === 500 && interrupted?.expected_rows === 1200, "P1 partial: 500 of 1200 rows arrived");
  check(/Faltan 700 filas/.test(statusText) && /Faltan 700 de 1\.?200 filas/.test(notice) && backToFile, "P1 partial: history and notice ask for the file");
  check(completed?.id === interrupted?.id && completed?.status === "validated" && completed?.counts?.total === 1200, "P1 partial: same batch completed with 1200 rows");
  check(JSON.stringify(review) === JSON.stringify(oracleCounts(expected)), "P1 partial: review == oracle");
}

// 10. Audit P1 through the API: ranges out of order and incomplete staging.
{
  const page = importDesktop.page;
  const sha = (label: string) => createHash("sha256").update(`${label}${SUFFIX}`).digest("hex");
  const create = (label: string, rows: number) => api(page, "POST", "/api/imports/clients/batches", {
    source_system: source("API auditoría"), file_name: `api-${label}.csv`, file_size: 10, file_sha256: sha(label),
    mapping: { Nombre: "name" }, expected_rows: rows,
  });
  const rows = (from: number, to: number, tag: string) => Array.from({ length: to - from + 1 }, (_, i) => ({ row_number: from + i, name: `${tag} ${from + i}` }));
  const ordered = (await create("orden", 3)).body?.batch;
  await api(page, "POST", `/api/imports/clients/batches/${ordered.id}/rows`, { rows: rows(1, 3, `Orden${SUFFIX}`) });
  const lastFirst = await api(page, "POST", `/api/imports/clients/batches/${ordered.id}/finalize`, { from_row: 3, limit: 1 });
  const commitEarly = await api(page, "POST", `/api/imports/clients/batches/${ordered.id}/commit`, { expected_version: lastFirst.body?.batch?.row_version });
  const full = await api(page, "POST", `/api/imports/clients/batches/${ordered.id}/finalize`, { from_row: 1, limit: 1000 });
  const partial = (await create("parcial", 3)).body?.batch;
  await api(page, "POST", `/api/imports/clients/batches/${partial.id}/rows`, { rows: rows(1, 2, `Parcial${SUFFIX}`) });
  const finalizePartial = await api(page, "POST", `/api/imports/clients/batches/${partial.id}/finalize`, {});
  const beyond = await api(page, "POST", `/api/imports/clients/batches/${partial.id}/rows`, { rows: rows(4, 4, `Parcial${SUFFIX}`) });
  const noCount = await api(page, "POST", "/api/imports/clients/batches", {
    source_system: source("API auditoría"), file_name: "sin-recuento.csv", file_size: 10, file_sha256: sha("sin-recuento"), mapping: { Nombre: "name" },
  });
  // Leave it half-committed (1 of 3 rows) for the purge check (PURGE_ONLY).
  const halfway = await api(page, "POST", `/api/imports/clients/batches/${ordered.id}/commit`, { expected_version: full.body?.batch?.row_version, limit: 1 });
  await api(page, "POST", `/api/imports/clients/batches/${partial.id}/cancel`);
  results.p1Api = {
    lastFirst: { status: lastFirst.body?.batch?.status, done: lastFirst.body?.batch?.done, next_row: lastFirst.body?.batch?.next_row },
    commitEarly: { status: commitEarly.status, code: commitEarly.body?.code },
    full: { status: full.body?.batch?.status, valid: full.body?.batch?.counts?.valid },
    finalizePartial: { status: finalizePartial.status, code: finalizePartial.body?.code },
    beyond: { status: beyond.status, code: beyond.body?.code },
    noCount: noCount.status,
    halfway: { status: halfway.body?.batch?.status, created: halfway.body?.batch?.counts?.created },
  };
  check(lastFirst.body?.batch?.status === "uploaded" && lastFirst.body?.batch?.done === false && lastFirst.body?.batch?.next_row === 1, "P1 API: last range first is not validated");
  check(commitEarly.status === 409, "P1 API: commit refused before full classification");
  check(full.body?.batch?.status === "validated" && full.body?.batch?.counts?.valid === 3, "P1 API: validated once complete");
  check(finalizePartial.status === 409 && finalizePartial.body?.code === "batch_incomplete", "P1 API: 2 of 3 rows refused");
  check(beyond.status === 400, "P1 API: row beyond the declared count refused");
  check(noCount.status === 400, "P1 API: the row count is required");
  check(halfway.body?.batch?.status === "committing" && halfway.body?.batch?.counts?.created === 1, "P1 API: api-orden.csv left half-committed");
}

/**
 * Review file for step 12, built from the tenant's own clients: 200 new rows (four
 * pages), existing duplicates, +34 possible duplicates, rows repeated in the file
 * and rows with errors.
 */
async function reviewFile(slug: string, tag: string) {
  const existing = await existingClients(slug);
  const lines = ["Nombre;Email;Teléfono;NIF/CIF"];
  for (let i = 1; i <= 200; i += 1) lines.push(`Revisión ${i};${tag}-${i}@example.com;;`);
  existing.filter((c) => c.email).slice(0, 20).forEach((c, i) => lines.push(`Ya existe ${i + 1};${c.email};;`));
  existing
    .map((c) => normalizePhone(c.phone))
    .filter((d): d is string => !!d && (d.length === 9 || (d.length === 11 && d.startsWith("34"))))
    .slice(0, 5)
    .forEach((d, i) => lines.push(`Prefijo ${i + 1};;${d.length === 9 ? `+34 ${d}` : d.slice(2)};`));
  for (let i = 1; i <= 10; i += 1) lines.push(`Repetida ${i};${tag}-${i}@example.com;;`);
  for (let i = 1; i <= 3; i += 1) lines.push(`;sin-nombre-${tag}-${i}@example.com;;`);
  for (let i = 1; i <= 2; i += 1) lines.push(`Email malo ${i};no-es-email-${i};;`);
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Every page of one filter through the API (200 rows per page, keyset cursor). */
async function allPages(page: any, batchId: string, filter: string) {
  const rows: number[] = [];
  let after = 0;
  let total = -1;
  let pages = 0;
  for (;;) {
    const r = await api(page, "GET", `/api/imports/clients/batches/${batchId}/rows?filter=${filter}&after=${after}&limit=200`);
    if (r.status !== 200) return { status: r.status, total, rows, pages, ordered: false };
    pages += 1;
    total = r.body.page.total;
    rows.push(...r.body.page.rows.map((x: any) => x.row_number));
    if (!r.body.page.has_more || pages > 100) break;
    after = r.body.page.next_after_row;
  }
  return { status: 200, total, rows, pages, ordered: rows.every((n, i) => i === 0 || n > rows[i - 1]) };
}

const filterButton = (page: any, name: RegExp) => page.getByRole("group", { name: "Filtrar filas" }).getByRole("button", { name });
async function showFilter(page: any, name: RegExp) {
  await filterButton(page, name).click();
  await settle(page);
}
async function clickRow(page: any, label: string | RegExp) {
  const button = typeof label === "string" ? page.getByRole("button", { name: label, exact: true }) : page.getByRole("button", { name: label }).first();
  await button.click();
  await settle(page);
}

// 12. Full review (20261016125500), e2e-import owner, desktop: every page of
//     every filter, reversible exclusions, totals from the server, a change from
//     another session before confirming, and a commit of exactly the plan.
let reviewBatchId = "";
let reviewLinked = 0;
const reviewName = `clientes-revision${SUFFIX}.csv`;
const reviewPath = `${OUT}/${reviewName}`;
{
  const page = importDesktop.page;
  const tag = `rev${SUFFIX.replace(/[^a-z0-9]/gi, "")}${Date.now().toString(36)}`;
  writeFileSync(reviewPath, await reviewFile("e2e-import", tag));
  const expected = await oracle("e2e-import", source("Revisión completa"), reviewPath);
  const shown = await uiToReview(page, reviewPath, source("Revisión completa"), "review-full");
  const batch = await latestBatch(page, reviewName);
  reviewBatchId = batch.id;
  check(JSON.stringify(shown.review) === JSON.stringify(oracleCounts(expected)), "review: classification == oracle");
  check(JSON.stringify(shown.plan) === JSON.stringify(defaultPlan(expected)), "review: plan from the server == oracle");

  // a) Every page of every filter: complete, ordered, no row twice, totals == oracle.
  const want: Record<string, number> = {
    all: expected.total, attention: expected.total - expected.valid, valid: expected.valid, error: expected.error,
    duplicate_in_file: expected.duplicate_in_file, duplicate_existing: expected.duplicate_existing, possible_duplicate: expected.possible_duplicate,
    excluded: 0, create: expected.valid, fill_blanks: 0, skip: expected.duplicate_existing + expected.possible_duplicate,
  };
  const pagesByFilter: Record<string, unknown> = {};
  for (const [filter, total] of Object.entries(want)) {
    const r = await allPages(page, batch.id, filter);
    pagesByFilter[filter] = { total: r.total, rows: r.rows.length, pages: r.pages };
    check(r.status === 200 && r.total === total && r.rows.length === total && r.ordered && new Set(r.rows).size === total, `review pages: ${filter} complete and ordered`);
  }
  const badFilter = await api(page, "GET", `/api/imports/clients/batches/${batch.id}/rows?filter=bogus`);
  const bigPage = await api(page, "GET", `/api/imports/clients/batches/${batch.id}/rows?limit=201`);
  check(badFilter.status === 400 && bigPage.status === 400, "review pages: unknown filter and pages over 200 refused");

  // b) The interface walks every page of the new rows.
  await showFilter(page, /^Nuevas/);
  const uiRows: number[] = [];
  let lastRange = "";
  for (let i = 0; i < 50; i += 1) {
    const labels: string[] = await page.getByRole("button", { name: /^Excluir: fila \d+$/ }).evaluateAll((els: HTMLElement[]) => els.map((el) => el.getAttribute("aria-label") ?? ""));
    uiRows.push(...labels.map((label) => Number(label.replace(/\D+/g, ""))));
    lastRange = ((await page.getByText(/^Filas \d/).textContent()) ?? "").trim();
    const next = page.getByRole("button", { name: "Siguiente" });
    if (await next.isDisabled()) break;
    await next.click();
    await settle(page);
  }
  check(uiRows.length === expected.valid && new Set(uiRows).size === uiRows.length && lastRange.endsWith(`de ${expected.valid.toLocaleString("es-ES")}`),
    "review UI: every page of new rows, none twice");

  // c) Reversible exclusions and decisions; the totals always come from the server.
  await showFilter(page, /^Nuevas/);
  const firstRows = uiRows.slice(0, 3);
  for (const n of firstRows) await clickRow(page, `Excluir: fila ${n}`);
  await showFilter(page, /^Excluidas/);
  await clickRow(page, `Volver a incluir: fila ${firstRows[1]}`);
  let possibleCreated = 0;
  let existingExcluded = 0;
  if (expected.possible_duplicate > 0) {
    await showFilter(page, /^Posibles duplicados/);
    await clickRow(page, /^Crear igualmente: fila \d+$/);
    possibleCreated = 1;
  }
  if (expected.duplicate_existing > 0) {
    await showFilter(page, /^Ya existen/);
    await clickRow(page, /^Excluir: fila \d+$/);
    existingExcluded = 1;
  }
  const planned = {
    create: expected.valid - 2 + possibleCreated,
    fill_blanks: 0,
    skip: expected.duplicate_existing - existingExcluded + expected.possible_duplicate - possibleCreated,
    excluded: 2 + existingExcluded,
    not_importable: expected.error + expected.duplicate_in_file,
  };
  const afterChanges = await planShown(page);
  const serverPlan = (await api(page, "GET", `/api/imports/clients/batches/${batch.id}?limit=1`)).body?.batch?.plan;
  check(JSON.stringify(afterChanges) === JSON.stringify(planned), "review: plan after excluding, including and creating anyway");
  check(serverPlan?.create === planned.create && serverPlan?.excluded === planned.excluded && serverPlan?.skip === planned.skip && serverPlan?.total === expected.total,
    "review: plan on screen == plan on the server");
  const excludedEmails: string[] = ((await api(page, "GET", `/api/imports/clients/batches/${batch.id}/rows?filter=excluded&limit=200`)).body?.page?.rows ?? [])
    .map((row: any) => normalizeEmail(row.email)).filter(Boolean);

  // d) Another session changes the review after this one showed its plan: nothing is imported.
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByRole("heading", { name: "5. Confirma la importación" }).waitFor({ timeout: 60_000 });
  const confirmPlan = await planShown(page);
  const otherRow = uiRows[uiRows.length - 1];
  const otherSession = await login("e2e-import", ownerImport.email, ownerImport.password);
  const changed = await api(otherSession.page, "POST", `/api/imports/clients/batches/${batch.id}/decisions`, { row_numbers: [otherRow], decision: "exclude" });
  await otherSession.context.close();
  await page.getByRole("button", { name: "Importar clientes" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Importar" }).click();
  await page.getByRole("heading", { name: REVIEW_HEADING }).waitFor({ timeout: 120_000 });
  await settle(page);
  const conflictNotice = ((await page.locator('p[role="status"]').first().textContent()) ?? "").trim();
  const { count: createdOnConflict } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("import_batch_id", batch.id);
  const planOnConflict = await planShown(page);
  await page.screenshot({ path: `${OUT}/review-full-conflict.png`, fullPage: true });
  check(JSON.stringify(confirmPlan) === JSON.stringify(planned), "confirmation shows the reviewed plan");
  check(changed.status === 200 && /ha cambiado/.test(conflictNotice) && createdOnConflict === 0 && planOnConflict.excluded === planned.excluded + 1,
    "conflict: nothing imported, the review comes back with the new totals");
  await showFilter(page, /^Excluidas/);
  await clickRow(page, `Volver a incluir: fila ${otherRow}`);
  check(JSON.stringify(await planShown(page)) === JSON.stringify(planned), "conflict: the other change undone, same plan again");

  // e) Confirming does exactly what the plan says; no excluded row and no duplicate is created.
  const commit = await uiCommit(page, "review-full");
  const { count: linked } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("import_batch_id", batch.id);
  reviewLinked = linked ?? 0;
  const { data: created } = await admin.from("clients").select("id, email, phone, tax_id").eq("import_batch_id", batch.id);
  const tenantClients = await existingClients("e2e-import");
  const keys = new Map<string, Set<string>>();
  for (const c of tenantClients) {
    for (const key of [normalizeEmail(c.email) && `e:${normalizeEmail(c.email)}`, normalizePhone(c.phone) && `p:${normalizePhone(c.phone)}`, normalizeTaxId(c.tax_id) && `t:${normalizeTaxId(c.tax_id)}`]) {
      if (key) keys.set(key, (keys.get(key) ?? new Set()).add(c.id));
    }
  }
  const duplicated = (created ?? []).filter((c: any) =>
    [normalizeEmail(c.email) && `e:${normalizeEmail(c.email)}`, normalizePhone(c.phone) && `p:${normalizePhone(c.phone)}`, normalizeTaxId(c.tax_id) && `t:${normalizeTaxId(c.tax_id)}`]
      .some((key) => key && (keys.get(key)?.size ?? 0) > 1)).length;
  const excludedCreated = (created ?? []).filter((c: any) => excludedEmails.includes(normalizeEmail(c.email) ?? "")).length;
  check(commit.result.created === planned.create && commit.result.excluded === planned.excluded && commit.result.filled === 0 && commit.result.failed === 0,
    "commit == plan (created, excluded, no errors)");
  check(linked === planned.create && excludedCreated === 0 && duplicated === 0, "commit: excluded rows not created, no duplicated client");

  // f) After the commit nothing can change, and the report marks the excluded rows.
  const late = await api(page, "POST", `/api/imports/clients/batches/${batch.id}/decisions`, { row_numbers: [firstRows[0]], decision: "include" });
  const report = await page.request.get(`${BASE}/api/imports/clients/batches/${batch.id}/report`, { headers: bypassHeaders });
  const excludedInReport = (await report.text()).split("\r\n").filter((line: string) => line.includes("Excluida en la revisión")).length;
  check(late.status === 409 && excludedInReport === planned.excluded, "after the commit: no more changes; the report marks every excluded row");
  results.reviewFull = {
    expected, review: shown.review, plan: shown.plan, pages: pagesByFilter, uiPages: { rows: uiRows.length, lastRange },
    planned, afterChanges, serverPlan, confirmPlan, conflict: { changed: changed.status, notice: conflictNotice, createdOnConflict, planOnConflict },
    ...commit, linked, excludedCreated, duplicated, late: late.status, excludedInReport,
  };
}

// 13. Retry: the same file with the same columns returns the imported batch and
//     creates nothing twice.
{
  const page = importDesktop.page;
  await page.goto(`${BASE}/clients/import`);
  await page.getByRole("heading", { name: "1. Elige el archivo" }).waitFor({ timeout: 60_000 });
  await page.getByPlaceholder("Ej. Mi programa anterior").fill(source("Revisión completa"));
  await page.locator('input[type="file"]').setInputFiles(reviewPath);
  await page.getByRole("heading", { name: "2. Relaciona las columnas" }).waitFor({ timeout: 120_000 });
  await page.getByRole("button", { name: "Ver vista previa" }).click();
  await page.getByRole("button", { name: "Validar en Gestcopy" }).click();
  await page.getByRole("heading", { name: "6. Importación completada" }).waitFor({ timeout: 120_000 });
  const notice = ((await page.locator('p[role="status"]').first().textContent()) ?? "").trim();
  const again = await latestBatch(page, reviewName);
  const { count: linked } = await admin.from("clients").select("id", { count: "exact", head: true }).eq("import_batch_id", reviewBatchId);
  results.retry = { notice, sameBatch: again?.id === reviewBatchId, linkedBefore: reviewLinked, linkedAfter: linked };
  check(again?.id === reviewBatchId && /ya se importó/.test(notice) && linked === reviewLinked, "retry: same batch, nothing created twice");
}

// 14. Mobile, dark: the versioned template is recognised; hostile XLSX files are
//     refused in the browser and no batch is created.
{
  const { context, page } = await login("e2e-import", ownerImport.email, ownerImport.password, { width: 390, height: 844 }, "dark");
  const newestBefore = (await api(page, "GET", "/api/imports/clients/batches")).body?.batches?.[0]?.id;
  await page.goto(`${BASE}/clients/import`);
  await page.getByRole("heading", { name: "1. Elige el archivo" }).waitFor({ timeout: 60_000 });
  await page.getByRole("button", { name: "Plantilla de Gestcopy" }).click();
  const [template] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar plantilla CSV" }).click()]);
  const templateName = template.suggestedFilename();
  await template.saveAs(`${OUT}/${templateName}`);
  await page.locator('input[type="file"]').setInputFiles(`${OUT}/${templateName}`);
  await page.getByRole("heading", { name: "2. Relaciona las columnas" }).waitFor({ timeout: 120_000 });
  const templateNotice = ((await page.getByText("Es la plantilla de Gestcopy").textContent()) ?? "").trim();
  const unmapped = await page.locator("ul select").evaluateAll((els: HTMLSelectElement[]) => els.filter((el) => !el.value).length);
  await page.screenshot({ path: `${OUT}/template-mobile-dark.png`, fullPage: true });
  await page.getByRole("button", { name: "Cambiar archivo" }).click();
  await page.getByRole("heading", { name: "1. Elige el archivo" }).waitFor();
  await page.getByRole("button", { name: "Otro programa" }).click();
  await page.getByPlaceholder("Ej. Mi programa anterior").fill(source("Archivo hostil"));
  const hostile: Record<string, string> = {};
  for (const [file, message] of [["xlsx-bomba", /64 MB/], ["xlsx-entidades", /no se admite/]] as const) {
    await page.locator('input[type="file"]').setInputFiles(`${OUT}/${file}${SUFFIX}.xlsx`);
    const alert = page.locator('p[role="alert"]', { hasText: message });
    await alert.waitFor({ timeout: 120_000 });
    hostile[file] = ((await alert.textContent()) ?? "").trim();
  }
  await page.screenshot({ path: `${OUT}/hostile-xlsx-mobile-dark.png`, fullPage: true });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  const newestAfter = (await api(page, "GET", "/api/imports/clients/batches")).body?.batches?.[0]?.id;
  results.templateAndHostile = { templateName, templateNotice, unmapped, hostile, newBatch: newestAfter !== newestBefore, overflow };
  check(templateName === "plantilla-clientes-gestcopy-v1.csv" && templateNotice.includes("versión 1") && unmapped === 0, "template v1 recognised and fully mapped");
  check(Object.keys(hostile).length === 2 && newestAfter === newestBefore && !overflow, "hostile XLSX refused in the browser, no batch created");
  await context.close();
}

// Every chunked call stays far from the 8 s statement timeout; no 5xx anywhere.
const byKind = (kind: string) => {
  const xs = calls.filter((c) => c.kind === kind);
  const statuses: Record<string, number> = {};
  for (const c of xs) statuses[c.status] = (statuses[c.status] ?? 0) + 1;
  return { calls: xs.length, maxMs: Math.max(0, ...xs.map((c) => c.ms)), statuses };
};
results.callTimings = { finalize: byKind("finalize"), commit: byKind("commit"), revert: byKind("revert") };
check(calls.every((c) => c.status < 500), "no 5xx in finalize / commit / revert");

await browser.close();
results.consoleErrors = consoleErrors;
results.failures = failures;
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
