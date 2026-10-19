import "server-only";

import { resolveOpenAiBaseUrl } from "@/lib/ai/providers/base-url";
import type {
  ExtractionProvider,
  TranscriptionProvider,
} from "@/lib/ai/providers/types";
import { EXTRACTION_JSON_SCHEMA } from "@/lib/ai/voice-orders/extraction-schema";
import { buildExtractionSystemPrompt } from "@/lib/ai/voice-orders/prompt";
import { parseModelExtraction } from "@/lib/ai/voice-orders/parse-extraction";

// Checked when the provider is created, before any audio or text is sent.
function requireBaseUrl() {
  const baseUrl = resolveOpenAiBaseUrl(process.env.AI_PROVIDER_BASE_URL);
  if (!baseUrl) {
    // The value is not echoed: a proxy URL may carry credentials.
    throw new Error("AI_PROVIDER_BASE_URL not allowed");
  }
  return baseUrl;
}

function requireModel(name: "AI_TRANSCRIPTION_MODEL" | "AI_EXTRACTION_MODEL") {
  // No default model: names and prices are not confirmed with the provider yet.
  const model = process.env[name]?.trim();
  if (!model) {
    throw new Error(`${name} missing`);
  }
  return model;
}

function requireApiKey() {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error("OPENAI_API_KEY missing");
  }
  return key;
}

export function createOpenAiTranscriptionProvider(): TranscriptionProvider {
  const baseUrl = requireBaseUrl();
  const model = requireModel("AI_TRANSCRIPTION_MODEL");

  return {
    name: "openai",
    model,
    async transcribe(input) {
      const form = new FormData();
      const blob = new Blob([Buffer.from(input.bytes)], {
        type: input.mimeType,
      });
      form.append("file", blob, input.filename);
      form.append("model", model);
      if (input.language) {
        form.append("language", input.language);
      }

      const response = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireApiKey()}`,
        },
        body: form,
        signal: input.signal,
      });

      if (!response.ok) {
        throw new Error(`openai_transcription_${response.status}`);
      }

      const payload = (await response.json()) as {
        text?: string;
        language?: string;
      };

      return {
        text: typeof payload.text === "string" ? payload.text : "",
        language: typeof payload.language === "string" ? payload.language : null,
        provider: "openai",
        model,
        audioSecondsEstimate: null,
      };
    },
  };
}

export function createOpenAiExtractionProvider(): ExtractionProvider {
  const baseUrl = requireBaseUrl();
  const model = requireModel("AI_EXTRACTION_MODEL");

  return {
    name: "openai",
    model,
    async extract(input) {
      const response = await fetch(`${baseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireApiKey()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          input: [
            {
              role: "system",
              content: buildExtractionSystemPrompt({
                timezone: input.timezone,
                locale: input.locale,
                nowIso: input.nowIso,
              }),
            },
            {
              role: "user",
              content: JSON.stringify({
                transcript: input.transcript,
                catalog: input.catalog,
              }),
            },
          ],
          text: {
            format: {
              type: "json_schema",
              name: "voice_order_extraction",
              strict: true,
              schema: EXTRACTION_JSON_SCHEMA,
            },
          },
        }),
        signal: input.signal,
      });

      if (!response.ok) {
        throw new Error(`openai_extraction_${response.status}`);
      }

      const payload = (await response.json()) as {
        output_text?: string;
        output?: Array<{
          content?: Array<{ type?: string; text?: string }>;
        }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      let text = typeof payload.output_text === "string" ? payload.output_text : "";
      if (!text && Array.isArray(payload.output)) {
        for (const item of payload.output) {
          for (const part of item.content ?? []) {
            if (part.type === "output_text" && typeof part.text === "string") {
              text = part.text;
              break;
            }
          }
        }
      }

      const parsed = parseModelExtraction(text);
      if (!parsed) {
        throw new Error("openai_extraction_invalid_json");
      }

      return {
        extraction: parsed,
        provider: "openai",
        model,
        inputTokens:
          typeof payload.usage?.input_tokens === "number"
            ? payload.usage.input_tokens
            : null,
        outputTokens:
          typeof payload.usage?.output_tokens === "number"
            ? payload.usage.output_tokens
            : null,
      };
    },
  };
}
