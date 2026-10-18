/**
 * Gestcopy E2E V0 against the real Staging deployment (docs/E2E-STAGING-V0.md).
 *
 *   PLAYWRIGHT_MODULE=/tmp/e2e-browser/node_modules/playwright/index.mjs \
 *   E2E_BASE_URL=… E2E_SUPABASE_URL=… E2E_R2_BUCKET=… E2E_USER_EMAIL=… \
 *   E2E_USER_PASSWORD=… [VERCEL_AUTOMATION_BYPASS_SECRET=…] npx tsx e2e/staging/run.ts
 *
 * One synthetic order per run, three flows in sequence:
 *   1. orders   login → dashboard → new client → new order → list → reload
 *   2. files    INIT → PUT (R2) → COMPLETE → listed → download → SHA-256
 *   3. payment  total → partial "entrega a cuenta" (method + private receipt in R2)
 *               → reload → receipt download + SHA-256 → status changes
 * No page.route fulfilment, no API doubles: only real HTTP is observed.
 * Nothing is deleted; every run creates uniquely named records in tenant e2e.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { r2BucketFromUrl, resolveStagingTarget } from "./guard";
import { Harness, type Page } from "./harness";
import { Redactor } from "./redact";
import { requireSyntheticEmail, runId } from "./synthetic";

const ORDER_TOTAL = "100.00";
const PARTIAL_PAYMENT = "20.00";

type FlowResult = { name: string; status: "passed" | "failed" | "skipped"; ms: number; error?: string };

function refuse(error: unknown): never {
  console.error(`[e2e] REFUSED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

let target: ReturnType<typeof resolveStagingTarget>;
let email: string;
try {
  target = resolveStagingTarget();
  email = requireSyntheticEmail(process.env.E2E_USER_EMAIL);
  if (!process.env.E2E_USER_PASSWORD) throw new Error("E2E_USER_PASSWORD is required");
  if (process.env.CI && !process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
    throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required in CI (Preview is protected)");
  }
} catch (error) {
  refuse(error);
}
const password = process.env.E2E_USER_PASSWORD!;
const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() || undefined;
const redactor = new Redactor([password, bypass]);
const id = runId();
const artifactsDir = process.env.E2E_ARTIFACTS_DIR ?? path.join(process.cwd(), "e2e-artifacts", id);
const h = new Harness(target, redactor, artifactsDir, bypass);

const isApi = (method: string, pattern: RegExp) => (response: { url(): string; request(): { method(): string } }) =>
  response.request().method() === method && pattern.test(new URL(response.url()).pathname);

/** Rejects after `ms`; keeps a stuck browser-side promise from hanging the run. */
function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not finish within ${ms / 1000} s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function apiJson(response: { status(): number; json(): Promise<unknown>; url(): string }, expected: number) {
  const body = (await within(response.json(), 15_000, `body of ${redactor.url(response.url())}`).catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (response.status() !== expected) {
    const detail = body ? JSON.stringify({ error: body.error, code: body.code }) : "";
    throw new Error(`${redactor.url(response.url())} → HTTP ${response.status()} (expected ${expected}) ${detail}`);
  }
  return body ?? {};
}

/**
 * Pending waits are created before the action that triggers them. If a step
 * fails first, their later rejection must not crash the process before the
 * artifacts are written; awaiting the promise still throws.
 */
function observe<P extends Promise<unknown>>(promise: P): P {
  promise.catch(() => undefined);
  return promise;
}

/** Value cell of a FactRow (label rendered as "Label:"). */
function fact(page: Page, label: string) {
  return page
    .locator(".gc-fact-label")
    .filter({ hasText: new RegExp(`^${label}:$`) })
    .locator("xpath=following-sibling::div[1]");
}

const money = (value: string) => `${value.replace(".", ",")} €`;

/** Same-origin call through the app's own API with the browser session (no service role). */
async function appGet(page: Page, pathname: string) {
  const response = await page.request.get(`${target.baseUrl}${pathname}`);
  return apiJson(response, 200);
}

const state: {
  clientName: string;
  orderTitle: string;
  orderId?: string;
  reference?: string;
  fileName: string;
  fileSha256?: string;
  fileId?: string;
  receiptName: string;
  receiptId?: string;
} = {
  clientName: `E2E Cliente ${id}`,
  orderTitle: `E2E Pedido ${id}`,
  fileName: `e2e-${id}.txt`,
  receiptName: `e2e-justificante-${id}.txt`,
};

async function flowOrders(page: Page) {
  await h.step("login", async () => {
    await page.goto(`${target.baseUrl}/auth/login`);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await Promise.all([
      page.waitForURL((url: URL) => url.origin === target.baseUrl && !url.pathname.startsWith("/auth/")),
      page.getByRole("button", { name: "Login", exact: true }).click(),
    ]);
  });

  await h.step("dashboard", async () => {
    const dashboard = observe(page.waitForResponse(isApi("GET", /^\/api\/dashboard$/)));
    if (new URL(page.url()).pathname !== "/") await page.goto(`${target.baseUrl}/`);
    await apiJson(await dashboard, 200);
    await page.getByRole("heading", { level: 1, name: "GESTCOPY · Panel diario" }).waitFor();
    assert.equal(await page.getByText("Acceso no autorizado").count(), 0, "user must be a member of tenant e2e");
  });

  await h.step("create client", async () => {
    await page.goto(`${target.baseUrl}/clients`);
    await page.getByRole("heading", { level: 1, name: "Clientes" }).waitFor();
    await page.getByRole("button", { name: "Nuevo cliente" }).click();
    await page.getByLabel("Nombre *").fill(state.clientName);
    await page.getByLabel("Email", { exact: true }).fill(`e2e-client-${id.toLowerCase()}@example.com`);
    const created = observe(page.waitForResponse(isApi("POST", /^\/api\/clients$/)));
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    const body = await apiJson(await created, 200);
    const client = body.client as { id: string; name: string };
    assert.equal(client.name, state.clientName);
    // Clients are paginated alphabetically. A new synthetic client may be on a
    // later page once this persistent test tenant has accumulated prior runs.
    await page.getByPlaceholder(/^Buscar por nombre, empresa, contacto/).fill(state.clientName);
    await page.getByRole("link", { name: state.clientName }).waitFor();
  });

  await h.step("create order", async () => {
    await page.goto(`${target.baseUrl}/orders?create=1`);
    await page.getByPlaceholder("Ej. 200 tarjetas de visita").waitFor();
    await page.getByPlaceholder("Ej. 200 tarjetas de visita").fill(state.orderTitle);

    const search = observe(page.waitForResponse(isApi("GET", /^\/api\/clients$/)));
    await page.getByPlaceholder(/^Buscar cliente por nombre/).fill(state.clientName);
    await apiJson(await search, 200);
    await page.locator("button").filter({ hasText: state.clientName }).first().click();
    await page.getByRole("button", { name: "Cambiar", exact: true }).waitFor();

    // Delivery tomorrow; a date without explicit time defaults to 18:00 (PR #92).
    await page.getByRole("button", { name: "Mañana", exact: true }).click();

    const created = observe(page.waitForResponse(isApi("POST", /^\/api\/orders$/)));
    await page.getByRole("button", { name: "Crear pedido", exact: true }).click();
    const body = await apiJson(await created, 201);
    const order = body.order as { id: string; reference: string; title: string; client: { name: string } | null };
    assert.equal(order.title, state.orderTitle);
    assert.equal(order.client?.name, state.clientName);
    assert.match(order.reference, /^E2E-\d{4,}$/);
    state.orderId = order.id;
    state.reference = order.reference;
    h.log(`order ${order.reference} (${order.id})`);

    await page.waitForURL((url: URL) => url.pathname === `/orders/${order.id}`);
    await page.getByText("Pedido creado. Ya puedes completar el resto en la ficha.").waitFor();
  });

  await h.step("order in list (card view, reload)", async () => {
    // Grid of cards is the default presentation (lib/orders/list-layout.ts).
    // Cards are located by their h2 title inside the labelled grid, not by tag.
    const findCard = async () => {
      const searchBox = page.getByRole("searchbox", { name: "Buscar" });
      await searchBox.waitFor();
      assert.equal(
        await page.getByRole("button", { name: "Cuadrícula", exact: true }).getAttribute("aria-pressed"),
        "true",
        "orders list must be in card view",
      );
      const listed = observe(page.waitForResponse((response: { url(): string; request(): { method(): string } }) =>
        isApi("GET", /^\/api\/orders$/)(response) && new URL(response.url()).searchParams.get("q") === state.reference));
      await searchBox.fill(state.reference!);
      const body = await apiJson(await listed, 200);
      const orders = body.orders as { id: string; reference: string }[];
      assert.deepEqual(orders.map((order) => order.reference), [state.reference], "search returns exactly this order");

      const grid = page.getByLabel("Pedidos en cuadrícula");
      const card = grid.locator(":scope > *").filter({
        has: page.getByRole("heading", { level: 2, name: state.orderTitle, exact: true }),
      });
      await card.waitFor();
      assert.equal(await card.count(), 1, "exactly one card for this order");
      await card.getByText(state.reference!, { exact: true }).waitFor();
      await card.getByText(state.clientName, { exact: true }).waitFor();
      await card.getByText("Recibido", { exact: true }).waitFor();
      await card.getByText(/\d{2}\/\d{2}\/\d{4}, 18:00/).waitFor();
    };

    await page.goto(`${target.baseUrl}/orders?view=list&filter=all`);
    await findCard();
    // The search term lives only in component state, so it is typed again after reload.
    await page.reload();
    await findCard();
  });

  await h.step("order persisted (reload + API)", async () => {
    await page.goto(`${target.baseUrl}/orders/${state.orderId}`);
    await page.getByRole("heading", { level: 1, name: state.orderTitle }).waitFor();
    await page.getByText(state.reference!, { exact: true }).waitFor();
    await page.getByText(/Entrega \d{2}\/\d{2}\/\d{4}, 18:00/).waitFor();
    const body = await appGet(page, `/api/orders/${state.orderId}`);
    const order = body.order as { reference: string; title: string; status: { code: string } };
    assert.equal(order.reference, state.reference);
    assert.equal(order.title, state.orderTitle);
    assert.equal(order.status.code, "received");
  });
}

async function flowFiles(page: Page) {
  const content = Buffer.from(`Gestcopy E2E V0\nrun=${id}\norder=${state.reference}\n${"x".repeat(512)}\n`, "utf8");
  state.fileSha256 = createHash("sha256").update(content).digest("hex");

  await h.step("upload file (INIT → PUT → COMPLETE)", async () => {
    await page.goto(`${target.baseUrl}/orders/${state.orderId}`);
    await page.getByRole("heading", { level: 2, name: "Archivos" }).waitFor();
    await page.getByRole("button", { name: "Añadir archivos" }).first().click();

    const init = observe(page.waitForResponse(isApi("POST", new RegExp(`^/api/orders/${state.orderId}/files$`))));
    const put = observe(new Promise<{ status: number; url: string } | { failure: string; url: string }>((resolve, reject) => {
      const isR2Put = (request: { method(): string; url(): string }) =>
        request.method() === "PUT" && r2BucketFromUrl(request.url()) !== null;
      const cleanup = () => {
        page.off("response", onResponse);
        page.off("requestfailed", onFailed);
        clearTimeout(timer);
      };
      const onResponse = (response: { status(): number; url(): string; request(): { method(): string; url(): string } }) => {
        if (!isR2Put(response.request())) return;
        cleanup();
        resolve({ status: response.status(), url: response.url() });
      };
      const onFailed = (request: { method(): string; url(): string; failure(): { errorText: string } | null }) => {
        if (!isR2Put(request)) return;
        cleanup();
        resolve({ failure: request.failure()?.errorText ?? "unknown", url: request.url() });
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("no R2 PUT observed within 30 s after INIT"));
      }, 30_000);
      page.on("response", onResponse);
      page.on("requestfailed", onFailed);
    }));
    const complete = observe(page.waitForResponse(isApi("POST", new RegExp(`^/api/orders/${state.orderId}/files/[^/]+/complete$`))));

    await page.locator('input[type=file][aria-label="Seleccionar archivos para el pedido"]').setInputFiles({
      name: state.fileName,
      mimeType: "text/plain",
      buffer: content,
    });

    const initBody = await apiJson(await init, 201);
    state.fileId = initBody.file_id as string;
    const bucket = r2BucketFromUrl(initBody.upload_url as string);
    assert.equal(bucket, target.r2Bucket, "presigned upload must target the Staging bucket");
    h.log(`INIT 201 file ${state.fileId} → bucket ${bucket}`);

    const putOutcome = await put;
    assert.equal(r2BucketFromUrl(putOutcome.url), target.r2Bucket);
    if ("failure" in putOutcome) throw new Error(`R2 PUT failed in the browser: ${putOutcome.failure}`);
    assert.equal(putOutcome.status, 200, `R2 PUT → HTTP ${putOutcome.status}`);
    h.log("PUT 200 (R2)");

    // The client never reads the COMPLETE body on success, so with interception on the
    // browser may never finish it: assert the status here, the result through the API.
    const completeResponse = await complete;
    assert.ok(new URL(completeResponse.url()).pathname.includes(`/files/${state.fileId}/complete`));
    assert.equal(completeResponse.status(), 200, `COMPLETE → HTTP ${completeResponse.status()}`);
    const listed = await appGet(page, `/api/orders/${state.orderId}/files`);
    const file = (listed.files as { id: string; status: string; size_bytes: number; original_name: string }[])
      .find((entry) => entry.id === state.fileId);
    assert.equal(file?.status, "ready", "COMPLETE (server-side HEAD) must mark the file ready");
    assert.equal(Number(file.size_bytes), content.byteLength);
    assert.equal(file.original_name, state.fileName);
    h.log("COMPLETE 200, status ready");
  });

  await h.step("file listed after reload", async () => {
    await page.reload();
    await page.getByRole("button", { name: `Descargar ${state.fileName}` }).waitFor();
    const body = await appGet(page, `/api/orders/${state.orderId}/files`);
    const files = body.files as { id: string; status: string; original_name: string }[];
    const listed = files.find((file) => file.id === state.fileId);
    assert.equal(listed?.status, "ready");
    assert.equal(listed?.original_name, state.fileName);
  });

  await h.step("download and verify SHA-256", async () => {
    const download = observe(page.waitForEvent("download"));
    const issued = observe(page.waitForResponse(isApi("POST", new RegExp(`^/api/orders/${state.orderId}/files/${state.fileId}/download$`))));
    await page.getByRole("button", { name: `Descargar ${state.fileName}` }).click();
    const issuedBody = await apiJson(await issued, 200);
    assert.equal(r2BucketFromUrl(issuedBody.download_url as string), target.r2Bucket);
    const file = await download;
    const saved = await within<string | null>(file.path(), 30_000, "download");
    assert.ok(saved, `download failed: ${await within(file.failure(), 5_000, "download failure").catch(() => "unknown")}`);
    const digest = createHash("sha256").update(await readFile(saved)).digest("hex");
    assert.equal(digest, state.fileSha256, "downloaded content must match the uploaded bytes");
    assert.equal(file.suggestedFilename(), state.fileName);
  });
}

