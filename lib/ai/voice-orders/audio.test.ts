import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_MAX_AUDIO_BYTES,
  DEFAULT_MAX_CLIP_SECONDS,
  MAX_AUDIO_BITS_PER_SECOND,
  RECORDER_AUDIO_BITS_PER_SECOND,
  maxAudioBytesForClip,
  validateAudioBytes,
} from "@/lib/ai/voice-orders/audio";

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

describe("voice order clip length bound on the server", () => {
  // Bytes a recorder produces for `seconds` at `bitsPerSecond`, plus headers.
  const clipBytes = (seconds: number, bitsPerSecond: number) =>
    Math.ceil((seconds * bitsPerSecond) / 8) + 4_096;

  it("caps the default 60 s clip below the 3 MB size limit", () => {
    const cap = maxAudioBytesForClip(DEFAULT_MAX_CLIP_SECONDS, DEFAULT_MAX_AUDIO_BYTES);
    assert.equal(cap, 2_000_384);
    assert.ok(cap < DEFAULT_MAX_AUDIO_BYTES);
  });

  it("accepts a full honest clip, with the timer's overshoot", () => {
    const cap = maxAudioBytesForClip(60, DEFAULT_MAX_AUDIO_BYTES);
    assert.ok(clipBytes(61, RECORDER_AUDIO_BITS_PER_SECOND) <= cap);
    // WebKit's AAC ignores the 48 kbps request: ~146 kbps measured over 59 s.
    assert.ok(clipBytes(61, 146_000) <= cap);
    assert.ok(clipBytes(61, MAX_AUDIO_BITS_PER_SECOND) <= cap);
    assert.ok(MAX_AUDIO_BITS_PER_SECOND >= 5 * RECORDER_AUDIO_BITS_PER_SECOND);
  });

  it("bounds bytes only: the seconds are measured from the packets", () => {
    const cap = maxAudioBytesForClip(60, DEFAULT_MAX_AUDIO_BYTES);
    assert.ok(clipBytes(70, MAX_AUDIO_BITS_PER_SECOND) > cap);
    assert.ok(clipBytes(400, RECORDER_AUDIO_BITS_PER_SECOND) > cap);
  });

  it("follows max_clip_seconds and never exceeds max_audio_bytes", () => {
    assert.ok(maxAudioBytesForClip(30, DEFAULT_MAX_AUDIO_BYTES) < maxAudioBytesForClip(60, DEFAULT_MAX_AUDIO_BYTES));
    assert.equal(maxAudioBytesForClip(60, 500_000), 500_000);
    assert.equal(maxAudioBytesForClip(300, 4_000_000), 4_000_000);
  });

  it("falls back to the defaults on invalid limits instead of disabling the check", () => {
    const fallback = maxAudioBytesForClip(DEFAULT_MAX_CLIP_SECONDS, DEFAULT_MAX_AUDIO_BYTES);
    for (const clip of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(maxAudioBytesForClip(clip, DEFAULT_MAX_AUDIO_BYTES), fallback, String(clip));
    }
    for (const bytes of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.equal(maxAudioBytesForClip(DEFAULT_MAX_CLIP_SECONDS, bytes), fallback, String(bytes));
    }
  });

  it("the transcription route enforces the bound and the recorder asks for the shared bitrate", () => {
    const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");
    const route = read("app/api/ai/voice-orders/transcriptions/route.ts");
    assert.match(route, /const maxBytes = maxAudioBytesForClip\(\s*maxClip,/);
    assert.match(route, /bytes\.byteLength > maxBytes/);
    const recorder = read("components/orders/voice/use-voice-recorder.ts");
    assert.match(recorder, /audioBitsPerSecond: RECORDER_AUDIO_BITS_PER_SECOND/);
  });
});
