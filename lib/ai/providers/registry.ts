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

function resolveProviderName(kind: "transcription" | "extraction") {
  const shared = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (shared === "fake" || shared === "openai") {
    return shared;
  }

  const specific =
    kind === "transcription"
      ? process.env.AI_TRANSCRIPTION_PROVIDER
      : process.env.AI_EXTRACTION_PROVIDER;

  const value = specific?.trim().toLowerCase();
  if (value === "fake" || value === "openai") {
    return value;
  }

  if (process.env.OPENAI_API_KEY?.trim()) {
    return "openai";
  }

  return "fake";
}

export function getTranscriptionProvider(): TranscriptionProvider {
  return resolveProviderName("transcription") === "openai"
    ? createOpenAiTranscriptionProvider()
    : createFakeTranscriptionProvider();
}

export function getExtractionProvider(): ExtractionProvider {
  return resolveProviderName("extraction") === "openai"
    ? createOpenAiExtractionProvider()
    : createFakeExtractionProvider();
}
