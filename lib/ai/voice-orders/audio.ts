const WEBM_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];

export const DEFAULT_MAX_AUDIO_BYTES = 3_000_000;
export const DEFAULT_MAX_CLIP_SECONDS = 60;
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
