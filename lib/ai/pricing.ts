/** Internal AI cost estimates for reservation (micros). Not commercial pricing. */

export const AI_PRICING_VERSION = "voice-orders-pricing/v1" as const;

/** 1 USD = 1_000_000 micros */
export const MICROS_PER_USD = 1_000_000;

/** gpt-transcribe list price ≈ $0.0045 / minute */
export const TRANSCRIPTION_MICROS_PER_MINUTE = 4_500;

/** gpt-6-luna list: $0.10 / MTok in, $0.50 / MTok out (internal estimate) */
export const EXTRACTION_INPUT_MICROS_PER_MTOK = 100_000;
export const EXTRACTION_OUTPUT_MICROS_PER_MTOK = 500_000;

const SAFETY = 1.5;
const UE_RESIDENCY_BUFFER = 1.1;

export function estimateTranscriptionReserveMicros(maxClipSeconds: number) {
  const minutes = Math.ceil(Math.max(maxClipSeconds, 1) / 60);
  return Math.ceil(
    minutes * TRANSCRIPTION_MICROS_PER_MINUTE * UE_RESIDENCY_BUFFER * SAFETY
  );
}

export function estimateExtractionReserveMicros(inputTokensEstimate = 8_000) {
  const maxOut = 1_000;
  const inputCost =
    (inputTokensEstimate / 1_000_000) * EXTRACTION_INPUT_MICROS_PER_MTOK;
  const outputCost = (maxOut / 1_000_000) * EXTRACTION_OUTPUT_MICROS_PER_MTOK;
  return Math.max(2_000, Math.ceil((inputCost + outputCost) * SAFETY));
}

export function transcriptionActualMicros(audioSeconds: number) {
  const minutes = Math.max(audioSeconds, 0) / 60;
  return Math.ceil(minutes * TRANSCRIPTION_MICROS_PER_MINUTE);
}

export function extractionActualMicros(inputTokens: number, outputTokens: number) {
  const inputCost =
    (Math.max(inputTokens, 0) / 1_000_000) * EXTRACTION_INPUT_MICROS_PER_MTOK;
  const outputCost =
    (Math.max(outputTokens, 0) / 1_000_000) * EXTRACTION_OUTPUT_MICROS_PER_MTOK;
  return Math.ceil(inputCost + outputCost);
}
