import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  STATUS_POLL_MAX_ATTEMPTS,
  nextOnboardingPollStep,
  type OnboardingSuccessView,
} from "./success-polling";

/** Runs the page's polling loop against a fixed answer; returns the final view and polls used. */
function runPolling(answer: { httpStatus: number | null; bodyState?: unknown }) {
  let view: OnboardingSuccessView = "processing";
  for (let attempt = 1; attempt <= STATUS_POLL_MAX_ATTEMPTS + 5; attempt += 1) {
    const step = nextOnboardingPollStep({ ...answer, attempt });
    if (step.view) view = step.view;
    if (!step.pollAgain) return { view, polls: attempt };
  }
  throw new Error("polling never stopped");
}

describe("onboarding success polling: final states", () => {
  it("stops on the server's final states", () => {
    for (const state of ["active", "failed", "disabled"] as const) {
      assert.deepEqual(nextOnboardingPollStep({ httpStatus: 200, bodyState: state, attempt: 1 }), {
        view: state,
        pollAgain: false,
      });
    }
  });

  it("keeps polling while processing and ends visibly after the last attempt", () => {
    assert.deepEqual(nextOnboardingPollStep({ httpStatus: 200, bodyState: "processing", attempt: 1 }), {
      view: "processing",
      pollAgain: true,
    });
    assert.deepEqual(runPolling({ httpStatus: 200, bodyState: "processing" }), {
      view: "timeout",
      polls: STATUS_POLL_MAX_ATTEMPTS,
    });
  });

  it("keeps the pending-payment card (it already offers to continue) after the last attempt", () => {
    assert.deepEqual(runPolling({ httpStatus: 200, bodyState: "awaiting_payment" }), {
      view: "awaiting_payment",
      polls: STATUS_POLL_MAX_ATTEMPTS,
    });
  });

  it("treats an unreadable 200 body as retryable, never as success", () => {
    for (const bodyState of [undefined, null, "unknown", 42]) {
      assert.deepEqual(nextOnboardingPollStep({ httpStatus: 200, bodyState, attempt: 1 }), {
        view: null,
        pollAgain: true,
      });
    }
    assert.equal(runPolling({ httpStatus: 200, bodyState: "unknown" }).view, "timeout");
  });
});

describe("onboarding success polling: errors are never hidden (S10, 31/10)", () => {
  it("403 from a non-owner account stops at once instead of 24 silent polls", () => {
    assert.deepEqual(runPolling({ httpStatus: 403 }), { view: "forbidden", polls: 1 });
  });

  it("401 (session ended) stops at once and asks to sign in again", () => {
    assert.deepEqual(runPolling({ httpStatus: 401 }), { view: "unauthenticated", polls: 1 });
  });

  it("unrecognized checkout sessions (400, 404) stop at once", () => {
    for (const httpStatus of [400, 404, 422]) {
      assert.deepEqual(runPolling({ httpStatus }), { view: "invalid", polls: 1 }, String(httpStatus));
    }
  });

  it("network failures, 5xx and retryable 4xx retry, then end on a visible timeout", () => {
    for (const httpStatus of [null, 408, 409, 429, 500, 502, 503]) {
      assert.deepEqual(
        nextOnboardingPollStep({ httpStatus, attempt: 1 }),
        { view: null, pollAgain: true },
        String(httpStatus)
      );
      assert.deepEqual(
        runPolling({ httpStatus }),
        { view: "timeout", polls: STATUS_POLL_MAX_ATTEMPTS },
        String(httpStatus)
      );
    }
  });

  it("no answer ever leaves the page on «Confirmando…» once polling stops", () => {
    for (const answer of [
      { httpStatus: 200, bodyState: "processing" },
      { httpStatus: 200 },
      { httpStatus: 401 },
      { httpStatus: 403 },
      { httpStatus: 404 },
      { httpStatus: 503 },
      { httpStatus: null },
    ]) {
      assert.notEqual(runPolling(answer).view, "processing", JSON.stringify(answer));
    }
  });
});

describe("onboarding success polling: wiring", () => {
  const success = readFileSync("components/onboarding/onboarding-success-status.tsx", "utf8");

  it("the page decides every poll with nextOnboardingPollStep and has no silent catch-all", () => {
    assert.match(success, /nextOnboardingPollStep\(\{\s*httpStatus,\s*bodyState: body\?\.state,\s*attempt,\s*\}\)/);
    assert.match(success, /httpStatus = response\.status/);
    assert.doesNotMatch(success, /keep processing/);
    assert.doesNotMatch(success, /attempt >= 24/);
  });

  it("every stopping state has a visible card with a way forward", () => {
    for (const [state, text] of [
      ["forbidden", "Esta cuenta no puede confirmar el pago"],
      ["unauthenticated", "Tu sesión ha terminado"],
      ["invalid", "No podemos validar este pago"],
      ["timeout", "Todavía no podemos confirmar tu suscripción"],
    ] as const) {
      assert.match(success, new RegExp(`state === "${state}"`), state);
      assert.ok(success.includes(text), text);
    }
    assert.match(success, /Volver a comprobar/);
    assert.match(success, /\[sessionId, round\]/);
  });

  it("the forbidden card names the signed-in account, passed by the server page", () => {
    assert.match(success, /Has iniciado sesión como \$\{signedInEmail\}/);
    const page = readFileSync("app/onboarding/success/page.tsx", "utf8");
    assert.match(page, /signedInEmail=\{user\.email \?\? null\}/);
  });
});