async function flowPayment(page: Page) {
  const pending = (Number(ORDER_TOTAL) - Number(PARTIAL_PAYMENT)).toFixed(2);
  const dialog = (title: string) => page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: title }) });

  const expectCollection = async (paid: string, pendingAmount: string, situation: string) => {
    await fact(page, "Total del pedido").filter({ hasText: money(ORDER_TOTAL) }).waitFor();
    await fact(page, "Entregado a cuenta").filter({ hasText: money(paid) }).waitFor();
    await fact(page, "Pendiente de cobro").filter({ hasText: money(pendingAmount) }).waitFor();
    await fact(page, "Situación").filter({ hasText: situation }).waitFor();
  };

  await h.step("define order total", async () => {
    await page.goto(`${target.baseUrl}/orders/${state.orderId}`);
    await page.getByRole("heading", { level: 2, name: "Cobro y entrega" }).waitFor();
    await fact(page, "Total del pedido").filter({ hasText: "Sin definir" }).waitFor();
    await page.getByRole("button", { name: "Definir total" }).click();
    const totalDialog = dialog("Total del pedido");
    await totalDialog.getByLabel("Importe").fill(ORDER_TOTAL.replace(".", ","));
    const saved = observe(page.waitForResponse(isApi("PATCH", new RegExp(`^/api/orders/${state.orderId}/total$`))));
    await totalDialog.getByRole("button", { name: "Guardar total" }).click();
    const body = await apiJson(await saved, 200);
    assert.equal(body.total_amount, ORDER_TOTAL);
    assert.equal(body.collection_state, "unpaid");
  });

  const receiptContent = Buffer.from(`Gestcopy E2E V0 justificante\nrun=${id}\n`, "utf8");
  const receiptSha256 = createHash("sha256").update(receiptContent).digest("hex");
  type RecordedPayment = { id: string; payment_method: string | null; receipt: { id: string; original_name: string } | null };

  await h.step("register partial payment (entrega a cuenta, método y justificante)", async () => {
    await page.getByRole("button", { name: "Registrar entrega a cuenta" }).click();
    const paymentDialog = dialog("Registrar entrega a cuenta");
    await paymentDialog.getByLabel("Importe").fill(PARTIAL_PAYMENT.replace(".", ","));
    await paymentDialog.getByLabel("Método de pago").selectOption({ label: "Bizum" });
    await paymentDialog.locator("#payment-receipt-file").setInputFiles({
      name: state.receiptName,
      mimeType: "text/plain",
      buffer: receiptContent,
    });
    await paymentDialog.getByText(state.receiptName, { exact: true }).waitFor();
    // The receipt goes INIT → PUT (R2) → COMPLETE before the monetary POST.
    const recorded = observe(page.waitForResponse(
      isApi("POST", new RegExp(`^/api/orders/${state.orderId}/payments$`)),
      { timeout: 60_000 },
    ));
    await paymentDialog.getByRole("button", { name: "Confirmar entrega" }).click();
    const body = await apiJson(await recorded, 200);
    assert.equal(body.paid_amount, PARTIAL_PAYMENT);
    assert.equal(body.pending_amount, pending);
    assert.equal(body.collection_state, "partial");
    const recordedPayments = body.payments as RecordedPayment[];
    assert.equal(recordedPayments.length, 1, "exactly one movement after the first payment");
    const payment = recordedPayments.find((row) => row.receipt?.original_name === state.receiptName);
    assert.ok(payment, "the recorded payment carries its receipt");
    assert.equal(payment.payment_method, "bizum");
    assert.equal(payment.receipt?.original_name, state.receiptName);
    assert.equal(JSON.stringify(body).includes("storage_key"), false, "no storage keys in the payment DTO");
    state.receiptId = payment.receipt?.id;
    await expectCollection(PARTIAL_PAYMENT, pending, "Parcial");
  });

  await h.step("partial payment persisted after reload", async () => {
    await page.reload();
    await expectCollection(PARTIAL_PAYMENT, pending, "Parcial");
    const body = await appGet(page, `/api/orders/${state.orderId}/payments`);
    assert.equal(body.total_amount, ORDER_TOTAL);
    assert.equal(body.paid_amount, PARTIAL_PAYMENT);
    assert.equal(body.pending_amount, pending);
    const payments = body.payments as RecordedPayment[];
    assert.equal(payments.length, 1);
    assert.equal(payments[0].payment_method, "bizum");
    assert.equal(payments[0].receipt?.id, state.receiptId);
    await page.getByText(/^Bizum ·/).first().waitFor();
  });

  await h.step("download the private receipt and verify SHA-256", async () => {
    const download = observe(page.waitForEvent("download"));
    const issued = observe(page.waitForResponse(isApi("POST", new RegExp(`^/api/orders/${state.orderId}/files/${state.receiptId}/download$`))));
    await page.getByRole("button", { name: `Justificante: ${state.receiptName}` }).click();
    const issuedBody = await apiJson(await issued, 200);
    assert.equal(r2BucketFromUrl(issuedBody.download_url as string), target.r2Bucket);
    const file = await download;
    const saved = await within<string | null>(file.path(), 30_000, "receipt download");
    assert.ok(saved, "receipt download failed");
    const digest = createHash("sha256").update(await readFile(saved)).digest("hex");
    assert.equal(digest, receiptSha256, "downloaded receipt must match the uploaded bytes");
  });

  const changeStatus = async (name: string, code: string, confirmTitle?: string) => {
    await page.getByRole("button", { name: "Cambiar estado" }).click();
    const statusDialog = dialog("Cambiar estado");
    await statusDialog.getByLabel("Estado").selectOption({ label: name });
    const patched = observe(page.waitForResponse(isApi("PATCH", new RegExp(`^/api/orders/${state.orderId}$`))));
    await statusDialog.getByRole("button", { name: "Guardar estado" }).click();
    if (confirmTitle) {
      await dialog(confirmTitle).getByRole("button", { name: "Confirmar entrega" }).click();
    }
    const body = await apiJson(await patched, 200);
    assert.equal((body.status as { code: string }).code, code);
    await page.getByText("Estado actualizado").first().waitFor();
    return body.order as { ready_at: string | null; delivered_at: string | null };
  };

  await h.step("status: En proceso → Listo → Entregado", async () => {
    await changeStatus("En proceso", "in_progress");
    const ready = await changeStatus("Listo", "ready");
    assert.ok(ready.ready_at, "ready_at is set on the first ready status");
    const delivered = await changeStatus("Entregado", "closed", "Marcar pedido como entregado");
    assert.ok(delivered.delivered_at, "delivered_at is set on the first closed status");
  });

  await h.step("delivered order keeps the partial balance after reload", async () => {
    await page.reload();
    await page.getByRole("heading", { level: 1, name: state.orderTitle }).waitFor();
    await expectCollection(PARTIAL_PAYMENT, pending, "Parcial");
    const body = await appGet(page, `/api/orders/${state.orderId}`);
    const order = body.order as { status: { code: string }; delivered_at: string | null; archived_at: string | null };
    assert.equal(order.status.code, "closed");
    assert.ok(order.delivered_at);
    assert.equal(order.archived_at, null, "V0 never archives");
  });
}

