import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  estimateExtractionReserveMicros,
  estimateTranscriptionReserveMicros,
  extractionActualMicros,
  transcriptionActualMicros,
} from "@/lib/ai/pricing";

describe("ai pricing reserves (internal cost control)", () => {
  it("reserves transcription conservatively for a 60s clip", () => {
    const micros = estimateTranscriptionReserveMicros(60);
    assert.ok(micros >= 7_000);
    assert.ok(micros <= 12_000);
  });

  it("reserves extraction with a floor of 2000 micros", () => {
    assert.equal(estimateExtractionReserveMicros(100), 2_000);
    assert.ok(estimateExtractionReserveMicros(8_000) >= 2_000);
  });

  it("computes actual micros from usage meters", () => {
    assert.equal(transcriptionActualMicros(60), 4_500);
    assert.ok(extractionActualMicros(8_000, 1_000) > 0);
  });
});
