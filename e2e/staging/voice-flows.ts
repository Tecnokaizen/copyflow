/**
 * Gestcopy AI · Pedidos por voz (#90) browser flows, shared by the Staging
 * runner (voice-orders.ts) and local full-stack checks. Provider `fake` only:
 * the runner refuses to start unless /status reports a ready module, and the
 * Staging deployment must run with AI_PROVIDER=fake (docs/VOICE-ORDERS-AI-V1.md).
 *
 * Invariant checked on every flow: no browser request writes /api/orders
 * until the user presses «Crear pedido» themselves.
 */
import assert from "node:assert/strict";
import type { Harness, Page } from "./harness";

export type VoiceExpectation = "on" | "off" | "kill_switch" | "budget_exhausted";

export const VOICE_EXPECTATIONS: readonly VoiceExpectation[] = [
  "on",
  "off",
  "kill_switch",
  "budget_exhausted",
];

export const MOBILE_CONTEXT = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
};

export function parseVoiceExpectation(value: string | undefined): VoiceExpectation {
  if (value && (VOICE_EXPECTATIONS as readonly string[]).includes(value)) {
    return value as VoiceExpectation;
  }
  throw new Error(`E2E_VOICE_EXPECT must be one of ${VOICE_EXPECTATIONS.join(", ")}`);
}

