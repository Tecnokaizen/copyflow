import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateAudioBytes } from "@/lib/ai/voice-orders/audio";

describe("voice order audio validation", () => {
  it("accepts webm magic bytes", () => {
    const bytes = Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]);
    assert.equal(validateAudioBytes(bytes, "audio/webm").ok, true);
  });

  it("rejects forged mime without magic bytes", () => {
    const bytes = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);
    assert.equal(validateAudioBytes(bytes, "audio/webm").ok, false);
  });

  it("accepts mp4 ftyp marker", () => {
    const bytes = Uint8Array.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
    ]);
    assert.equal(validateAudioBytes(bytes, "audio/mp4").ok, true);
  });
});