async function main() {
  const results: FlowResult[] = [];
  let exitCode = 0;
  h.log(`run ${id} → ${target.baseUrl} (tenant e2e, bucket ${target.r2Bucket})`);
  try {
    await h.start(process.env.PLAYWRIGHT_MODULE || "playwright");
    // files and payment both need the order from flow 1, not each other.
    for (const [name, flow] of [["orders", flowOrders], ["files", flowFiles], ["payment", flowPayment]] as const) {
      if (name !== "orders" && results[0]?.status !== "passed") {
        results.push({ name, status: "skipped", ms: 0 });
        continue;
      }
      const started = Date.now();
      try {
        await flow(h.page);
        results.push({ name, status: "passed", ms: Date.now() - started });
      } catch (error) {
        exitCode = 1;
        const message = redactor.text(error instanceof Error ? error.message : String(error));
        results.push({ name, status: "failed", ms: Date.now() - started, error: message.slice(0, 1000) });
      }
    }
    h.assertNoProductionEgress();
  } catch (error) {
    exitCode = 1;
    h.log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    const report = {
      run: id,
      target: { baseUrl: target.baseUrl, bucket: target.r2Bucket },
      order: { id: state.orderId, reference: state.reference, title: state.orderTitle, client: state.clientName },
      file: { id: state.fileId, name: state.fileName, sha256: state.fileSha256 },
      receipt: { id: state.receiptId, name: state.receiptName },
      results,
      blockedRequests: h.blocked.length,
      apiErrors: h.network.filter((entry) => entry.status === null || entry.status >= 400),
    };
    for (const result of results) h.log(`${result.status.toUpperCase()} ${result.name} (${result.ms} ms)${result.error ? ` — ${result.error}` : ""}`);
    try {
      await h.finish(report);
    } catch (error) {
      exitCode = 1;
      console.error(redactor.text(`artifact check failed: ${error instanceof Error ? error.message : String(error)}`));
    }
    console.log(redactor.text(`artifacts: ${artifactsDir}`));
  }
  process.exit(exitCode);
}

void main();