/** Every non-GET request the page sends to /api/orders (create, patch, …). */
export function watchOrderWrites(page: Page, baseUrl: string) {
  const writes: string[] = [];
  page.on("request", (request: { method(): string; url(): string }) => {
    const url = new URL(request.url());
    if (url.origin !== baseUrl) return;
    if (request.method() !== "GET" && /^\/api\/orders(\/|$)/.test(url.pathname)) {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });
  return {
    count: () => writes.length,
    assertNone(context: string) {
      assert.deepEqual(writes, [], `${context}: the AI must never write orders`);
    },
  };
}

/**
 * Counts getUserMedia calls and answers them with a synthetic tone (Web Audio
 * oscillator) instead of a device: MediaRecorder records real webm/opus, no
 * microphone or OS permission is involved (Chromium's fake device hangs on
 * macOS headless) and nothing personal can be captured.
 */
export async function watchMicrophone(page: Page) {
  await page.addInitScript(() => {
    const scope = window as unknown as { __gcMicrophoneCalls: number };
    scope.__gcMicrophoneCalls = 0;
    const devices = navigator.mediaDevices;
    if (devices?.getUserMedia) {
      devices.getUserMedia = async () => {
        scope.__gcMicrophoneCalls += 1;
        const audio = new AudioContext();
        const tone = audio.createOscillator();
        const destination = audio.createMediaStreamDestination();
        tone.connect(destination);
        tone.start();
        return destination.stream;
      };
    }
  });
}

async function microphoneCalls(page: Page): Promise<number> {
  return page.evaluate(
    () => (window as unknown as { __gcMicrophoneCalls?: number }).__gcMicrophoneCalls ?? 0
  );
}

export async function login(h: Harness, baseUrl: string, label: string, email: string, password: string) {
  const page = h.page;
  await h.step(`${label}: login`, async () => {
    await page.goto(`${baseUrl}/auth/login`);
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await Promise.all([
      page.waitForURL((url: URL) => url.origin === baseUrl && !url.pathname.startsWith("/auth/")),
      page.getByRole("button", { name: "Login", exact: true }).click(),
    ]);
  });
}

type VoiceStatus = {
  enabled: boolean;
  reason: string | null;
  limits: { max_clip_seconds: number; max_audio_bytes: number };
  remaining: { user_requests_today: number | null };
};

export async function readStatus(page: Page, baseUrl: string): Promise<VoiceStatus> {
  const response = await page.request.get(`${baseUrl}/api/ai/voice-orders/status`);
  assert.equal(response.status(), 200, "status endpoint");
  assert.match(response.headers()["cache-control"] ?? "", /\bprivate\b.*\bno-store\b/);
  const body = (await response.json()) as VoiceStatus;
  for (const key of ["monthly_budget_micros", "spent", "budget_micros"]) {
    assert.equal(JSON.stringify(body).includes(key), false, `status must not expose ${key}`);
  }
  return body;
}

function postDraft(page: Page, baseUrl: string, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return page.request.post(`${baseUrl}/api/ai/voice-orders/drafts`, {
    data: body,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function draftBody(transcript: string, extra: Record<string, unknown> = {}) {
  return {
    request_id: crypto.randomUUID(),
    transcript,
    source: "typed",
    mode: "full",
    visible_fields: [],
    ...extra,
  };
}

const FORM_URL = (baseUrl: string) => `${baseUrl}/orders?create=1`;

async function openForm(page: Page, baseUrl: string) {
  await page.goto(FORM_URL(baseUrl));
  await page.getByRole("button", { name: "Crear pedido", exact: true }).waitFor();
}

/** The voice panel is the closest section around its heading (the form card is a section too). */
function panel(page: Page) {
  return page
    .getByRole("heading", { level: 2, name: "Pedido por voz" })
    .locator("xpath=ancestor::section[1]");
}

async function formValues(page: Page) {
  return {
    title: await page.getByPlaceholder("Ej. 200 tarjetas de visita").inputValue(),
    // <label>Prioridad<select/></label>: the select's name includes its value.
    priority: await page.getByRole("combobox", { name: /^Prioridad\b/ }).inputValue(),
    // Tiptap's contenteditable carries aria-label but no textbox role.
    description: (await page.locator('[contenteditable][aria-label="Instrucciones"]').innerText()).trim(),
    time: (await page.getByRole("button", { name: "Hora", exact: true }).innerText()).trim(),
  };
}

async function assertNoHorizontalOverflow(page: Page, context: string) {
  assert.ok(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    `${context}: horizontal overflow`
  );
}

/**
 * Closes the «Crear cliente» modal a draft opens for a client it did not find
 * (ClientModal is a fixed overlay without role=dialog).
 */
async function dismissClientDialog(page: Page) {
  const heading = page.getByRole("heading", { name: "Crear cliente", exact: true });
  if (await heading.isVisible().catch(() => false)) {
    const modal = heading.locator("xpath=ancestor::div[contains(@class, 'fixed')][1]");
    await modal.getByRole("button", { name: "Cancelar", exact: true }).click();
    await heading.waitFor({ state: "hidden" });
  }
}

/** Module closed (feature off, kill switch): hidden panel, no microphone, API refuses. */
export async function closedModule(h: Harness, baseUrl: string, expect: "off" | "kill_switch", label: string) {
  const page = h.page;
  const writes = watchOrderWrites(page, baseUrl);
  await h.step(`${label}: status closed (${expect})`, async () => {
    const status = await readStatus(page, baseUrl);
    assert.equal(status.enabled, false);
    if (expect === "kill_switch") {
      assert.equal(status.reason, "platform_disabled");
    } else {
      assert.ok(
        ["feature_disabled", "ai_unavailable"].includes(status.reason ?? ""),
        `unexpected reason ${status.reason}`
      );
    }
  });
  await h.step(`${label}: form without voice`, async () => {
    await openForm(page, baseUrl);
    assert.equal(await panel(page).count(), 0, "voice panel must be hidden");
    assert.equal(await microphoneCalls(page), 0, "getUserMedia must not be called");
    await h.screenshot(`${label} form closed`);
  });
  await h.step(`${label}: API refuses drafts`, async () => {
    const response = await postDraft(page, baseUrl, draftBody("E2E voz: módulo cerrado"));
    const expected = expect === "kill_switch" ? [429] : [404, 503];
    assert.ok(expected.includes(response.status()), `HTTP ${response.status()}`);
  });
  writes.assertNone(label);
}

/** Operator set a zero budget for this user: the draft fails and nothing is applied. */
export async function budgetExhausted(h: Harness, baseUrl: string, label: string) {
  const page = h.page;
  const writes = watchOrderWrites(page, baseUrl);
  await h.step(`${label}: exhausted budget`, async () => {
    const status = await readStatus(page, baseUrl);
    assert.equal(status.enabled, true, "budget exhaustion does not hide the module");
    const response = await postDraft(page, baseUrl, draftBody("E2E voz: presupuesto agotado"));
    assert.equal(response.status(), 429);
    assert.equal((await response.json()).code, "ai_budget_exhausted");
  });
  await h.step(`${label}: form shows the error and applies nothing`, async () => {
    await openForm(page, baseUrl);
    const before = await formValues(page);
    await panel(page).getByRole("button", { name: "Escribir en lugar de dictar" }).click();
    await panel(page).getByPlaceholder("Describe el pedido…").fill("E2E voz: 20 carteles, urgente, mañana a las 10");
    await panel(page).getByRole("button", { name: "Interpretar texto" }).click();
    await panel(page).getByRole("alert").filter({ hasText: "Presupuesto de IA agotado" }).waitFor();
    assert.deepEqual(await formValues(page), before, "no field may change");
    await h.screenshot(`${label} budget exhausted`);
  });
  writes.assertNone(label);
}

/** Viewer of an enabled tenant: no module, API forbidden. */
export async function viewerDenied(h: Harness, baseUrl: string, label: string) {
  const page = h.page;
  await h.step(`${label}: viewer has no voice module`, async () => {
    const status = await readStatus(page, baseUrl);
    assert.equal(status.enabled, false);
    assert.equal(status.reason, "role");
    const response = await postDraft(page, baseUrl, draftBody("E2E voz: viewer"));
    assert.equal(response.status(), 403);
    assert.equal(await microphoneCalls(page), 0);
  });
}

/** API contracts that need no UI: origin, body validation, tenant pinning, cache. */
export async function apiContracts(h: Harness, baseUrl: string, tenantSlug: string, label: string) {
  const page = h.page;
  await h.step(`${label}: API contracts`, async () => {
    const before = await readStatus(page, baseUrl);
    assert.equal(before.enabled, true, `module not ready: ${before.reason}`);

    const foreign = await postDraft(page, baseUrl, draftBody("E2E voz: 10 sobres"), {
      Origin: "https://evil.example",
    });
    assert.equal(foreign.status(), 403);
    assert.equal((await foreign.json()).code, "invalid_origin");

    // The browser always sends Origin on POST: the page's own origin must pass.
    const own = await postDraft(page, baseUrl, { ...draftBody("x"), request_id: "not-a-uuid" }, {
      Origin: baseUrl,
    });
    assert.equal(own.status(), 422, "same-origin request reaches body validation");

    const invalid = await postDraft(page, baseUrl, { ...draftBody("x"), request_id: "not-a-uuid" });
    assert.equal(invalid.status(), 422);

    // tenant_id / tenant_slug in the body are ignored: the session's tenant wins.
    const pinned = await postDraft(
      page,
      baseUrl,
      draftBody("E2E voz: 10 sobres", {
        tenant_id: "00000000-0000-4000-8000-000000000000",
        tenant_slug: "sur4",
      })
    );
    assert.equal(pinned.status(), 200);
    assert.match(pinned.headers()["cache-control"] ?? "", /\bprivate\b.*\bno-store\b/);
    const draft = await pinned.json();
    assert.equal(draft.tenant_slug, tenantSlug);
    assert.equal(draft.version, "voice-order-draft/v1");

    const text = await page.request.post(`${baseUrl}/api/ai/voice-orders/transcriptions`, {
      multipart: {
        request_id: crypto.randomUUID(),
        audio: { name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("no es audio") },
      },
    });
    assert.ok([415, 422].includes(text.status()), `non-audio upload HTTP ${text.status()}`);

    const after = await readStatus(page, baseUrl);
    if (before.remaining.user_requests_today !== null) {
      assert.equal(
        after.remaining.user_requests_today,
        before.remaining.user_requests_today - 1,
        "only the accepted draft counts toward the daily limit"
      );
    }
    assert.ok(after.limits.max_clip_seconds > 0 && after.limits.max_audio_bytes > 0);
  });
}

/** Typed dictation → draft applied → «Descartar» restores the form. */
export async function typedDraftAndDiscard(h: Harness, baseUrl: string, tag: string, label: string) {
  const page = h.page;
  const writes = watchOrderWrites(page, baseUrl);
  await h.step(`${label}: typed draft is applied, not saved`, async () => {
    await openForm(page, baseUrl);
    await panel(page).waitFor();
    await assertNoHorizontalOverflow(page, label);
    const before = await formValues(page);
    assert.equal(before.title, "");

    await panel(page).getByRole("button", { name: "Escribir en lugar de dictar" }).click();
    await panel(page).getByPlaceholder("Describe el pedido…").fill(`E2E voz ${tag}: 200 tarjetas, urgente, mañana a las 10`);
    await panel(page).getByRole("button", { name: "Interpretar texto" }).click();
    await panel(page).getByRole("heading", { level: 3, name: "Revisión del dictado" }).waitFor();
    await dismissClientDialog(page);

    const after = await formValues(page);
    assert.match(after.title, /^Pedido /, "title proposed");
    assert.equal(after.priority, "urgent");
    assert.match(after.description, new RegExp(`E2E voz ${tag}`));
    assert.equal(after.time, "10:00");
    await panel(page).getByText("La IA no crea el pedido.", { exact: false }).waitFor();
    await assertNoHorizontalOverflow(page, label);
    await h.screenshot(`${label} draft applied`);
    writes.assertNone(`${label} after draft`);

    await panel(page).getByRole("button", { name: "Descartar", exact: true }).click();
    await panel(page).getByText("El formulario vuelve a como estaba.", { exact: false }).waitFor();
    assert.deepEqual(await formValues(page), before, "Descartar restores every field");
    await h.screenshot(`${label} discarded`);
  });
  writes.assertNone(label);
}

/**
 * Recorded dictation (fake microphone) → transcript → draft. Nothing is saved
 * until the user presses «Crear pedido»; then exactly one order is created.
 */
export async function recordedDraftThenHumanCreate(h: Harness, baseUrl: string, tag: string, label: string) {
  const page = h.page;
  const writes = watchOrderWrites(page, baseUrl);
  await h.step(`${label}: record, transcribe, interpret`, async () => {
    await openForm(page, baseUrl);
    const voice = panel(page);
    await voice.getByRole("button", { name: "Dictar pedido" }).click();
    await voice.getByRole("button", { name: "Detener" }).waitFor();
    await page.waitForTimeout(1500);
    await voice.getByRole("button", { name: "Detener" }).click();
    await voice.getByRole("button", { name: "Usar grabación" }).click();
    const transcript = voice.getByLabel("Transcripción (editable)");
    await transcript.waitFor();
    assert.ok((await transcript.inputValue()).trim().length > 0, "transcript");
    assert.ok((await microphoneCalls(page)) >= 1, "the recorder used the microphone");
    await voice.getByRole("button", { name: "Interpretar", exact: true }).click();
    await voice.getByRole("heading", { level: 3, name: "Revisión del dictado" }).waitFor();
    await dismissClientDialog(page);
    assert.equal((await formValues(page)).priority, "urgent");
    await h.screenshot(`${label} recorded draft`);
    writes.assertNone(`${label} after recorded draft`);
  });

  await h.step(`${label}: human confirmation creates one order`, async () => {
    // The human edits the proposal: a touched field is theirs.
    await page.getByPlaceholder("Ej. 200 tarjetas de visita").fill(`E2E voz ${tag}`);
    const [response] = await Promise.all([
      page.waitForResponse(
        (candidate: { url(): string; request(): { method(): string } }) =>
          candidate.request().method() === "POST" && new URL(candidate.url()).pathname === "/api/orders"
      ),
      page.getByRole("button", { name: "Crear pedido", exact: true }).click(),
    ]);
    assert.equal(response.status(), 201);
    const body = await response.json();
    assert.equal(body.order?.title, `E2E voz ${tag}`);
    assert.equal(body.order?.priority, "urgent");
    await page.waitForURL((url: URL) => url.pathname === `/orders/${body.order.id}`);
    assert.equal(writes.count(), 1, "exactly one write: the user's own «Crear pedido»");
    h.log(`order ${body.order.reference} created by the user`);
  });
}

/** A field the user typed is kept; «Reemplazar» takes the proposal; «Descartar» returns to the typed value. */
export async function touchedFieldReplaceAndDiscard(h: Harness, baseUrl: string, tag: string, label: string) {
  const page = h.page;
  const writes = watchOrderWrites(page, baseUrl);
  await h.step(`${label}: touched field, Reemplazar and Descartar`, async () => {
    await openForm(page, baseUrl);
    const typed = `Manual ${tag}`;
    await page.getByPlaceholder("Ej. 200 tarjetas de visita").fill(typed);

    const voice = panel(page);
    await voice.getByRole("button", { name: "Escribir en lugar de dictar" }).click();
    await voice.getByPlaceholder("Describe el pedido…").fill(`E2E voz ${tag}: 50 sobres`);
    await voice.getByRole("button", { name: "Interpretar texto" }).click();
    await voice.getByRole("heading", { level: 3, name: "Revisión del dictado" }).waitFor();
    await dismissClientDialog(page);
    assert.equal((await formValues(page)).title, typed, "a typed field is never overwritten");

    await voice.getByRole("button", { name: "Reemplazar Título" }).click();
    assert.match((await formValues(page)).title, /^Pedido /, "Reemplazar applies the proposal");
    const description = (await formValues(page)).description;
    assert.equal(
      description.split(`E2E voz ${tag}`).length - 1,
      1,
      "Reemplazar must not append the description again"
    );

    await voice.getByRole("button", { name: "Descartar", exact: true }).click();
    const restored = await formValues(page);
    assert.equal(restored.title, typed, "Descartar returns to the typed title");
    assert.equal(restored.description, "");
    await h.screenshot(`${label} replace discarded`);
  });
  writes.assertNone(label);
}
