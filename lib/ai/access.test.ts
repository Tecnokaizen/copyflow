import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
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
