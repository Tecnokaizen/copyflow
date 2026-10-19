const WEBM_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

export const DEFAULT_MAX_AUDIO_BYTES = 3_000_000;
export const DEFAULT_MAX_CLIP_SECONDS = 60;

/** Bitrate the browser recorder asks for (Opus in WebM, AAC in MP4). */
export const RECORDER_AUDIO_BITS_PER_SECOND = 48_000;

/**
 * Server-side bound for max_clip_seconds (G2 audit, M2). The server does not
 * read a duration from the file: Chrome writes MediaRecorder WebM as a live
 * stream with no Duration in its header, fragmented MP4 may declare 0, and
 * any header is set by the client. Instead it caps the upload at the bytes
 * an honest recorder produces in max_clip_seconds at up to this bitrate:
 * 2.7x what the recorder asks for, room for Safari's AAC until G5 measures it.
 * This bounds bytes, not seconds: a client that encodes below 128 kbps fits
 * more audio (about 168 s at the recorder's 48 kbps for a 60 s clip).
 */
export const MAX_AUDIO_BITS_PER_SECOND = 128_000;
/** Recorder timer tick (200 ms) plus the final flush after stop(). */
export const CLIP_SECONDS_TOLERANCE = 2;
/** EBML/Tracks or ftyp/moov headers and per-cluster/fragment framing. */
export const AUDIO_CONTAINER_OVERHEAD_BYTES = 16_384;

export const ALLOWED_AUDIO_MIME = new Set([
  "audio/webm",
  "audio/webm;codecs=opus",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
]);

function startsWith(bytes: Uint8Array, magic: number[]) {
  if (bytes.length < magic.length) return false;
  return magic.every((value, index) => bytes[index] === value);
}

function hasFtyp(bytes: Uint8Array) {
  if (bytes.length < 12) return false;
  return (
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  );
}

/**
 * Largest upload accepted for a clip: the configured max_audio_bytes, or less
 * when max_clip_seconds is short. Fail-closed on invalid limits: they fall
 * back to the defaults instead of disabling the check.
 */
export function maxAudioBytesForClip(maxClipSeconds: number, maxAudioBytes: number) {
  const clipSeconds =
    Number.isFinite(maxClipSeconds) && maxClipSeconds > 0
      ? maxClipSeconds
      : DEFAULT_MAX_CLIP_SECONDS;
  const configuredBytes =
    Number.isFinite(maxAudioBytes) && maxAudioBytes > 0
      ? maxAudioBytes
      : DEFAULT_MAX_AUDIO_BYTES;
  const byDuration =
    Math.ceil(
      ((clipSeconds + CLIP_SECONDS_TOLERANCE) * MAX_AUDIO_BITS_PER_SECOND) / 8
    ) + AUDIO_CONTAINER_OVERHEAD_BYTES;
  return Math.min(configuredBytes, byDuration);
}

export function normalizeAudioMime(value: string | null | undefined) {
  return (value ?? "").split(";")[0].trim().toLowerCase();
}

export function isAllowedAudioMime(value: string | null | undefined) {
  const raw = (value ?? "").trim().toLowerCase();
  if (ALLOWED_AUDIO_MIME.has(raw)) return true;
  const base = normalizeAudioMime(raw);
  return base === "audio/webm" || base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a";
}

export function validateAudioBytes(bytes: Uint8Array, mimeType: string) {
  if (bytes.byteLength === 0) {
    return { ok: false as const, reason: "empty" as const };
  }

  if (!isAllowedAudioMime(mimeType)) {
    return { ok: false as const, reason: "mime" as const };
  }

  const base = normalizeAudioMime(mimeType);
  const looksWebm = startsWith(bytes, WEBM_MAGIC);
  const looksMp4 = hasFtyp(bytes);

  if (base === "audio/webm" && !looksWebm) {
    return { ok: false as const, reason: "magic" as const };
  }

  if (
    (base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a") &&
    !looksMp4
  ) {
    return { ok: false as const, reason: "magic" as const };
  }

  return { ok: true as const };
}

export function audioFilenameForMime(mimeType: string) {
  const base = normalizeAudioMime(mimeType);
  if (base === "audio/mp4" || base === "audio/m4a" || base === "audio/x-m4a") {
    return "voice-order.m4a";
  }
  return "voice-order.webm";
}
