import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertSameOrigin,
  canAccessVoiceOrdersModule,
  isProductionDeployment,
  isVoiceOrdersEnvEnabled,
  resolveAiProviderName,
  voiceOrdersProviderConfigured,
} from "@/lib/ai/voice-orders/feature";

const OPENAI_READY = {
  OPENAI_API_KEY: "sk-test",
  AI_TRANSCRIPTION_MODEL: "transcribe-model",
  AI_EXTRACTION_MODEL: "extract-model",
};

describe("voice orders access helpers", () => {
  it("allows operative roles only when the feature is on", () => {
    assert.equal(canAccessVoiceOrdersModule("staff", true), true);
    assert.equal(canAccessVoiceOrdersModule("viewer", true), false);
    assert.equal(canAccessVoiceOrdersModule("staff", false), false);
  });

  it("treats missing env as disabled", () => {
    assert.equal(isVoiceOrdersEnvEnabled({}), false);
    assert.equal(isVoiceOrdersEnvEnabled({ AI_VOICE_ORDERS_ENABLED: "1" }), false);
    assert.equal(isVoiceOrdersEnvEnabled({ AI_VOICE_ORDERS_ENABLED: "true" }), true);
  });
});

describe("AI provider resolution", () => {
  it("is unavailable when nothing is configured", () => {
    assert.equal(resolveAiProviderName("transcription", {}), null);
    assert.equal(resolveAiProviderName("extraction", {}), null);
    assert.equal(voiceOrdersProviderConfigured({}), false);
  });

  it("runs the fake provider outside Vercel Production only", () => {
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }]) {
      const config = { ...env, AI_PROVIDER: "fake" };
      assert.equal(resolveAiProviderName("transcription", config), "fake");
      assert.equal(voiceOrdersProviderConfigured(config), true);
    }

    const production = { VERCEL_ENV: "production", AI_PROVIDER: " FAKE " };
    assert.equal(isProductionDeployment(production), true);
    assert.equal(resolveAiProviderName("transcription", production), null);
    assert.equal(resolveAiProviderName("extraction", production), null);
    assert.equal(voiceOrdersProviderConfigured(production), false);
    assert.equal(
      voiceOrdersProviderConfigured({
        VERCEL_ENV: "production",
        AI_TRANSCRIPTION_PROVIDER: "fake",
        AI_EXTRACTION_PROVIDER: "fake",
      }),
      false
    );
  });

  it("never falls back to fake on Production when the real provider is incomplete", () => {
    const env = { VERCEL_ENV: "production", OPENAI_API_KEY: "sk-test" };
    assert.equal(resolveAiProviderName("transcription", env), null);
    assert.equal(voiceOrdersProviderConfigured(env), false);
  });

  it("needs a key and an explicit model for openai", () => {
    assert.equal(resolveAiProviderName("transcription", { AI_PROVIDER: "openai" }), null);
    assert.equal(
      resolveAiProviderName("transcription", { AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" }),
      null
    );
    assert.equal(resolveAiProviderName("transcription", { ...OPENAI_READY, AI_PROVIDER: "openai" }), "openai");
    assert.equal(resolveAiProviderName("extraction", OPENAI_READY), "openai");
    assert.equal(
      voiceOrdersProviderConfigured({ ...OPENAI_READY, VERCEL_ENV: "production" }),
      true
    );
    assert.equal(
      voiceOrdersProviderConfigured({ ...OPENAI_READY, AI_EXTRACTION_MODEL: " " }),
      false
    );
  });

  it("makes openai unavailable with a base URL off the allowlist", () => {
    const eu = { ...OPENAI_READY, AI_PROVIDER_BASE_URL: "https://eu.api.openai.com/v1" };
    assert.equal(resolveAiProviderName("transcription", eu), "openai");
    assert.equal(voiceOrdersProviderConfigured(eu), true);

    const proxy = { ...OPENAI_READY, AI_PROVIDER_BASE_URL: "https://proxy.example.com/v1" };
    assert.equal(resolveAiProviderName("transcription", proxy), null);
    assert.equal(resolveAiProviderName("extraction", proxy), null);
    assert.equal(voiceOrdersProviderConfigured(proxy), false);
    assert.equal(
      resolveAiProviderName("transcription", { ...proxy, AI_PROVIDER: "fake" }),
      "fake"
    );
  });

  it("lets AI_PROVIDER win over per-operation providers and rejects unknown names", () => {
    const env = {
      ...OPENAI_READY,
      AI_PROVIDER: "fake",
      AI_TRANSCRIPTION_PROVIDER: "openai",
    };
    assert.equal(resolveAiProviderName("transcription", env), "fake");
    assert.equal(
      resolveAiProviderName("extraction", { AI_EXTRACTION_PROVIDER: "fake" }),
      "fake"
    );
    assert.equal(resolveAiProviderName("transcription", { AI_PROVIDER: "other" }), null);
    assert.equal(
      voiceOrdersProviderConfigured({ ...OPENAI_READY, AI_PROVIDER: "other" }),
      false
    );
  });
});

describe("voice orders same-origin check", () => {
  const request = (headers: Record<string, string>) =>
    new Request("http://localhost:3791/api/ai/voice-orders/drafts", { method: "POST", headers });

  it("accepts the page's own host even when request.url carries another hostname", () => {
    assert.equal(
      assertSameOrigin(request({ host: "e2e.localhost:3791", origin: "http://e2e.localhost:3791" })),
      true
    );
    assert.equal(
      assertSameOrigin(request({
        host: "sur4.app.gestcopy.com",
        "x-forwarded-proto": "https",
        origin: "https://sur4.app.gestcopy.com",
      })),
      true
    );
    assert.equal(
      assertSameOrigin(request({
        host: "e2e.preview.app.gestcopy.com:443",
        "x-forwarded-proto": "https",
        origin: "https://e2e.preview.app.gestcopy.com",
      })),
      true
    );
  });

  it("allows requests without Origin (same-origin GET, server tools)", () => {
    assert.equal(assertSameOrigin(request({ host: "e2e.localhost:3791" })), true);
  });

  it("rejects other hosts, ports, schemes and malformed values", () => {
    for (const [host, origin] of [
      ["sur4.app.gestcopy.com", "https://evil.example"],
      ["sur4.app.gestcopy.com", "https://demo.app.gestcopy.com"],
      ["e2e.localhost:3791", "http://e2e.localhost:3000"],
      ["e2e.localhost:3791", "http://localhost:3791"],
      ["sur4.app.gestcopy.com", "http://sur4.app.gestcopy.com"],
      ["sur4.app.gestcopy.com", "null"],
      ["sur4.app.gestcopy.com", "not a url"],
      ["evil.example, sur4.app.gestcopy.com", "https://sur4.app.gestcopy.com"],
    ]) {
      // Vercel adds x-forwarded-proto; next dev on *.localhost does not.
      const headers: Record<string, string> = host.includes("localhost")
        ? { host, origin }
        : { host, origin, "x-forwarded-proto": "https" };
      assert.equal(assertSameOrigin(request(headers)), false, `${host} ← ${origin}`);
    }
    // Local http page posting to itself is fine; an https origin there is not.
    assert.equal(
      assertSameOrigin(request({ host: "e2e.localhost:3791", origin: "https://e2e.localhost:3791" })),
      false
    );
  });
});
