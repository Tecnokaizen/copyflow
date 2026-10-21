import "server-only";

import {
  createFakeExtractionProvider,
  createFakeTranscriptionProvider,
} from "@/lib/ai/providers/fake";
import {
  createOpenAiExtractionProvider,
  createOpenAiTranscriptionProvider,
} from "@/lib/ai/providers/openai";
import type {
  ExtractionProvider,
  TranscriptionProvider,
} from "@/lib/ai/providers/types";
import { resolveAiProviderName } from "@/lib/ai/voice-orders/feature";

// Routes check voiceOrdersProviderConfigured() first (503 otherwise); this
// throw is the last barrier, e.g. against `fake` on Vercel Production.
function requireProvider(kind: "transcription" | "extraction") {
  const name = resolveAiProviderName(kind);
  if (!name) {
    throw new Error(`ai_provider_unavailable:${kind}`);
  }
  return name;
}

export function getTranscriptionProvider(): TranscriptionProvider {
  return requireProvider("transcription") === "openai"
    ? createOpenAiTranscriptionProvider()
    : createFakeTranscriptionProvider();
}

export function getExtractionProvider(): ExtractionProvider {
  return requireProvider("extraction") === "openai"
    ? createOpenAiExtractionProvider()
    : createFakeExtractionProvider();
}
